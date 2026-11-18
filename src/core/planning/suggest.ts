/**
 * Auslass-Vorschläge aus Türen, Möbeln/Geräten, Nutzung und Ausstattungswert.
 * Vorschläge werden NICHT gespeichert – der Nutzer übernimmt, verschiebt oder
 * lehnt ab (abgelehnte Schlüssel stehen in room.dismissedSuggestions).
 *
 * Mengen und Höhen sind Praxiswerte in Anlehnung an DIN 18015-2 / RAL-RG 678;
 * sie ersetzen keine Bedarfsplanung, sondern geben einen Startpunkt.
 */
import type { Furniture, Outlet, Project, Room } from '../model/schema';
import { bbox, boxCenters, doorHandleSide, ffbToZ, outletExtent, suggestedSwitchS, wallGeoms } from '../geometry/room';
import { normValue } from '../rules/normValues';
import { newId } from '../model/factory';
import { runRules } from '../rules/rules';
import { produce } from 'immer';
import { kw } from './loads';
import { planTheater } from './theater';

export interface Suggestion {
  key: string;
  reason: string;
  outlet: Outlet;
  source: 'tuer' | 'moebel' | 'raum' | 'ausstattung' | 'verbraucher';
  /** Verbraucher, der beim Übernehmen mit dem Auslass verknüpft wird */
  loadId?: string;
}

type Partial0 = Omit<Outlet, 'id' | 'label' | 'controls' | 'smart' | 'status' | 'note' | 'orientation' | 'growth' | 'boxType' | 'inserts' | 'gangs'> & Partial<Outlet>;

const isAp = (r: Room) => r.installationType.startsWith('aufputz');
const H = (project: Project, room: Room, key: keyof Project['settings']['defaultHeights']) => {
  const h = { ...project.settings.defaultHeights, ...room.heightOverrides };
  return Math.round(ffbToZ(room, isAp(room) && (key === 'steckdose' || key === 'lan') ? h.aufputzKeller : h[key]) * 10) / 10;
};

/** Nächste zulässige Position auf einer Wand (Öffnungen, Türblatt, Fenster, Tabuzonen, Ecken meiden). */
export function findFreeS(room: Room, wallIndex: number, desired: number, halfWidth: number, z: number, minCorner = 15): number | null {
  const len = wallGeoms(room)[wallIndex]?.length ?? 0;
  const blocked: [number, number][] = [];
  for (const d of room.doors.filter((x) => x.wallIndex === wallIndex)) {
    blocked.push([d.s - 3, d.s + d.width + 3]);
    if (d.swing === 'innen' && z < d.height) blocked.push(d.hinge === 'links' ? [d.s - d.width, d.s] : [d.s + d.width, d.s + 2 * d.width]);
  }
  for (const w of room.windows.filter((x) => x.wallIndex === wallIndex && x.status !== 'wird_zugemauert')) if (z + 5 > w.sill - 3 && z - 5 < w.sill + w.height + 3) blocked.push([w.s - 3, w.s + w.width + 3]);
  for (const zn of room.walls[wallIndex].zones) if (zn.kind !== 'brandwand') blocked.push([zn.from - 2, zn.to + 2]);
  const ok = (s: number) => s - halfWidth >= minCorner - 4 && s + halfWidth <= len - minCorner + 4 && !blocked.some(([a, b]) => s + halfWidth > a && s - halfWidth < b);
  for (let d = 0; d <= len; d += 2.5) {
    if (ok(desired + d)) return Math.round((desired + d) * 10) / 10;
    if (ok(desired - d)) return Math.round((desired - d) * 10) / 10;
  }
  return null;
}

/** Wand, an der ein Möbel steht, und Bereich (s) des Möbels darauf. */
function furnitureOnWall(room: Room, f: Furniture): { wi: number; from: number; to: number } | null {
  const ws = wallGeoms(room);
  const corners = [{ x: f.x, y: f.y }, { x: f.x + f.w, y: f.y }, { x: f.x, y: f.y + f.d }, { x: f.x + f.w, y: f.y + f.d }];
  const cand = f.wallIndex != null ? [ws[f.wallIndex]] : ws;
  let best: { wi: number; from: number; to: number; dist: number } | null = null;
  for (const w of cand) {
    if (!w) continue;
    const ss = corners.map((c) => (c.x - w.a.x) * w.dir.x + (c.y - w.a.y) * w.dir.y);
    const dist = Math.min(...corners.map((c) => (c.x - w.a.x) * w.normal.x + (c.y - w.a.y) * w.normal.y));
    if (!best || dist < best.dist) best = { wi: w.index, from: Math.max(0, Math.min(...ss)), to: Math.min(w.length, Math.max(...ss)), dist };
  }
  return best && best.dist < 40 ? best : null;
}

const hasNear = (room: Room, kind: Outlet['kind'][], wi: number, s: number, z: number, tol = 40) =>
  room.outlets.some((o) => kind.includes(o.kind) && o.wallIndex === wi && o.s != null && o.z != null && Math.abs(o.s - s) < tol && Math.abs(o.z - z) < 40);

export function suggestOutlets(project: Project, room: Room): Suggestion[] {
  const out: Suggestion[] = [];
  const level = project.equipmentLevel;
  const add = (key: string, reason: string, source: Suggestion['source'], o: Partial0) => {
    if (room.dismissedSuggestions.includes(key) || out.some((x) => x.key === key)) return;
    const full: Outlet = {
      id: newId('v'), label: '?', controls: [], smart: false, status: 'neu', note: '', orientation: 'waagerecht', growth: 'rechts',
      boxType: isAp(room) ? 'aufputz' : 'up_tief', inserts: [], gangs: 1, ...o,
    } as Outlet;
    // Hohlwanddose, wenn der Platz in einer Vorwand liegt
    if (full.mount === 'wand' && full.wallIndex != null && full.s != null && full.z != null && !isAp(room)) {
      const pw = room.walls[full.wallIndex].preWall.find((p) => full.s! >= p.from && full.s! <= p.to && full.z! + 4 <= (p.height ?? room.height) - 5);
      if (pw) full.boxType = pw.construction === 'holz' ? 'aufputz_holz' : 'vorwand';
    }
    out.push({ key, reason, source, outlet: full });
  };
  const ws = wallGeoms(room);
  const zSD = H(project, room, 'steckdose');
  const zSW = H(project, room, 'schalter');
  const usage = `${room.name} ${room.usage} ${room.futureUsage}`.toLowerCase();

  // --- Türen: Schalter auf der Griffseite ---------------------------------------
  for (const d of room.doors) {
    if (!d.hasFrame && d.width > 200) continue; // Garagentor o. Ä.
    const s0 = suggestedSwitchS(d, normValue(project, 'schalter.abstandZarge'), normValue(project, 'schalter.abstandOhneZarge'));
    const already = room.outlets.some((o) => ['schalter', 'taster', 'bewegungsmelder'].includes(o.kind) && o.wallIndex === d.wallIndex && o.s != null && Math.abs(o.s - s0) < 60);
    if (already) continue;
    const s = findFreeS(room, d.wallIndex, s0, 4, zSW, 12);
    if (s == null) continue;
    const manyDoors = room.doors.length >= 3;
    add(`schalter:${d.id}`, `Schaltstelle an der Tür (Griffseite ${doorHandleSide(d)}, ${d.hasFrame ? 15 : 18} cm neben ${d.hasFrame ? 'Zarge' : 'Mauerkante'})${manyDoors ? ' – bei 3+ Schaltstellen Taster + Stromstoßschalter' : ''}`, 'tuer',
      { kind: manyDoors ? 'taster' : 'schalter', mount: 'wand', wallIndex: d.wallIndex, s, z: zSW, inserts: [manyDoors ? 'taster' : room.doors.length === 2 ? 'wechselschalter' : 'ausschalter'] });
  }

  // --- Licht ------------------------------------------------------------------------
  if (!room.outlets.some((o) => o.kind === 'licht_decke' || o.kind === 'licht_wand')) {
    const b = bbox(room.polygon);
    const ceilingOk = room.ceiling.drillingAllowed || room.ceiling.cavityDepth > 0 || isAp(room);
    if (ceilingOk) add('licht:mitte', 'Deckenauslass Raummitte (Pendel kann per Haken versetzt werden)', 'raum', { kind: 'licht_decke', mount: 'decke', x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2), boxType: isAp(room) ? 'aufputz' : room.ceiling.cavityDepth > 0 ? 'decke_hohl' : 'decke_beton' });
  }

  // --- Rauchwarnmelder ---------------------------------------------------------------
  if (/schlaf|kind|gäst|gaest|flur|diele/.test(usage) && !room.outlets.some((o) => o.kind === 'rauchwarnmelder')) {
    const b = bbox(room.polygon);
    add('rwm', 'Rauchwarnmelder (Landesbauordnung: Schlafräume, Kinderzimmer, Flure davor)', 'raum', { kind: 'rauchwarnmelder', mount: 'decke', x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2 + 30), boxType: 'aufputz' });
  }

  // --- Möbel und Geräte -------------------------------------------------------------
  for (const f of room.furniture) {
    const fw = furnitureOnWall(room, f);
    const mid = fw ? (fw.from + fw.to) / 2 : 0;
    const wall = (s: number, z: number, o: Partial<Outlet>, key: string, reason: string) => {
      if (!fw) return;
      const half = ((o.gangs ?? 1) * 7.1) / 2;
      const ss = findFreeS(room, fw.wi, s, half + 1, z);
      if (ss == null || hasNear(room, [o.kind ?? 'steckdose'], fw.wi, ss, z)) return;
      add(`${key}:${f.id}`, reason, 'moebel', { kind: 'steckdose', mount: 'wand', wallIndex: fw.wi, s: ss, z, ...o } as Partial0);
    };
    switch (f.kind) {
      case 'bett': {
        const zN = H(project, room, 'nachttisch');
        wall(fw ? fw.from - 25 : 0, zN, { gangs: 2, inserts: ['steckdose', 'steckdose_usb'], convention: 'mittig' }, 'bett-l', 'Nachttisch links: Steckdose mit USB (ca. 70 cm)');
        wall(fw ? fw.to + 25 : 0, zN, { gangs: 2, inserts: ['steckdose', 'steckdose_usb'], convention: 'mittig' }, 'bett-r', 'Nachttisch rechts: Steckdose mit USB (ca. 70 cm)');
        if (level >= 2) wall(fw ? fw.from - 25 : 0, zN + 20, { kind: 'schalter', inserts: ['ausschalter'] }, 'bett-schalter', 'Lichtschalter am Bett (Wechselschaltung mit Tür)');
        break;
      }
      case 'schreibtisch':
        wall(mid - 20, zSD, { gangs: 3, inserts: ['steckdose', 'steckdose', 'steckdose'], convention: 'mittig' }, 'tisch-sd', 'Schreibtisch: 3-fach Steckdose (Monitore, Rechner, Lampe)');
        wall(mid + 20, H(project, room, 'lan'), { kind: 'lan', inserts: ['lan_2fach'] }, 'tisch-lan', 'Schreibtisch: LAN 2-fach');
        break;
      case 'tv':
        wall(mid - 25, zSD, { gangs: 4, inserts: ['steckdose', 'steckdose', 'steckdose', 'steckdose'], convention: 'mittig' }, 'tv-sd', 'TV-Platz: 4-fach Steckdose');
        wall(mid + 25, zSD, { kind: 'lan', inserts: ['lan_2fach'] }, 'tv-lan', 'TV-Platz: LAN (Streaming)');
        break;
      case 'sofa':
        wall(fw ? fw.from - 20 : 0, zSD, { gangs: 2, inserts: ['steckdose', 'steckdose'] }, 'sofa', 'Neben dem Sofa: Steckdose (Leselampe, Laden)');
        break;
      case 'rack':
        wall(mid, zSD, { gangs: 4, inserts: ['steckdose', 'steckdose', 'steckdose', 'steckdose'], convention: 'mittig', note: 'Rack' }, 'rack-sd', 'Rack/Netzwerkschrank: 4-fach Steckdose, eigener Kreis empfohlen');
        wall(mid, zSD + 15, { kind: 'lan', inserts: ['lan_2fach'], note: 'Rack' }, 'rack-lan', 'Rack: LAN-Anbindung');
        break;
      case 'kuehlschrank':
      case 'side_by_side':
        wall(mid, Math.max(zSD, (f.height || 180) + 20), { note: 'Kühlschrank' }, 'kuehl', 'Kühlschrank: eigene Steckdose über/hinter dem Gerät (gut erreichbar)');
        break;
      case 'spuelmaschine':
        wall(mid, ffbToZ(room, 40), { note: 'Spülmaschine' }, 'spuel', 'Spülmaschine: Steckdose im Nachbarschrank (eigener Kreis)');
        break;
      case 'backofen':
        wall(mid, ffbToZ(room, 40), { kind: 'herd', inserts: ['geraeteanschluss'], note: 'Backofen/Herd' }, 'herd', 'Backofen/Kochfeld: Herdanschlussdose 5×2,5 (Drehstrom)');
        break;
      case 'waschmaschine':
      case 'trockner':
        wall(mid, ffbToZ(room, 105), { note: f.kind === 'trockner' ? 'Trockner' : 'Waschmaschine', inserts: ['steckdose_klappdeckel'] }, f.kind, `${f.kind === 'trockner' ? 'Trockner' : 'Waschmaschine'}: eigene Steckdose, eigener Kreis`);
        break;
      case 'waschtisch': {
        const z = Math.min(ffbToZ(room, 105), room.walls[fw?.wi ?? 0]?.preWall.find((p) => fw && mid >= p.from && mid <= p.to)?.height ? ((room.walls[fw!.wi].preWall.find((p) => mid >= p.from && mid <= p.to)!.height ?? 999) - 12) : 999);
        wall(fw ? fw.to + 15 : 0, z, { gangs: 2, inserts: ['steckdose', 'steckdose'] }, 'wt-sd', 'Waschtisch: 2-fach Steckdose seitlich (Föhn, Zahnbürste) – Schutzbereiche beachten');
        wall(mid, ffbToZ(room, 180), { kind: 'licht_wand', inserts: ['geraeteanschluss'] }, 'wt-licht', 'Spiegelleuchte über dem Waschtisch');
        break;
      }
      case 'werkbank':
        wall(mid, ffbToZ(room, 105), { gangs: 3, inserts: ['steckdose_klappdeckel', 'steckdose_klappdeckel', 'steckdose_klappdeckel'] }, 'werkbank', 'Werkbank: 3-fach Steckdose über der Arbeitsfläche (105 cm)');
        break;
      case 'kuechenzeile': {
        if (!fw) break;
        const zAF = H(project, room, 'kuecheArbeitsflaeche');
        const n = Math.max(1, Math.round((fw.to - fw.from) / (level >= 3 ? 100 : 130)));
        for (let i = 0; i < n; i++) {
          const s = fw.from + ((i + 0.5) * (fw.to - fw.from)) / n;
          wall(s, zAF, { gangs: 2, inserts: ['steckdose', 'steckdose'] }, `af${i}`, 'Arbeitsfläche: 2-fach Steckdose (ca. alle 1–1,3 m)');
        }
        wall(fw.from + 20, ffbToZ(room, 205), { note: 'Dunstabzug' }, 'dunst', 'Dunstabzug: Steckdose/Anschluss oben');
        wall((fw.from + fw.to) / 2, ffbToZ(room, 150), { kind: 'licht_wand', inserts: ['geraeteanschluss'], note: 'Unterbauleuchte' }, 'ubl', 'Unterbauleuchte: Auslass hinter dem Oberschrank');
        break;
      }
      case 'beamer':
        if (room.theater) break;
        add(`beamer:${f.id}`, 'Beamer: Deckensteckdose + Signalweg (HDMI-Glasfaser ohne Leerrohr-Engpass)', 'moebel', { kind: 'steckdose', mount: 'decke', x: f.x + f.w / 2, y: f.y + f.d / 2, boxType: room.ceiling.cavityDepth > 0 ? 'decke_hohl' : 'decke_beton', inserts: ['steckdose'], note: 'Beamer' });
        break;
      case 'auto':
        if (!room.outlets.some((o) => /wallbox/i.test(o.note))) wall(fw ? fw.from + 120 : 0, ffbToZ(room, 125), { kind: 'festanschluss', inserts: [], note: 'Wallbox – Leitung direkt in die Wallbox (keine Anschlussdose), ca. 1 m Reserve', boxType: 'aufputz' }, 'wallbox', 'Wallbox: Festanschluss – Leitung 5×6 mm² (11 kW) direkt ins Gerät, eigener Kreis und RCD');
        break;
      case 'fitness':
        wall(mid, zSD, { gangs: 2, inserts: ['steckdose', 'steckdose'] }, 'fitness', 'Fitnessgerät: Steckdose');
        break;
    }
  }

  // --- Heimkino: Lautsprecher und Beamer nach Layout -------------------------------
  if (room.theater) {
    const tp = planTheater(project, room, room.theater);
    const items = [...tp.speakers.map((sp) => ({ ...sp, beamer: false })), ...(tp.projector ? [{ code: 'BEAMER', label: 'Beamer', mount: 'decke' as const, x: tp.projector.x, y: tp.projector.y, azimuth: 0, elevation: 0, ok: tp.projector.ok, note: tp.projector.note, beamer: true }] : [])];
    for (const sp of items) {
      if (room.outlets.some((o) => o.note.includes(`[${sp.code}]`))) continue;
      const sub = sp.code === 'SUB';
      const kind: Outlet['kind'] = sub || sp.beamer ? 'steckdose' : 'lautsprecher';
      const inserts: Outlet['inserts'] = kind === 'steckdose' ? ['steckdose'] : ['lautsprecher_klemme'];
      if (sp.mount === 'wand') add(`kino:${sp.code}`, `Heimkino ${room.theater.layout}: ${sp.label} (Azimut ${sp.azimuth}°${sp.elevation ? `, Elevation ${sp.elevation}°` : ''})${sp.note ? ' – ' + sp.note : ''}`, 'raum',
        { kind, mount: 'wand', wallIndex: sp.wallIndex, s: Math.round(sp.s! * 10) / 10, z: Math.round(sp.z! * 10) / 10, inserts, note: `[${sp.code}] ${sp.label}` });
      else add(`kino:${sp.code}`, `Heimkino ${room.theater.layout}: ${sp.label}${sp.elevation ? ` (Elevation ${sp.elevation}°)` : ''}${sp.note ? ' – ' + sp.note : ''}`, 'raum',
        { kind, mount: 'decke', x: sp.x, y: sp.y, inserts, boxType: room.ceiling.cavityDepth > 0 ? 'decke_hohl' : 'decke_beton', note: `[${sp.code}] ${sp.label}` });
    }
  }

  // --- Verbraucher ohne Anschluss (aus der Raumnutzung) -----------------------------
  const longest = [...ws].sort((a, b) => b.length - a.length);
  for (const l of room.loads) {
    if (l.outletId && room.outlets.some((o) => o.id === l.outletId)) continue;
    const word = l.label.split(/[ /(]/)[0].toLowerCase();
    if (word.length > 3 && room.outlets.some((o) => o.note.toLowerCase().includes(word))) continue;
    if (!l.dedicated && l.connection === 'steckdose') continue; // normale Steckdosen deckt die Raumausstattung ab
    const kind: Outlet['kind'] = l.connection === 'herd' ? 'herd' : l.connection === 'starkstrom' ? 'starkstrom' : l.connection === 'anschlussdose' ? 'anschlussdose' : l.connection === 'festanschluss' ? 'festanschluss' : 'steckdose';
    const z = Math.round(ffbToZ(room, l.height ?? (kind === 'steckdose' ? (isAp(room) ? 105 : 30) : kind === 'anschlussdose' || kind === 'festanschluss' ? 125 : 40)) * 10) / 10;
    let placed: { wi: number; s: number } | null = null;
    search: for (const w of longest) {
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const s = findFreeS(room, w.index, w.length * f, 5, z);
        const clash = (o: Outlet) => o.wallIndex === w.index && o.s != null && Math.abs(o.s - (s ?? 0)) < 25;
        if (s != null && !out.some((x) => clash(x.outlet)) && !room.outlets.some(clash)) { placed = { wi: w.index, s }; break search; }
      }
    }
    if (!placed) continue;
    const key = `last:${l.id}`;
    if (room.dismissedSuggestions.includes(key)) continue;
    out.push({
      key, source: 'verbraucher', loadId: l.id,
      reason: `${l.label} (${kw(l.power)}${l.phases === 3 ? ', Drehstrom' : ''}) – ${l.dedicated ? 'eigener Stromkreis' : 'eigener Anschluss'}; Lage bitte an Möbel/Gerät anpassen`,
      outlet: { id: newId('v'), label: '?', kind, mount: 'wand', wallIndex: placed.wi, s: placed.s, z, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: isAp(room) ? 'aufputz' : 'up_tief', inserts: kind === 'festanschluss' ? [] : [kind === 'steckdose' ? (isAp(room) ? 'steckdose_klappdeckel' : 'steckdose') : kind === 'starkstrom' ? 'sonstiges' : 'geraeteanschluss'], controls: [], smart: false, status: 'neu', note: kind === 'festanschluss' ? `${l.label} – Festanschluss: Leitung direkt ins Gerät, keine Anschlussdose` : l.label } as Outlet,
    });
  }

  // --- Raumausstattung: freie Wandabschnitte ohne Steckdose ------------------------
  const special = room.wetRoom || /bad|dusche|wc|küche|kueche|technik|heizung|abstell/.test(usage);
  const nebenraum = isAp(room);
  const anySocket = room.outlets.some((o) => o.kind === 'steckdose');
  if (!special && (!nebenraum || !anySocket)) {
    const every = nebenraum ? 10000 : /flur|diele/.test(usage) ? 500 : level === 1 ? 400 : level === 2 ? 300 : 220;
    for (const w of ws) {
      if (w.length < 120) continue;
      const sockets = room.outlets.filter((o) => o.kind === 'steckdose' && o.wallIndex === w.index).length + out.filter((x) => x.outlet.kind === 'steckdose' && x.outlet.wallIndex === w.index).length;
      const target = Math.max(0, Math.floor(w.length / every));
      if (sockets >= Math.max(1, target)) continue;
      const fill = Math.max(1, target) - sockets;
      for (let i = 0; i < fill; i++) {
        const s0 = ((i + 1) * w.length) / (fill + 1);
        const s = findFreeS(room, w.index, s0, 8, zSD);
        if (s == null || hasNear(room, ['steckdose'], w.index, s, zSD, 80) || out.some((x) => x.outlet.wallIndex === w.index && x.outlet.s != null && Math.abs(x.outlet.s - s) < 80)) continue;
        add(`wand:${w.index}:${i}`, `Wand ${w.index + 1} hat keine/zu wenig Steckdosen (Ausstattungswert ${level}: etwa alle ${every / 100} m)`, 'ausstattung', { kind: 'steckdose', mount: 'wand', wallIndex: w.index, s, z: zSD, gangs: 2, inserts: ['steckdose', 'steckdose'] });
      }
    }
  }

  // --- Bad: Lüfter, wenn kein Fenster ------------------------------------------------
  if (room.wetRoom && /bad|dusche|wc/.test(usage) && !room.windows.length && !room.outlets.some((o) => /lüfter|luefter/i.test(o.note))) {
    const w = ws.find((x) => !room.doors.some((d) => d.wallIndex === x.index)) ?? ws[0];
    const s = findFreeS(room, w.index, w.length / 2, 4, room.height - 25);
    if (s != null) add('luefter', 'Innenliegendes Bad: Lüfter mit Nachlauf (Dauerstrom + geschaltete Phase, 5-adrig)', 'raum', { kind: 'anschlussdose', mount: 'wand', wallIndex: w.index, s, z: room.height - 25, inserts: ['geraeteanschluss'], note: 'Lüfter' });
  }

  // Vorschläge, die eine Regel als Fehler melden würde, verwerfen
  return out.filter((sg) => {
    if (sg.outlet.mount !== 'wand') return true;
    const ext = outletExtent(sg.outlet, project.settings);
    if (!ext) return false;
    const test = produce(project, (d) => { const r = d.rooms.find((x) => x.id === room.id)!; r.outlets.push(sg.outlet as any); });
    return !runRules(test, { roomId: room.id }).findings.some((f) => f.outletId === sg.outlet.id && f.severity === 'fehler');
  });
}

/** Nächste freie Bezeichnung im Raum (Präfix der vorhandenen Auslässe). */
export function nextOutletLabel(room: Room, taken: string[] = []): string {
  const prefix = room.outlets[0]?.label.match(/^[A-Za-zÄÖÜäöü]+/)?.[0] ?? (room.name.replace(/[^A-Za-zÄÖÜ]/g, '').slice(0, 1).toUpperCase() || 'D');
  const used = new Set([...room.outlets.map((o) => o.label), ...taken]);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export { boxCenters };
