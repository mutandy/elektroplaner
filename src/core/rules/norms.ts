/**
 * Normmodule (Etappe 4). Tabellenwerte sind aus allgemein zugänglichen
 * Darstellungen von DIN VDE 0298-4 / DIN VDE 0100-520 übernommen (Kupfer,
 * PVC 70 °C, 30 °C Umgebung) – vom Elektriker zu bestätigen.
 */
import type { Circuit, Outlet, Project, Room } from '../model/schema';
import { fmt, pointOnWall, zToFfb, futureBuildup } from '../geometry/room';
import { ROOM_TYPE_INFO } from '../model/roomTypes';
import { outletKindLabel } from '../model/labels';
import { roomArea } from '../geometry/room';
import { cableById } from '../planning/cables';
import { computeAllRoutes, type RoomRoutes } from '../planning/routes';
import { circuitCapacity, circuitPower, projectDemand, kw } from '../planning/loads';
import { normValue } from './normValues';
import type { Rule, Severity } from './types';
import { lightingEstimate } from '../planning/lighting';
import { wallGeoms } from '../geometry/room';

// ---------------------------------------------------------------------------
// Strombelastbarkeit
// ---------------------------------------------------------------------------

export type LayingMethod = 'A1' | 'B1' | 'B2' | 'C';
export const LAYING_LABEL: Record<LayingMethod, string> = {
  A1: 'A1 (in wärmegedämmter Wand)', B1: 'B1 (Einzeladern im Rohr)', B2: 'B2 (mehradrig im Rohr/Kanal)', C: 'C (direkt im/auf Mauerwerk, unter Putz)',
};
/** Iz in A: [Querschnitt] → [2 belastete Adern, 3 belastete Adern] */
const IZ: Record<LayingMethod, Record<number, [number, number]>> = {
  A1: { 1.5: [15.5, 13.5], 2.5: [19.5, 18], 4: [26, 24], 6: [34, 31], 10: [46, 42] },
  B1: { 1.5: [17.5, 15.5], 2.5: [24, 21], 4: [32, 28], 6: [41, 36], 10: [57, 50] },
  B2: { 1.5: [16.5, 15], 2.5: [23, 20], 4: [30, 27], 6: [38, 34], 10: [52, 46] },
  C: { 1.5: [19.5, 17.5], 2.5: [27, 24], 4: [36, 32], 6: [46, 41], 10: [63, 57] },
};
/** Häufung: einlagig auf Wand/Boden (Schlitz, nebeneinander) bzw. gebündelt im Rohr */
const GROUP_FLAT = [1, 0.85, 0.79, 0.75, 0.73, 0.72, 0.72, 0.71, 0.7];
const GROUP_BUNDLE = [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5];
export const groupFactor = (n: number, bundled: boolean) => (bundled ? GROUP_BUNDLE : GROUP_FLAT)[Math.min(n, 9) - 1] ?? (bundled ? 0.5 : 0.7);

export function iz(method: LayingMethod, crossSection: number, threePhase: boolean): number | null {
  const row = IZ[method][crossSection];
  return row ? row[threePhase ? 1 : 0] : null;
}

export interface CircuitCapacityCheck {
  circuit: Circuit;
  method: LayingMethod;
  grouped: number;
  bundled: boolean;
  izBase: number | null;
  izReduced: number | null;
}

/** Ungünstigster Abschnitt je Stromkreis: Verlegeart + Anzahl Stromkreise im selben Schlitz/Rohr. */
export function capacityChecks(project: Project, routes: Map<string, RoomRoutes> = computeAllRoutes(project)): CircuitCapacityCheck[] {
  const res: CircuitCapacityCheck[] = [];
  for (const c of project.circuits) {
    const cs = cableById(c.cable).crossSection;
    if (!cs) continue;
    let worst: CircuitCapacityCheck | null = null;
    for (const room of project.rooms.filter((r) => r.inScope)) {
      const rr = routes.get(room.id);
      if (!rr) continue;
      const circuitOf = (label: string) => room.outlets.find((o) => o.label === label)?.circuitId;
      const segs: { cables: string[]; method: LayingMethod; bundled: boolean }[] = [
        ...rr.floorSlots.map((f) => ({ cables: f.cables, method: (f.inCavity ? 'B2' : 'C') as LayingMethod, bundled: false })),
        ...rr.wallSlots.map((w) => ({ cables: w.cables, method: 'C' as LayingMethod, bundled: false })),
        ...rr.surfaceRuns.map((a) => ({ cables: a.cables, method: 'B2' as LayingMethod, bundled: true })),
        ...rr.ceilingRuns.map((a) => ({ cables: a.cables, method: 'B2' as LayingMethod, bundled: true })),
      ];
      for (const sg of segs) {
        const circuits = new Set(sg.cables.map(circuitOf).filter(Boolean));
        if (!circuits.has(c.id)) continue;
        const base = iz(sg.method, cs, c.poles === 3);
        if (base == null) continue;
        const red = base * groupFactor(circuits.size, sg.bundled);
        if (!worst || (worst.izReduced ?? Infinity) > red) worst = { circuit: c, method: sg.method, grouped: circuits.size, bundled: sg.bundled, izBase: base, izReduced: Math.round(red * 10) / 10 };
      }
    }
    if (!worst) {
      const base = iz('C', cs, c.poles === 3);
      worst = { circuit: c, method: 'C', grouped: 1, bundled: false, izBase: base, izReduced: base };
    }
    res.push(worst);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Bad-Schutzbereiche
// ---------------------------------------------------------------------------

const isBath = (r: Room) => r.roomType === 'bad' || r.roomType === 'wc' || (r.wetRoom && /bad|dusche/i.test(`${r.name} ${r.usage}`));

function outletPlanPoint(room: Room, o: Outlet) {
  if (o.mount === 'wand' && o.wallIndex != null && o.s != null) return pointOnWall(room, o.wallIndex, o.s);
  if (o.x != null && o.y != null) return { x: o.x, y: o.y };
  return null;
}

function distToRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; d: number }) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.d));
  return Math.hypot(dx, dy);
}

/** Schutzbereich 1/2 oder außerhalb (null) für einen Auslass. */
export function bathZone(project: Project, room: Room, o: Outlet): { zone: 1 | 2; fixture: string } | null {
  const p = outletPlanPoint(room, o);
  if (!p) return null;
  const h = o.mount === 'wand' && o.z != null ? zToFfb(room, o.z) : room.height - futureBuildup(room);
  if (h > normValue(project, 'bad.hoehe')) return null;
  for (const f of room.furniture.filter((x) => x.kind === 'dusche' || x.kind === 'badewanne')) {
    const d = distToRect(p, f);
    // Bodengleiche Dusche ohne Wanne: Bereich 1 reicht bis 120 cm um den Brausekopf – hier vereinfacht ab Duschfläche
    if (d <= 0.5) return { zone: 1, fixture: f.label || f.kind };
    if (d <= normValue(project, 'bad.bereich2')) return { zone: 2, fixture: f.label || f.kind };
  }
  return null;
}

// ---------------------------------------------------------------------------

const ownCircuitOutlets = (project: Project, c: Circuit) => project.rooms.flatMap((r) => r.outlets.filter((o) => o.circuitId === c.id).map((o) => ({ r, o })));

export const NORM_RULES: Rule[] = [
  {
    id: 'VDE0100-701.SCHUTZBEREICHE',
    title: 'Bad: Schutzbereiche 1 und 2',
    source: 'DIN VDE 0100-701:2008-10',
    confirm: true,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isBath(room) || o.status === 'bestand_entfaellt') return [];
      const z = bathZone(ctx.project, room, o);
      if (!z) return [];
      const forbidden = ['steckdose', 'schalter', 'taster', 'starkstrom', 'lan', 'anschlussdose'].includes(o.kind) && !/lüfter|luefter/i.test(o.note);
      if (forbidden && (o.kind !== 'anschlussdose' || z.zone === 1)) {
        return [{ severity: 'fehler' as Severity, message: `${o.label} (${outletKindLabel[o.kind]}) liegt in Schutzbereich ${z.zone} (${z.fixture}). Dort sind Steckdosen und Schalter nicht zulässig (Ausnahmen nur SELV/Schutztrennung) – Position mind. ${fmt(normValue(ctx.project, 'bad.bereich2'))} cm vom Rand von Wanne/Dusche oder über ${fmt(normValue(ctx.project, 'bad.hoehe'))} cm.` }];
      }
      return [{ severity: 'hinweis' as Severity, message: `${o.label} liegt in Schutzbereich ${z.zone} (${z.fixture}): Betriebsmittel mind. IPX4${z.zone === 1 ? ', fest angeschlossen' : ''}.` }];
    },
  },
  {
    id: 'VDE0100-701.RCD',
    title: 'Bad: alle Stromkreise über RCD 30 mA',
    source: 'DIN VDE 0100-701:2008-10, 701.415.1',
    confirm: true,
    scope: 'raum',
    check: (ctx, room) => {
      if (!room || !isBath(room)) return [];
      const ids = [...new Set(room.outlets.map((o) => o.circuitId).filter(Boolean))] as string[];
      return ctx.project.circuits.filter((c) => ids.includes(c.id) && !c.rcdId).map((c) => ({ severity: 'fehler' as Severity, message: `${room.name}: Stromkreis ${c.label} versorgt das Bad, hat aber keinen RCD 30 mA (gilt auch für Licht und Lüfter).` }));
    },
  },
  {
    id: 'VDE0100-520.BELASTBARKEIT',
    title: 'Strombelastbarkeit nach Verlegeart und Häufung',
    source: 'DIN VDE 0100-520 / DIN VDE 0298-4 (Tab. 3, 21)',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const out: { severity: Severity; message: string; ref?: string }[] = [];
      for (const k of capacityChecks(ctx.project)) {
        if (k.izReduced == null) continue;
        const c = k.circuit;
        const txt = `${c.label} (${c.name}): ${c.characteristic}${c.ratedCurrent} an ${c.cable}, ungünstigster Abschnitt ${k.method}${k.grouped > 1 ? ` mit ${k.grouped} Stromkreisen ${k.bundled ? 'gebündelt' : 'nebeneinander'} (Faktor ${fmt(groupFactor(k.grouped, k.bundled), 2)})` : ''} → Iz ≈ ${fmt(k.izReduced)} A`;
        if (c.ratedCurrent > k.izReduced) out.push({ severity: 'fehler', ref: c.label, message: `${txt} < In ${c.ratedCurrent} A. Größerer Querschnitt, kleinerer LS oder Leitungen trennen.` });
        else if (c.ratedCurrent > k.izReduced * 0.95) out.push({ severity: 'hinweis', ref: c.label, message: `${txt} – knapp; Umgebungstemperatur/Wärmedämmung prüfen.` });
      }
      return out;
    },
  },
  {
    id: 'VDE0100-420.AFDD',
    title: 'Brandschutzschalter (AFDD) für Schlafräume',
    source: 'DIN VDE 0100-420:2019-10',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const out: { severity: Severity; message: string; ref?: string }[] = [];
      for (const c of ctx.project.circuits) {
        if (c.afdd) continue;
        const rooms = [...new Set(ownCircuitOutlets(ctx.project, c).map(({ r }) => r))].filter((r) => r.roomType && ROOM_TYPE_INFO[r.roomType].afdd);
        if (rooms.length) out.push({ severity: 'hinweis', ref: c.label, message: `${c.label} versorgt ${rooms.map((r) => r.name).join(', ')} (Schlafraum): AFDD empfohlen; Pflicht in bestimmten Fällen (z. B. Holzbauweise, Räume mit erhöhter Brandgefahr, Barrierefreiheit) – Elektrofachkraft entscheidet.` });
      }
      return out;
    },
  },
  {
    id: 'VDE0100-443.SPD',
    title: 'Überspannungsschutz',
    source: 'DIN VDE 0100-443:2016-10 / DIN VDE 0100-534:2016-10',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      if (ctx.project.distributions.some((d) => d.hasSpd)) return [];
      const sev: Severity = ctx.project.projectType === 'teilsanierung' ? 'hinweis' : 'warnung';
      return [{ severity: sev, message: `Kein Überspannungsschutz (SPD) vorgesehen. Bei Neubau und wesentlicher Änderung der Anlage gefordert; Typ 1+2 am Zählerplatz/HV, Typ 2 in Unterverteilungen mit langer Zuleitung.` }];
    },
  },
  {
    id: 'VDE0100-722.EMOBILITAET',
    title: 'Ladeeinrichtung E-Fahrzeug',
    source: 'DIN VDE 0100-722:2019-06 / TAR Niederspannung (VDE-AR-N 4100)',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const out: { severity: Severity; message: string; ref?: string }[] = [];
      for (const room of ctx.project.rooms) for (const o of room.outlets.filter((x) => /wallbox|ladestation/i.test(x.note) || room.loads.some((l) => l.outletId === x.id && /wallbox/i.test(l.label)))) {
        const c = ctx.project.circuits.find((x) => x.id === o.circuitId);
        if (!c) { out.push({ severity: 'warnung', message: `${o.label} (Wallbox) hat noch keinen Stromkreis.` }); continue; }
        if (ownCircuitOutlets(ctx.project, c).length > 1) out.push({ severity: 'fehler', ref: c.label, message: `Wallbox ${o.label}: Stromkreis ${c.label} versorgt noch weitere Auslässe – Ladepunkt braucht einen eigenen Stromkreis.` });
        const rcd = ctx.project.distributions.flatMap((d) => d.rcds).find((r) => r.id === c.rcdId);
        if (!rcd) out.push({ severity: 'fehler', ref: c.label, message: `Wallbox ${o.label}: kein RCD zugeordnet.` });
        else if (!/typ b|dc|wallbox/i.test(`${rcd.label} ${rcd.type}`)) out.push({ severity: 'hinweis', ref: c.label, message: `Wallbox ${o.label}: RCD Typ A nur zulässig, wenn die Wallbox DC-Fehlerströme > 6 mA selbst erkennt (sonst Typ B).` });
        const p = room.loads.find((l) => l.outletId === o.id)?.power ?? 11000;
        out.push({ severity: 'hinweis', ref: c.label, message: `Wallbox ${o.label} (${kw(p)}): ${p > 12000 ? 'Genehmigung' : 'Anmeldung'} beim Netzbetreiber vor Inbetriebnahme.` });
      }
      return out;
    },
  },
  {
    id: 'ERDVERLEGUNG',
    title: 'Erdverlegte Leitungen',
    source: 'DIN VDE 0100-520 / DIN 18015-1 / VDE 0276-603',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const out: { severity: Severity; message: string; ref?: string }[] = [];
      for (const c of ctx.project.circuits) {
        const garden = ownCircuitOutlets(ctx.project, c).some(({ o, r }) => r.roomType === 'aussen' || /garten|erdkabel|außenverteil|aussenverteil/i.test(o.note));
        if (!garden) continue;
        if (c.cable.startsWith('NYM')) out.push({ severity: 'fehler', ref: c.label, message: `${c.label} (${c.name}) führt in den Außenbereich: NYM ist nicht für Erdverlegung zugelassen – NYY-J verwenden.` });
        else if (c.cable.startsWith('NYY')) out.push({ severity: 'hinweis', ref: c.label, message: `${c.label}: Erdkabel ca. 60–80 cm tief (frostfrei), im Sandbett, Warnband ca. 20–30 cm darüber, unter Wegen im Schutzrohr; Reserve-Leerrohr mitlegen; Lage einmessen.` });
      }
      return out;
    },
  },
  {
    id: 'LEISTUNG.STROMKREIS',
    title: 'Anschlussleistung je Stromkreis',
    source: 'Plausibilität / DIN 18015-1',
    confirm: false,
    scope: 'projekt',
    check: (ctx) => ctx.project.circuits.flatMap((c) => {
      const p = circuitPower(ctx.project, c);
      const cap = circuitCapacity(c);
      return p > cap ? [{ severity: 'warnung' as Severity, ref: c.label, message: `${c.label} (${c.name}): Verbraucher ${kw(p)} > Belastbarkeit ${kw(cap)} (${c.characteristic}${c.ratedCurrent}). Verbraucher aufteilen oder Kreis anders dimensionieren.` }] : [];
    }),
  },
  {
    id: 'LEISTUNG.GESAMT',
    title: 'Gleichzeitiger Leistungsbedarf gegen Hauptsicherung',
    source: 'DIN 18015-1 (Bemessung) – Schätzung',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const d = projectDemand(ctx.project);
      if (!d.installed) return [];
      if (!d.mainFuse) return [{ severity: 'hinweis' as Severity, message: `Leistungsbedarf geplant: ${kw(d.installed)} installiert, ca. ${kw(d.simultaneous)} gleichzeitig. Hauptsicherung nicht erfasst – Abgleich durch die Elektrofachkraft.` }];
      if (d.ratio! > 0.8) return [{ severity: 'warnung' as Severity, message: `Gleichzeitiger Bedarf ca. ${kw(d.simultaneous)} = ${fmt(d.ratio! * 100, 0)} % der Hauptsicherung (${kw(d.mainFuse.watts)}). Lastmanagement (z. B. Wallbox) oder Hausanschluss prüfen.` }];
      return [];
    },
  },
  {
    id: 'LEISTUNG.ZUORDNUNG',
    title: 'Großverbraucher haben einen Anschluss',
    source: 'Planungsablauf',
    confirm: false,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      const missing = room.loads.filter((l) => l.dedicated && !(l.outletId && room.outlets.some((o) => o.id === l.outletId)));
      return missing.length ? [{ severity: 'hinweis' as Severity, message: `${room.name}: ${missing.map((l) => `${l.label} (${kw(l.power)})`).join(', ')} noch ohne Anschluss – Vorschlag unter „Auslässe“ übernehmen.` }] : [];
    },
  },
  {
    id: 'DIN18015-2.AUSSTATTUNG',
    title: 'Mindestausstattung nach Raumtyp',
    source: 'DIN 18015-2 / RAL-RG 678',
    confirm: true,
    scope: 'raum',
    check: (ctx, room) => {
      if (!room || !room.roomType) return [];
      const info = ROOM_TYPE_INFO[room.roomType];
      const area = roomArea(room);
      const sockets = room.outlets.filter((o) => o.status !== 'bestand_entfaellt').reduce((s, o) => s + o.inserts.filter((i) => i.startsWith('steckdose')).length, 0);
      const lights = room.outlets.filter((o) => (o.kind === 'licht_decke' || o.kind === 'licht_wand') && o.status !== 'bestand_entfaellt').length;
      const level = ctx.project.equipmentLevel;
      const f = level === 1 ? 1 : level === 2 ? 1.5 : 2;
      const minS = info.minSockets(area), minL = info.minLights(area);
      const out: { severity: Severity; message: string }[] = [];
      if (sockets < minS) out.push({ severity: 'warnung', message: `${room.name} (${info.label}, ${fmt(area, 1)} m²): ${sockets} Steckdosen, Mindestausstattung ${minS}.` });
      else if (sockets < Math.ceil(minS * f)) out.push({ severity: 'hinweis', message: `${room.name}: ${sockets} Steckdosen – für Ausstattungswert ${level} etwa ${Math.ceil(minS * f)} empfohlen.` });
      if (lights < minL) out.push({ severity: 'hinweis', message: `${room.name}: ${lights} Lichtauslass/-auslässe, mindestens ${minL} empfohlen.` });
      return out;
    },
  },
];

NORM_RULES.push(
  {
    id: 'BELEUCHTUNG.ABSCHAETZUNG',
    title: 'Lichtstrom je Raum (Abschätzung)',
    source: 'DIN EN 12464-1 / Wohnpraxis – Richtwert',
    confirm: false,
    scope: 'raum',
    check: (ctx, room) => {
      if (!room || !room.roomType || room.roomType === 'heimkino') return [];
      const e = lightingEstimate(ctx.project, room);
      if (e.existing >= e.recommended) return [];
      return [{ severity: 'hinweis' as Severity, message: `${room.name}: für ca. ${e.lux} lx auf ${fmt(e.area, 1)} m² rund ${fmt(e.lumenNeeded, 0)} lm nötig – etwa ${e.recommended} Leuchten à ${fmt(e.perLuminaire, 0)} lm, geplant ${e.existing} Lichtauslass/-auslässe (Spots/Lichtband zählen je Auslass; Leuchtenstärke anpassen).` }];
    },
  },
  {
    id: 'ABSTAND.TUERAUFSCHLAG',
    title: 'Möbel und Einbauten nicht im Türaufschlag',
    source: 'Praxisregel / DIN 18040 (Bewegungsflächen) sinngemäß',
    confirm: false,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      const ws = wallGeoms(room);
      const out: { severity: Severity; message: string }[] = [];
      for (const d of room.doors.filter((x) => x.swing === 'innen')) {
        const w = ws[d.wallIndex];
        if (!w) continue;
        const hingeS = d.hinge === 'links' ? d.s : d.s + d.width;
        const toOpen = d.hinge === 'links' ? 1 : -1;
        const H = { x: w.a.x + w.dir.x * hingeS, y: w.a.y + w.dir.y * hingeS };
        for (const it of [...room.furniture.map((f) => ({ ...f, name: f.label || f.kind })), ...room.obstacles.filter((o) => (o.zFrom ?? 0) < d.height).map((o) => ({ ...o, name: o.label || o.kind }))]) {
          // nächster Punkt des Rechtecks zum Bandpunkt
          const px = Math.max(it.x, Math.min(H.x, it.x + it.w));
          const py = Math.max(it.y, Math.min(H.y, it.y + it.d));
          const vx = px - H.x, vy = py - H.y;
          const dist = Math.hypot(vx, vy);
          const along = (vx * w.dir.x + vy * w.dir.y) * toOpen; // Richtung Öffnung
          const into = vx * w.normal.x + vy * w.normal.y; // in den Raum
          if (dist < d.width - 2 && along > -2 && into > -2) out.push({ severity: 'warnung', message: `${room.name}: „${it.name}“ steht im Aufschlag der Tür in Wand ${d.wallIndex + 1} (Türblatt ${fmt(d.width)} cm) – Tür lässt sich nicht ganz öffnen.` });
        }
      }
      return out;
    },
  },
);

export { isBath };
