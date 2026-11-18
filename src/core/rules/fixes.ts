/**
 * Lösungsvorschläge zu Prüfmeldungen.
 *
 * Für eine Meldung (Fehler, Warnung, Hinweis) werden mögliche Änderungen am
 * Projekt erzeugt – z. B. eine fehlende Steckdose an eine freie Stelle setzen,
 * einen Schalter auf die Griffseite verschieben, einem Stromkreis einen RCD
 * zuordnen. Jeder Vorschlag wird probeweise angewendet und die Prüfung neu
 * gerechnet: Angeboten wird er nur, wenn die Meldung danach weg ist und kein
 * neuer Fehler/keine neue Warnung entsteht. Wo sich nichts sinnvoll rechnen
 * lässt, führt der Vorschlag zur passenden Eingabe.
 */
import { produce } from 'immer';
import type { Circuit, Door, Outlet, Project, Room } from '../model/schema';
import { bbox, boxCenters, doorHandleSide, ffbToZ, fmt, futureBuildup, outletExtent, roomArea, suggestedSwitchS, wallGeoms, wallLength, wallName, zToFfb } from '../geometry/room';
import { newId } from '../model/factory';
import { outletKindLabel } from '../model/labels';
import { ROOM_TYPE_INFO } from '../model/roomTypes';
import { findFreeS, nextOutletLabel, suggestOutlets } from '../planning/suggest';
import { applyCircuitProposal, proposeCircuits } from '../planning/circuits';
import { lightingEstimate } from '../planning/lighting';
import { normValue } from './normValues';
import { runRules } from './rules';
import type { RuleFinding, Severity } from './types';

export type RoomTab = 'bau' | 'einrichtung' | 'auslaesse' | 'leitungen' | 'zusammenfassung';

export interface FixGoto {
  view: 'raum' | 'verteilung' | 'projekt';
  roomId?: string;
  tab?: RoomTab;
  outletId?: string;
}

export interface FixProposal {
  id: string;
  /** Kurz, als Knopftext: was passiert */
  label: string;
  /** Warum diese Lösung / was zu beachten ist */
  detail?: string;
  /** Änderung am Projekt (auf einem Immer-Entwurf) */
  apply?: (p: Project) => void;
  /** Statt einer Änderung: zur passenden Eingabe springen */
  goto?: FixGoto;
}

const RANK: Record<Severity, number> = { ok: 0, hinweis: 1, warnung: 2, fehler: 3 };
/** Meldung ohne Zahlen – damit „10 cm von der Ecke“ und „12 cm von der Ecke“ als dieselbe Meldung zählen. */
const key = (f: RuleFinding) => `${f.ruleId}|${f.roomId ?? ''}|${f.outletId ?? ''}|${f.ref ?? ''}|${f.message.replace(/[\d,.]+/g, '#')}`;

const isSwitchLike = (o: Outlet) => ['schalter', 'taster', 'bewegungsmelder'].includes(o.kind);
const isAp = (r: Room) => r.installationType.startsWith('aufputz');

function roomOf(p: Project, id: string | undefined): Room | undefined {
  return p.rooms.find((r) => r.id === id);
}

/** Probeweise anwenden und prüfen, ob die Meldung gelöst ist, ohne neue Probleme zu schaffen. */
export function verifyFix(project: Project, f: RuleFinding, fix: FixProposal): boolean {
  if (!fix.apply) return true;
  const opts = f.roomId && !isProjectRule(f.ruleId) ? { roomId: f.roomId } : {};
  const before = runRules(project, opts).findings;
  let next: Project;
  try { next = produce(project, (d) => { fix.apply!(d as Project); }); } catch { return false; }
  const after = runRules(next, opts).findings;
  const k = key(f);
  // gelöst: gleiche Meldung nicht mehr (mindestens) gleich schwer vorhanden
  if (after.some((x) => key(x) === k && RANK[x.severity] >= RANK[f.severity])) return false;
  // nichts verschlimmert: keine neuen Fehler/Warnungen
  const old = new Set(before.map(key));
  return !after.some((x) => RANK[x.severity] >= RANK.warnung && !old.has(key(x)) && x.ruleId !== f.ruleId);
}

const PROJECT_RULES = new Set(['VDE0100-520.SPANNUNGSFALL', 'VDE0100-410.RCD', 'VERTEILUNG.PLAETZE', 'VDE0100-520.BELASTBARKEIT', 'VDE0100-420.AFDD', 'VDE0100-443.SPD', 'VDE0100-722.EMOBILITAET', 'ERDVERLEGUNG', 'LEISTUNG.STROMKREIS', 'LEISTUNG.GESAMT']);
const isProjectRule = (id: string) => PROJECT_RULES.has(id);

/**
 * Lösungsvorschläge für eine Meldung, bereits geprüft und nach Eignung sortiert.
 * `max` begrenzt die Zahl der angebotenen Varianten.
 */
export function fixesFor(project: Project, f: RuleFinding, max = 3): FixProposal[] {
  const candidates = candidatesFor(project, f);
  const out: FixProposal[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (out.length >= max) break;
    if (seen.has(c.label)) continue;
    if (c.apply && !verifyFix(project, f, c)) continue;
    seen.add(c.label);
    out.push(c);
  }
  return out;
}

/** Gibt es zu dieser Regel grundsätzlich Lösungsvorschläge? (für die Anzeige des Knopfes, ohne zu rechnen) */
export function hasFixes(f: RuleFinding): boolean {
  if (['MLAR.BRANDSCHUTZTUER', 'LEISTUNG.GESAMT'].includes(f.ruleId)) return false;
  if (f.ruleId === 'VDE0100-701.SCHUTZBEREICHE' && f.severity === 'hinweis') return false; // nur IPX4-Hinweis
  if (f.ruleId === 'VDE0100-722.EMOBILITAET' && /Netzbetreiber|Typ A nur/.test(f.message)) return false;
  if (f.ruleId === 'ERDVERLEGUNG' && f.severity === 'hinweis') return false; // Verlegehinweis
  if (f.ruleId === 'SMART.DOSENTIEFE' && !/tiefe Dose/.test(f.message)) return false; // Neutralleiter/KNX: Merkhinweis
  if (f.ruleId === 'VDE0100-520.BELASTBARKEIT' && f.severity === 'hinweis' && /knapp/.test(f.message)) return true;
  return true;
}

// ---------------------------------------------------------------------------

function candidatesFor(project: Project, f: RuleFinding): FixProposal[] {
  if (!hasFixes(f)) return [];
  const room = roomOf(project, f.roomId);
  const o = room?.outlets.find((x) => x.id === f.outletId);
  const goto = (label: string, g: FixGoto, detail?: string): FixProposal => ({ id: `goto:${label}`, label, detail, goto: g });
  const roomGoto = (label: string, tab: RoomTab, detail?: string) => goto(label, { view: 'raum', roomId: f.roomId, tab }, detail);

  switch (f.ruleId) {
    // --- Auslass falsch platziert: verschieben --------------------------------
    case 'AUSLASS.GEOMETRIE':
    case 'TUER.OEFFNUNG':
    case 'ECKE.ABSTAND':
    case 'WAND.TABUZONE':
    case 'SCHALTER.GRIFFSEITE':
    case 'VDE0100-701.SCHUTZBEREICHE':
    case 'DIN18015-3.ZONE': {
      if (!room || !o) return [];
      if (f.ruleId === 'ECKE.ABSTAND' && /wächst in Richtung Ecke/.test(f.message)) {
        return [{ id: 'growth', label: `${o.label}: Mehrfachkombination von der Ecke weg wachsen lassen`, apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) x.growth = x.growth === 'links' ? 'rechts' : 'links'; } }];
      }
      return [...moveCandidates(project, room, o, f), roomGoto(`${o.label} von Hand verschieben`, 'auslaesse')];
    }
    case 'VORWAND.HOEHE': {
      if (!room || !o) return [];
      const out: FixProposal[] = [];
      if (/über der Vorwand|keine Vorwand/.test(f.message)) out.push({ id: 'up', label: `${o.label}: UP-Dose (tief) im Mauerwerk statt Hohlwanddose`, apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) x.boxType = 'up_tief'; } });
      if (/hinter der Vorwand/.test(f.message)) out.push({ id: 'vw', label: `${o.label}: Hohlwanddose in der Vorwand statt UP-Dose`, apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) x.boxType = 'vorwand'; } });
      return [...out, ...moveCandidates(project, room, o, f)];
    }
    case 'SMART.DOSENTIEFE':
      if (room && o && /tiefe Dose/.test(f.message)) return [{ id: 'tief', label: `${o.label}: tiefe Dose (Elektronikdose) verwenden`, apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) x.boxType = 'up_tief'; } }];
      return [];

    // --- Fehlende Auslässe ergänzen --------------------------------------------
    case 'DIN18015-2.AUSSTATTUNG':
      if (!room) return [];
      if (/Steckdosen/.test(f.message)) return socketCandidates(project, room, f);
      if (/Lichtauslass/.test(f.message)) return lightCandidates(project, room, 1);
      return [];
    case 'BELEUCHTUNG.ABSCHAETZUNG': {
      if (!room) return [];
      const e = lightingEstimate(project, room);
      return [...lightCandidates(project, room, Math.max(1, e.recommended - e.existing)), roomGoto('Leuchten von Hand planen', 'auslaesse', 'Alternativ stärkere Leuchten (mehr Lumen) wählen – dann bleibt es bei der Anzahl.')];
    }
    case 'LBO.RAUCHWARNMELDER':
      return room ? smokeCandidates(project, room) : [];
    case 'LEISTUNG.ZUORDNUNG': {
      if (!room) return [];
      const sg = suggestOutlets(project, room).filter((s) => s.source === 'verbraucher');
      if (!sg.length) return [roomGoto('Anschluss von Hand setzen', 'auslaesse')];
      return [{
        id: 'last', label: sg.length === 1 ? `Anschluss für ${roomLoadLabel(room, sg[0].loadId)} setzen: ${where(room, sg[0].outlet)}` : `${sg.length} Anschlüsse für die Verbraucher setzen`,
        detail: sg.map((s) => `${roomLoadLabel(room, s.loadId)}: ${where(room, s.outlet)}`).join(' · ') + ' – Lage danach an Gerät/Möbel anpassen.',
        apply: (p) => addOutlets(p, room.id, sg.map((s) => ({ outlet: s.outlet, loadId: s.loadId }))),
      }];
    }

    // --- Stromkreise, Schutzgeräte ---------------------------------------------
    case 'STROMKREIS.ZUORDNUNG': {
      const prop = proposeCircuits(project, 'offen');
      const n = prop.circuits.length;
      return [{
        id: 'kreise', label: n ? `Stromkreise für die offenen Auslässe vorschlagen (${n} neue${n === 1 ? 'r' : ''} Kreis${n === 1 ? '' : 'e'} bzw. Zuordnung zu vorhandenen)` : 'Offene Auslässe vorhandenen Stromkreisen zuordnen',
        detail: 'Wie „Verteilung & Stromkreise → Vorschlag übernehmen (nur offene)“. Bestehende Zuordnungen bleiben.',
        apply: (p) => applyCircuitProposal(p, proposeCircuits(p, 'offen'), 'offen'),
      }, goto('Stromkreise von Hand zuordnen', { view: 'verteilung' })];
    }
    case 'VDE0100-410.RCD':
    case 'VDE0100-701.RCD': {
      const c = circuitFromFinding(project, f);
      if (!c) return [goto('RCD in der Verteilung zuordnen', { view: 'verteilung' })];
      return [...rcdCandidates(project, c), goto('RCD in der Verteilung zuordnen', { view: 'verteilung' })];
    }
    case 'VDE0100-722.EMOBILITAET': {
      if (/fest angeschlossen/.test(f.message) && room && o) {
        return [{ id: 'fa', label: `${o.label} als Festanschluss planen (Leitung direkt in die Wallbox)`, detail: 'Keine Geräteanschlussdose; ca. 1 m Leitungsreserve am Montageort.', apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) { x.kind = 'festanschluss'; x.inserts = x.inserts.filter((i) => i !== 'geraeteanschluss'); } } }];
      }
      const c = circuitFromFinding(project, f);
      if (/kein RCD/.test(f.message) && c) return [wallboxRcd(project, c), goto('RCD in der Verteilung zuordnen', { view: 'verteilung' })];
      if (/keinen Stromkreis/.test(f.message)) return [{ id: 'kreise', label: 'Eigenen Stromkreis für die Wallbox vorschlagen', apply: (p) => applyCircuitProposal(p, proposeCircuits(p, 'offen'), 'offen') }];
      if (/weitere Auslässe/.test(f.message)) return [goto('Andere Auslässe auf einen anderen Kreis legen', { view: 'verteilung' })];
      return [];
    }
    case 'VDE0100-420.AFDD': {
      const c = circuitFromFinding(project, f);
      return c ? [{ id: 'afdd', label: `${c.label}: Brandschutzschalter (AFDD) vorsehen`, detail: 'Braucht in der Verteilung zusätzlich Platz (meist 1–2 TE je Kreis bzw. als Kombigerät).', apply: (p) => { const x = p.circuits.find((y) => y.id === c.id); if (x) x.afdd = true; } }] : [];
    }
    case 'VDE0100-443.SPD': {
      const d = project.distributions.find((x) => x.kind === 'HV' || x.kind === 'Zaehlerschrank') ?? project.distributions[0];
      return d ? [{ id: 'spd', label: `Überspannungsschutz in „${d.name}“ vorsehen`, detail: 'Typ 1+2 am Zählerplatz/HV; in Unterverteilungen mit langer Zuleitung zusätzlich Typ 2.', apply: (p) => { const x = p.distributions.find((y) => y.id === d.id); if (x) x.hasSpd = true; } }] : [];
    }
    case 'ERDVERLEGUNG': {
      const c = circuitFromFinding(project, f);
      if (!c || !c.cable.startsWith('NYM')) return [];
      const cable = c.cable.replace(/^NYM-J|^NYM/, 'NYY-J');
      return [{ id: 'nyy', label: `${c.label}: Erdkabel ${cable} statt ${c.cable}`, apply: (p) => { const x = p.circuits.find((y) => y.id === c.id); if (x) x.cable = cable; } }];
    }
    case 'VDE0100-520.SPANNUNGSFALL':
    case 'VDE0100-520.BELASTBARKEIT': {
      const c = circuitFromFinding(project, f);
      if (!c) return [];
      const out: FixProposal[] = [];
      const bigger = upsizeCable(c.cable);
      if (bigger) out.push({ id: 'q', label: `${c.label}: größerer Querschnitt ${bigger} statt ${c.cable}`, apply: (p) => { const x = p.circuits.find((y) => y.id === c.id); if (x) x.cable = bigger; } });
      const smaller = [13, 10].find((a) => a < c.ratedCurrent);
      if (smaller && f.ruleId === 'VDE0100-520.BELASTBARKEIT') out.push({ id: 'ls', label: `${c.label}: LS ${c.characteristic}${smaller} statt ${c.characteristic}${c.ratedCurrent}`, detail: 'Nur wenn die angeschlossenen Geräte damit auskommen.', apply: (p) => { const x = p.circuits.find((y) => y.id === c.id); if (x) x.ratedCurrent = smaller; } });
      out.push(goto('Stromkreis aufteilen (in der Verteilung)', { view: 'verteilung' }));
      return out;
    }
    case 'LEISTUNG.STROMKREIS':
    case 'VERTEILUNG.PLAETZE':
      return [goto('In der Verteilung anpassen', { view: 'verteilung' })];

    // --- Raum ------------------------------------------------------------------
    case 'RAUM.ERFASSUNG':
      if (!room) return [];
      if (/keine Tür/.test(f.message)) return [roomGoto('Tür erfassen', 'bau')];
      if (/Material/.test(f.message)) return [roomGoto('Wandmaterial angeben', 'bau')];
      if (/Deckenbauart/.test(f.message)) return [roomGoto('Deckenbauart angeben', 'bau')];
      if (/angenommene/.test(f.message)) return [roomGoto('Angenommene Maße prüfen', 'bau', 'Vor Ort nachmessen und die Angaben als „gemessen“ markieren.')];
      if (/nicht bestätigt/.test(f.message)) return [roomGoto('Zusammenfassung ansehen und bestätigen', 'zusammenfassung')];
      return [];
    case 'BODEN.SCHLITZTIEFE': {
      if (!room) return [];
      const prot = room.floor.protectedLayerDepth;
      if (prot != null && /Sicherheitsabstand/.test(f.message)) {
        const max = Math.max(0, Math.floor((prot - normValue(project, 'boden.sicherheitZuFolie')) * 10) / 10);
        return [{ id: 'tiefe', label: `Bodenschlitz auf höchstens ${fmt(max)} cm Tiefe begrenzen`, apply: (p) => { const r = roomOf(p, room.id); if (r) r.floor.maxSlotDepth = max; } }];
      }
      if (/Fußbodenheizung/.test(f.message)) return [{ id: 'kein', label: 'Bodenschlitze ausschließen (anderer Leitungsweg)', apply: (p) => { const r = roomOf(p, room.id); if (r) r.floor.slotsAllowed = false; } }, roomGoto('Leitungsweg wählen', 'leitungen')];
      return [roomGoto('Lage von Folie/Dämmung eintragen', 'bau', 'Probebohrung oder Bauunterlagen; danach wird die zulässige Schlitztiefe berechnet.')];
    }
    case 'DECKE.HOHLKOERPER':
      return room ? [{ id: 'decke', label: 'Hohlkörperdecke als „nicht schlitzen“ markieren', apply: (p) => { const r = roomOf(p, room.id); if (r) r.ceiling.slotsAllowed = false; } }] : [];
    case 'ABSTAND.TUERAUFSCHLAG':
      return room ? doorSwingCandidates(room) : [];
    case 'TRASSE':
      return [roomGoto('Leitungsweg ansehen und anpassen', 'leitungen')];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------

function outletIn(p: Project, roomId: string, outletId: string): Outlet | undefined {
  return roomOf(p, roomId)?.outlets.find((x) => x.id === outletId);
}

function where(room: Room, o: Outlet): string {
  if (o.mount !== 'wand' || o.wallIndex == null) return `Decke (x ${fmt(o.x, 0)} / y ${fmt(o.y, 0)} cm)`;
  return `${wallName(room, o.wallIndex)} bei ${fmt(o.s, 0)} cm, ${fmt(zToFfb(room, o.z ?? 0), 0)} cm hoch`;
}

function roomLoadLabel(room: Room, loadId?: string) {
  return room.loads.find((l) => l.id === loadId)?.label ?? 'Verbraucher';
}

function addOutlets(p: Project, roomId: string, list: { outlet: Outlet; loadId?: string }[]) {
  const r = roomOf(p, roomId);
  if (!r) return;
  const taken: string[] = [];
  for (const { outlet, loadId } of list) {
    const label = nextOutletLabel(r, taken);
    taken.push(label);
    r.outlets.push({ ...outlet, id: newId('o'), label } as Outlet);
    if (loadId) { const l = r.loads.find((x) => x.id === loadId); if (l) l.outletId = r.outlets[r.outlets.length - 1].id; }
  }
}

/** Neue Position auf derselben oder (für Schalter) auf der Griffseite einer Tür. */
function moveCandidates(project: Project, room: Room, o: Outlet, f: RuleFinding): FixProposal[] {
  if (o.mount !== 'wand' || o.wallIndex == null || o.s == null || o.z == null) return [];
  const half = Math.max(4, ((outletExtent(o, project.settings)?.sMax ?? o.s + 4) - (outletExtent(o, project.settings)?.sMin ?? o.s - 4)) / 2);
  const out: { wi: number; s: number; z: number; why: string; dist: number }[] = [];
  const push = (wi: number, s: number | null, z: number, why: string) => {
    if (s == null) return;
    // s ist bei Mehrfachdosen die Position der ersten Dose – auf die Mitte umrechnen ist nicht nötig, findFreeS arbeitet mit Mitte ± half
    if (out.some((x) => x.wi === wi && Math.abs(x.s - s) < 3 && Math.abs(x.z - z) < 3)) return;
    const dist = (wi === o.wallIndex ? Math.abs(s - o.s!) : 500) + Math.abs(z - o.z!);
    out.push({ wi, s: Math.round(s * 10) / 10, z: Math.round(z * 10) / 10, why, dist });
  };

  // Schalter: Griffseite der nächsten Tür
  if (isSwitchLike(o)) {
    const doors = [...room.doors].sort((a, b) => (a.wallIndex === o.wallIndex ? 0 : 1) - (b.wallIndex === o.wallIndex ? 0 : 1));
    for (const d of doors as Door[]) {
      const s0 = suggestedSwitchS(d, normValue(project, 'schalter.abstandZarge'), normValue(project, 'schalter.abstandOhneZarge'));
      push(d.wallIndex, findFreeS(room, d.wallIndex, s0, 4, o.z, 10), o.z, `Griffseite (${doorHandleSide(d)}) der Tür in ${wallName(room, d.wallIndex)}`);
    }
  }
  // gleiche Wand, nächste freie Stelle
  push(o.wallIndex, findFreeS(room, o.wallIndex, o.s, half, o.z), o.z, 'nächste freie Stelle auf derselben Wand');
  // weitere Stellen auf der Wand (für Regeln, die findFreeS nicht kennt, z. B. Bad-Schutzbereiche)
  const len = wallLength(room, o.wallIndex);
  for (const step of [20, 40, 60, 90, 120, 160, 200, 260]) {
    for (const s of [o.s + step, o.s - step]) if (s > 20 && s < len - 20) push(o.wallIndex, findFreeS(room, o.wallIndex, s, half, o.z), o.z, 'freie Stelle auf derselben Wand');
  }
  // Installationszone: Höhe in die nächste waagerechte Zone
  if (f.ruleId === 'DIN18015-3.ZONE') {
    const fb = futureBuildup(room);
    const zones = [
      (normValue(project, 'zone.h.unten.von') + normValue(project, 'zone.h.unten.bis')) / 2,
      (normValue(project, 'zone.h.mitte.von') + normValue(project, 'zone.h.mitte.bis')) / 2,
      room.height - fb - (normValue(project, 'zone.h.oben.von') + normValue(project, 'zone.h.oben.bis')) / 2,
    ].map((h) => ffbToZ(room, h));
    for (const z of zones.sort((a, b) => Math.abs(a - o.z!) - Math.abs(b - o.z!))) push(o.wallIndex, o.s, z, 'in die waagerechte Installationszone');
    // senkrechte Zone neben der nächsten Ecke/Öffnung
    const vz = (normValue(project, 'zone.v.von') + normValue(project, 'zone.v.bis')) / 2;
    const edges = [0, len, ...room.doors.filter((d) => d.wallIndex === o.wallIndex).flatMap((d) => [d.s, d.s + d.width]), ...room.windows.filter((w) => w.wallIndex === o.wallIndex).flatMap((w) => [w.s, w.s + w.width])];
    const near = edges.sort((a, b) => Math.abs(a - o.s!) - Math.abs(b - o.s!))[0];
    for (const s of [near + vz, near - vz]) if (s > 0 && s < len) push(o.wallIndex, findFreeS(room, o.wallIndex, s, half, o.z, 5), o.z, 'in die senkrechte Installationszone');
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, 12).map((c) => ({
    id: `move:${c.wi}:${c.s}:${c.z}`,
    label: `${o.label} verschieben: ${wallName(room, c.wi)} bei ${fmt(c.s, 0)} cm${Math.abs(c.z - o.z!) > 1 ? `, Höhe ${fmt(zToFfb(room, c.z), 0)} cm` : ''}`,
    detail: `${c.why}${c.wi === o.wallIndex ? ` (${c.s > o.s! ? '+' : '−'}${fmt(Math.abs(c.s - o.s!), 0)} cm)` : ''}.`,
    apply: (p) => { const x = outletIn(p, room.id, o.id); if (x) { x.wallIndex = c.wi; x.s = c.s; x.z = c.z; } },
  }));
}

/** Zu wenig Steckdosen: Einzelsteckdosen zu Doppelsteckdosen erweitern oder neue Steckdosen setzen. */
function socketCandidates(project: Project, room: Room, f: RuleFinding): FixProposal[] {
  const info = room.roomType ? ROOM_TYPE_INFO[room.roomType] : null;
  if (!info) return [];
  const count = (r: Room) => r.outlets.filter((o) => o.status !== 'bestand_entfaellt').reduce((s, o) => s + o.inserts.filter((i) => i.startsWith('steckdose')).length, 0);
  const level = project.equipmentLevel;
  const factor = level === 1 ? 1 : level === 2 ? 1.5 : 2;
  const minS = info.minSockets(roomArea(room));
  const target = f.severity === 'warnung' ? minS : Math.ceil(minS * factor);
  const need = target - count(room);
  if (need <= 0) return [];
  const out: FixProposal[] = [];
  const ap = isAp(room);
  const insert = ap ? 'steckdose_klappdeckel' : 'steckdose';

  // A) neue Steckdosen an freien Wandabschnitten (2-fach, wo es reicht)
  const zSD = Math.round(ffbToZ(room, ap ? project.settings.defaultHeights.aufputzKeller : project.settings.defaultHeights.steckdose) * 10) / 10;
  const placed: Outlet[] = [];
  const ws = [...wallGeoms(room)].sort((a, b) => b.length - a.length);
  const free = (wi: number, s: number) => !room.outlets.some((x) => x.wallIndex === wi && x.s != null && Math.abs(x.s - s) < 60) && !placed.some((x) => x.wallIndex === wi && Math.abs(x.s! - s) < 60);
  let left = need;
  for (const frac of [0.5, 0.25, 0.75]) {
    for (const w of ws) {
      if (left <= 0 || w.length < 80) continue;
      const s = findFreeS(room, w.index, w.length * frac, 8, zSD, 20);
      if (s == null || !free(w.index, s)) continue;
      const gangs = left >= 2 ? 2 : 1;
      placed.push({ id: newId('o'), label: '?', kind: 'steckdose', mount: 'wand', wallIndex: w.index, s, z: zSD, gangs, orientation: 'waagerecht', growth: 'rechts', boxType: ap ? 'aufputz' : 'up_tief', inserts: Array(gangs).fill(insert), controls: [], smart: false, status: 'neu', note: 'Ausstattung (Lösungsvorschlag)' } as Outlet);
      left -= gangs;
    }
  }
  if (left <= 0 && placed.length) {
    out.push({
      id: 'neu',
      label: placed.length === 1 ? `${placed[0].gangs === 2 ? 'Doppelsteckdose' : 'Steckdose'} setzen: ${where(room, placed[0])}` : `${placed.length} Steckdosen setzen`,
      detail: `${placed.map((x) => `${x.gangs}-fach ${where(room, x)}`).join(' · ')}. Mindestens ${target} Steckdosen (${info.label}${f.severity === 'hinweis' ? `, Ausstattungswert ${level}` : ''}).`,
      apply: (p) => addOutlets(p, room.id, placed.map((x) => ({ outlet: x }))),
    });
  }

  // B) vorhandene Einzelsteckdosen erweitern (spart Leitungsweg)
  const singles = room.outlets.filter((o) => o.kind === 'steckdose' && o.mount === 'wand' && o.gangs < 3 && o.status !== 'bestand_entfaellt');
  if (singles.length) {
    const grow: { id: string; label: string; add: number }[] = [];
    let rest = need;
    for (const o of singles) {
      if (rest <= 0) break;
      const add = Math.min(rest, 3 - o.gangs);
      grow.push({ id: o.id, label: o.label, add });
      rest -= add;
    }
    if (rest <= 0) {
      out.push({
        id: 'erweitern',
        label: `${grow.map((g) => g.label).join(', ')} um ${grow.reduce((s, g) => s + g.add, 0)} Steckdose${need === 1 ? '' : 'n'} erweitern (Mehrfachkombination)`,
        detail: 'Kein zusätzlicher Leitungsweg nötig – nur größere Dosenkombination.',
        apply: (p) => {
          for (const g of grow) {
            const x = outletIn(p, room.id, g.id);
            if (!x) continue;
            x.gangs += g.add;
            for (let i = 0; i < g.add; i++) x.inserts.push(insert);
          }
        },
      });
    }
  }
  // Variante A zuerst, wenn der Raum bisher gar keine Steckdose hat
  return count(room) === 0 ? out : out.reverse();
}

function lightCandidates(project: Project, room: Room, n: number): FixProposal[] {
  const ap = isAp(room);
  const b = bbox(room.polygon);
  const W = b.maxX - b.minX, D = b.maxY - b.minY;
  const cols = W >= D ? Math.min(n, Math.max(1, Math.round(Math.sqrt(n * W / D)))) : Math.max(1, Math.ceil(n / Math.max(1, Math.round(Math.sqrt(n * D / W)))));
  const rows = Math.ceil(n / cols);
  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols && pts.length < n; c++) pts.push({ x: Math.round(b.minX + (W * (c + 0.5)) / cols), y: Math.round(b.minY + (D * (r + 0.5)) / rows) });
  const ceilingOk = room.ceiling.drillingAllowed || room.ceiling.cavityDepth > 0 || ap;
  const out: FixProposal[] = [];
  const box = room.ceiling.cavityDepth > 0 ? 'decke_hohl' : ap ? 'aufputz' : 'decke_beton';
  if (ceilingOk) {
    const list = pts.map((pt) => ({ outlet: { id: newId('o'), label: '?', kind: 'licht_decke', mount: 'decke', x: pt.x, y: pt.y, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: box, inserts: [], controls: [], smart: false, status: 'neu', note: 'Licht (Lösungsvorschlag)' } as Outlet }));
    out.push({ id: 'decke', label: n === 1 ? 'Deckenauslass in Raummitte setzen' : `${n} Deckenauslässe gleichmäßig verteilen`, detail: pts.map((p) => `x ${p.x} / y ${p.y} cm`).join(' · ') + ' – Schalter danach zuordnen.', apply: (p) => addOutlets(p, room.id, list) });
  }
  // Wandleuchte als Alternative (z. B. wenn die Decke nicht angebohrt werden darf)
  const w = [...wallGeoms(room)].sort((a, c) => c.length - a.length)[0];
  if (w) {
    const z = ffbToZ(room, 200); // übliche Höhe Wandauslass Licht
    const s = findFreeS(room, w.index, w.length / 2, 5, z);
    if (s != null) {
      const o = { id: newId('o'), label: '?', kind: 'licht_wand', mount: 'wand', wallIndex: w.index, s, z: Math.round(z * 10) / 10, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: ap ? 'aufputz' : 'up_tief', inserts: ['geraeteanschluss'], controls: [], smart: false, status: 'neu', note: 'Wandleuchte (Lösungsvorschlag)' } as Outlet;
      out.push({ id: 'wand', label: `Wandleuchte setzen: ${where(room, o)}`, detail: ceilingOk ? undefined : 'Decke darf nicht angebohrt werden und hat keinen Hohlraum.', apply: (p) => addOutlets(p, room.id, [{ outlet: o }]) });
    }
  }
  return out;
}

function smokeCandidates(project: Project, room: Room): FixProposal[] {
  const b = bbox(room.polygon);
  // Raummitte; mind. 50 cm von Wänden (DIN 14676) – bei schmalen Fluren Mitte der Breite
  const x = Math.round((b.minX + b.maxX) / 2), y = Math.round((b.minY + b.maxY) / 2);
  const o = { id: newId('o'), label: '?', kind: 'rauchwarnmelder', mount: 'decke', x, y, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'aufputz', inserts: [], controls: [], smart: false, status: 'neu', note: 'Rauchwarnmelder (Batterie 10 Jahre oder vernetzt), mind. 50 cm von Wand/Möbel' } as Outlet;
  const fromSuggest = suggestOutlets(project, room).find((s) => s.outlet.kind === 'rauchwarnmelder');
  const use = fromSuggest?.outlet ?? o;
  return [{ id: 'rwm', label: `Rauchwarnmelder an die Decke setzen (x ${fmt(use.x, 0)} / y ${fmt(use.y, 0)} cm)`, detail: 'Raummitte, mind. 50 cm Abstand zu Wänden und Einrichtung (DIN 14676). Batteriegerät braucht keine Leitung.', apply: (p) => addOutlets(p, room.id, [{ outlet: use }]) }];
}

function circuitFromFinding(project: Project, f: RuleFinding): Circuit | undefined {
  const byRef = f.ref ? project.circuits.find((c) => c.label === f.ref) : undefined;
  if (byRef) return byRef;
  const m = f.message.match(/Stromkreis (\S+)/) ?? f.message.match(/^(\S+) /);
  return m ? project.circuits.find((c) => c.label === m[1]) : undefined;
}

function rcdCandidates(project: Project, c: Circuit): FixProposal[] {
  const d = project.distributions.find((x) => x.id === c.distributionId) ?? project.distributions[0];
  if (!d) return [];
  const out: FixProposal[] = [];
  const max = normValue(project, 'stromkreis.maxJeRcd');
  const usage = (id: string) => project.circuits.filter((x) => x.rcdId === id).length;
  const rcds = d.rcds.filter((r) => !/wallbox/i.test(r.label)).sort((a, b) => usage(a.id) - usage(b.id));
  for (const r of rcds) {
    if (usage(r.id) >= max) continue;
    out.push({ id: `rcd:${r.id}`, label: `${c.label} an „${r.label}“ anschließen (dann ${usage(r.id) + 1} Kreise)`, apply: (p) => { const x = p.circuits.find((y) => y.id === c.id); if (x) x.rcdId = r.id; } });
  }
  const nid = newId('rcd');
  out.push({
    id: 'rcd:neu', label: `Neuen FI/RCD 40 A / 30 mA in „${d.name}“ für ${c.label} vorsehen`,
    detail: 'Braucht 4 TE in der Verteilung (bzw. FI/LS-Kombi 2 TE je Kreis).',
    apply: (p) => {
      const dist = p.distributions.find((x) => x.id === d.id);
      const x = p.circuits.find((y) => y.id === c.id);
      if (!dist || !x) return;
      dist.rcds.push({ id: nid, label: `FI ${dist.rcds.length + 1} (neu)`, ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: false });
      x.rcdId = nid;
    },
  });
  return out;
}

function wallboxRcd(project: Project, c: Circuit): FixProposal {
  const d = project.distributions.find((x) => x.id === c.distributionId) ?? project.distributions[0];
  const nid = newId('rcd');
  return {
    id: 'rcd:wallbox', label: `Eigenen FI für die Wallbox (${c.label}) vorsehen`,
    detail: 'Typ nach Herstellerangabe: Typ A reicht nur, wenn die Wallbox DC-Fehlerströme selbst erkennt, sonst Typ B – Elektrofachkraft legt fest.',
    apply: (p) => {
      const dist = p.distributions.find((x) => x.id === d?.id);
      const x = p.circuits.find((y) => y.id === c.id);
      if (!dist || !x) return;
      dist.rcds.push({ id: nid, label: 'FI Wallbox (Typ nach Wallbox: A + DC-Erkennung oder B)', ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: false });
      x.rcdId = nid;
    },
  };
}

/** NYM-J 3×1,5 → 3×2,5 → 3×4 → 3×6 → 3×10 */
export function upsizeCable(cable: string): string | null {
  const m = cable.match(/^(.*?)(\d+)\s*[×x]\s*([\d,]+)(.*)$/);
  if (!m) return null;
  const steps = ['1,5', '2,5', '4', '6', '10', '16'];
  const i = steps.indexOf(m[3]);
  if (i < 0 || i === steps.length - 1) return null;
  return `${m[1]}${m[2]}×${steps[i + 1]}${m[4]}`;
}

function doorSwingCandidates(room: Room): FixProposal[] {
  return room.doors.filter((d) => d.swing === 'innen').flatMap((d) => [
    { id: `bandseite:${d.id}`, label: `Tür in ${wallName(room, d.wallIndex)}: Bänder ${d.hinge === 'links' ? 'rechts' : 'links'} (Anschlag tauschen)`, detail: 'Türblatt schlägt dann zur anderen Seite auf – Schalter wandert auf die neue Griffseite.', apply: (p: Project) => { const x = roomOf(p, room.id)?.doors.find((y) => y.id === d.id); if (x) x.hinge = x.hinge === 'links' ? 'rechts' : 'links'; } },
    { id: `aussen:${d.id}`, label: `Tür in ${wallName(room, d.wallIndex)}: nach außen aufschlagen lassen`, apply: (p: Project) => { const x = roomOf(p, room.id)?.doors.find((y) => y.id === d.id); if (x) x.swing = 'aussen'; } },
  ]);
}

export { boxCenters };
