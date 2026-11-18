/**
 * Leitungslängen, Spannungsfall und automatischer Stromkreisvorschlag.
 * Alles aus Modell + berechneten Leitungswegen abgeleitet.
 */
import type { Circuit, Outlet, Project, Room } from '../model/schema';
import { bbox, fmt, pointOnWall, zToFfb } from '../geometry/room';
import { normValue } from '../rules/normValues';
import { cableById } from './cables';
import { computeAllRoutes, outletCable, type RoomRoutes } from './routes';
import { newId } from '../model/factory';
import { circuitForLoad, kw } from './loads';

// ---------------------------------------------------------------------------
// Geometrie zwischen Räumen (Schätzung über die Lage im Geschoss)
// ---------------------------------------------------------------------------

/** Höhenlage eines Geschosses (OK Rohboden) relativ zum Geschoss mit Ebene 0, aus den Geschosshöhen. */
export function floorElevation(project: Project, floorId: string): number {
  const f = project.floors.find((x) => x.id === floorId);
  if (!f) return 0;
  const byLevel = (lv: number) => project.floors.find((x) => x.level === lv)?.height ?? 275;
  let z = 0;
  if (f.level > 0) for (let lv = 0; lv < f.level; lv++) z += byLevel(lv);
  else for (let lv = f.level; lv < 0; lv++) z -= byLevel(lv);
  return z;
}

function globalPoint(project: Project, room: Room, p: { x: number; y: number }) {
  return { x: p.x + room.originOnFloor.x, y: p.y + room.originOnFloor.y, level: floorElevation(project, room.floorId) };
}

function roomCenter(project: Project, room: Room) {
  const b = bbox(room.polygon);
  return globalPoint(project, room, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
}

export function entryGlobal(project: Project, room: Room, rr: RoomRoutes) {
  return globalPoint(project, room, pointOnWall(room, rr.entry.wallIndex, rr.entry.s));
}

/** Leitungsweg zwischen zwei Punkten im Gebäude (rechtwinklig + Höhenunterschied der Geschosse + Auf/Ab im Raum). `level` = Höhenlage in cm. */
export function interRoomLength(a: { x: number; y: number; level: number }, b: { x: number; y: number; level: number }, roomHeight = 250) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.level - b.level) + roomHeight;
}

function distributionPoint(project: Project, distId: string) {
  const d = project.distributions.find((x) => x.id === distId);
  const room = d?.roomId ? project.rooms.find((r) => r.id === d.roomId) : undefined;
  return room ? roomCenter(project, room) : undefined;
}

function rackPoint(project: Project) {
  for (const r of project.rooms) {
    const rack = r.furniture.find((f) => f.kind === 'rack');
    if (rack && /netz|rack|router|switch/i.test(`${rack.label} ${project.network.rackLocation}`)) return globalPoint(project, r, { x: rack.x + rack.w / 2, y: rack.y + rack.d / 2 });
  }
  const loc = project.network.rackLocation.toLowerCase();
  const room = project.rooms.find((r) => loc && (loc.includes(r.name.toLowerCase()) || (r.formerName && loc.includes(r.formerName.toLowerCase()))));
  if (room) {
    const rack = room.furniture.find((f) => f.kind === 'rack');
    return rack ? globalPoint(project, room, { x: rack.x + rack.w / 2, y: rack.y + rack.d / 2 }) : roomCenter(project, room);
  }
  const hv = project.distributions.find((d) => d.kind === 'HV');
  return hv ? distributionPoint(project, hv.id) : undefined;
}

// ---------------------------------------------------------------------------
// Leitungen
// ---------------------------------------------------------------------------

export interface CableRun {
  id: string;
  cable: string;
  circuitId?: string;
  /** Beschriftung „von → nach“ */
  from: string;
  to: string;
  roomIds: string[];
  /** Länge in m inkl. Reserven und Zuschlag (gerundet auf 0,5 m) */
  length: number;
  /** Rohlänge ohne Reserven (m) */
  raw: number;
  kind: 'zuleitung' | 'verbindung' | 'stern' | 'raumverbindung';
  estimate: boolean;
}

export interface CircuitCalc {
  circuitId: string;
  lengthM: number; // Summe aller Leitungen des Stromkreises
  farthestM: number; // einfache Länge Verteilung → entferntester Auslass
  voltageDropPct: number | null;
  ok: boolean | null;
}

export interface Lengths {
  runs: CableRun[];
  circuits: CircuitCalc[];
  routes: Map<string, RoomRoutes>;
}

const round05 = (m: number) => Math.ceil(m * 2) / 2;

export function computeLengths(project: Project, routes = computeAllRoutes(project)): Lengths {
  const reserveBox = normValue(project, 'trasse.anschlussreserve');
  const reserveDist = normValue(project, 'trasse.verteilerreserve');
  const factor = 1 + normValue(project, 'trasse.zuschlag') / 100;
  const runs: CableRun[] = [];
  const add = (r: Omit<CableRun, 'id' | 'length' | 'raw'> & { rawCm: number; reserveCm: number }) => {
    const raw = r.rawCm / 100;
    runs.push({ ...r, id: `L${runs.length + 1}`, raw: Math.round(raw * 10) / 10, length: round05((r.rawCm * factor + r.reserveCm) / 100) });
  };
  const pathOf = (rr: RoomRoutes | undefined, o: Outlet) => rr?.paths.find((p) => p.outletId === o.id);

  // --- Stromkreise: Kette Verteilung → Raum → Auslass → Auslass …
  const calcs: CircuitCalc[] = [];
  for (const c of project.circuits) {
    const members = project.rooms.filter((r) => r.inScope).flatMap((r) => r.outlets.filter((o) => o.circuitId === c.id && o.status !== 'bestand_bleibt' && o.status !== 'bestand_entfaellt').map((o) => ({ r, o })));
    const distP = distributionPoint(project, c.distributionId);
    let total = 0;
    let farthest = 0;
    let prevGlobal: ReturnType<typeof globalPoint> | undefined = distP;
    let cumulative = 0;
    const roomsInOrder = [...new Set(members.map((m) => m.r.id))];
    // Nächstgelegenen Raum zuerst
    roomsInOrder.sort((a, b) => {
      const ra = project.rooms.find((r) => r.id === a)!, rb = project.rooms.find((r) => r.id === b)!;
      const pa = entryGlobal(project, ra, routes.get(a)!), pb = entryGlobal(project, rb, routes.get(b)!);
      return distP ? interRoomLength(distP, pa) - interRoomLength(distP, pb) : 0;
    });
    let first = true;
    for (const rid of roomsInOrder) {
      const room = project.rooms.find((r) => r.id === rid)!;
      const rr = routes.get(rid)!;
      const eg = entryGlobal(project, room, rr);
      const link = prevGlobal ? interRoomLength(prevGlobal, eg, room.height) : 1500;
      add({ cable: c.cable, circuitId: c.id, from: first ? (project.distributions.find((d) => d.id === c.distributionId)?.name ?? 'Verteilung') : 'vorheriger Raum', to: `${room.name} (Einspeisung)`, roomIds: [rid], rawCm: link, reserveCm: first ? reserveDist : 2 * reserveBox, kind: first ? 'zuleitung' : 'raumverbindung', estimate: true });
      total += link; cumulative += link;
      first = false;
      const ms = members.filter((m) => m.r.id === rid).map((m) => ({ ...m, p: pathOf(rr, m.o) })).filter((m) => m.p?.routed).sort((a, b) => a.p!.fromEntry - b.p!.fromEntry);
      let prev: (typeof ms)[number] | undefined;
      let roomCum = cumulative;
      for (const m of ms) {
        const seg = prev ? prev.p!.vertical + Math.abs(m.p!.along - prev.p!.along) + m.p!.vertical : m.p!.fromEntry;
        add({ cable: c.cable, circuitId: c.id, from: prev ? prev.o.label : `${room.name} Einspeisung`, to: m.o.label, roomIds: [rid], rawCm: seg, reserveCm: 2 * reserveBox, kind: 'verbindung', estimate: false });
        total += seg;
        roomCum += seg;
        farthest = Math.max(farthest, roomCum);
        prev = m;
      }
      cumulative = roomCum;
      prevGlobal = eg;
    }
    const lengthM = (total * factor) / 100;
    const farthestM = (farthest * factor) / 100;
    const cs = cableById(c.cable).crossSection;
    let drop: number | null = null;
    if (cs > 0 && farthestM > 0) {
      const kappa = normValue(project, 'spannungsfall.kappa');
      drop = c.poles === 3
        ? (Math.sqrt(3) * farthestM * c.ratedCurrent * 1) / (kappa * cs * 400) * 100
        : (2 * farthestM * c.ratedCurrent * 1) / (kappa * cs * 230) * 100;
      drop = Math.round(drop * 100) / 100;
    }
    calcs.push({ circuitId: c.id, lengthM: Math.round(lengthM * 10) / 10, farthestM: Math.round(farthestM * 10) / 10, voltageDropPct: drop, ok: drop == null ? null : drop <= normValue(project, 'spannungsfall.max') });
  }

  // --- Sternleitungen: LAN, Koax, Lautsprecher (zum Rack), Klingel
  const rackP = rackPoint(project);
  for (const room of project.rooms.filter((r) => r.inScope)) {
    const rr = routes.get(room.id)!;
    for (const o of room.outlets) {
      if (!['lan', 'tv_sat', 'lautsprecher', 'klingel'].includes(o.kind) || o.status === 'bestand_bleibt') continue;
      const p = pathOf(rr, o);
      if (!p?.routed) continue;
      const cable = outletCable(project, o);
      if (p.source === 'rack') {
        add({ cable, from: 'AV-Rack', to: o.label, roomIds: [room.id], rawCm: p.fromEntry, reserveCm: reserveBox + 100, kind: 'stern', estimate: false });
      } else {
        const eg = entryGlobal(project, room, rr);
        const toRack = rackP ? interRoomLength(rackP, eg, room.height) : 1500;
        const n = o.kind === 'lan' ? (o.inserts.includes('lan_2fach') ? 2 : 1) : 1;
        for (let i = 0; i < n; i++) add({ cable, from: 'Netzwerkschrank', to: n > 1 ? `${o.label} (${i + 1})` : o.label, roomIds: [room.id], rawCm: p.fromEntry + toRack, reserveCm: reserveBox + 150, kind: 'stern', estimate: true });
      }
    }
  }

  // --- Zuleitungen Unterverteilungen
  for (const d of project.distributions.filter((x) => x.kind === 'UV' && x.feedFromId && x.feedCable)) {
    const a = distributionPoint(project, d.feedFromId!);
    const b = distributionPoint(project, d.id);
    const raw = a && b ? interRoomLength(a, b) : 1500;
    add({ cable: d.feedCable, from: project.distributions.find((x) => x.id === d.feedFromId)?.name ?? 'HV', to: d.name, roomIds: d.roomId ? [d.roomId] : [], rawCm: raw, reserveCm: 2 * reserveDist, kind: 'zuleitung', estimate: true });
  }

  return { runs, circuits: calcs, routes };
}

/** Summe je Kabeltyp (m, inkl. Reserven). */
export function cableTotals(l: Lengths) {
  const m = new Map<string, number>();
  for (const r of l.runs) m.set(r.cable, (m.get(r.cable) ?? 0) + r.length);
  return [...m.entries()].map(([cable, meters]) => ({ cable, meters: Math.round(meters * 10) / 10 })).sort((a, b) => a.cable.localeCompare(b.cable));
}

// ---------------------------------------------------------------------------
// Stromkreisvorschlag
// ---------------------------------------------------------------------------

export interface CircuitProposal {
  circuits: Circuit[];
  /** outletId → circuitId */
  assignment: Record<string, string>;
  newRcds: { distributionId: string; id: string; label: string }[];
  notes: string[];
}

const POWERED: Outlet['kind'][] = ['steckdose', 'schalter', 'taster', 'bewegungsmelder', 'licht_decke', 'licht_wand', 'anschlussdose', 'festanschluss', 'herd', 'starkstrom'];
const isLight = (o: Outlet) => ['licht_decke', 'licht_wand', 'schalter', 'taster', 'bewegungsmelder'].includes(o.kind) || (o.kind === 'anschlussdose' && /lüfter|luefter|ventil/i.test(o.note));
const BIG = /spülmaschine|spuelmaschine|geschirrspül|waschmaschine|trockner|backofen|kühlschrank|kuehlschrank|gefrier|mikrowelle|wärmepumpe|durchlauferhitzer|boiler/i;
const AV = /rack|\bav\b|av-|beamer|subwoofer|technik|server|netzwerk/i;

/**
 * Schlägt Stromkreise vor. `mode`:
 *  - 'offen': nur Auslässe ohne Stromkreis, bestehende Kreise bleiben
 *  - 'alle':  alles neu (bestehende Kreise werden ersetzt)
 */
export function proposeCircuits(project: Project, mode: 'offen' | 'alle' = 'offen'): CircuitProposal {
  // Im Modus „alle“ bleiben nur Kreise ohne Auslässe (Zuleitungen zu Unterverteilungen) erhalten
  const used = new Set(project.rooms.flatMap((r) => r.outlets.map((o) => o.circuitId)).filter(Boolean));
  const keep = mode === 'offen' ? project.circuits : project.circuits.filter((c) => !used.has(c.id));
  const circuits: Circuit[] = [...keep];
  const assignment: Record<string, string> = {};
  const notes: string[] = [];
  const maxPlaces = normValue(project, 'stromkreis.maxSteckdosen');
  const hv = project.distributions.find((d) => d.kind === 'HV') ?? project.distributions[0];
  if (!hv) return { circuits: keep, assignment, newRcds: [], notes: ['Keine Verteilung erfasst – zuerst Hauptverteilung anlegen.'] };

  let counter = circuits.filter((c) => /^SK\d+$/.test(c.label)).length;
  const mk = (distId: string, name: string, kind: 'licht' | 'steckdose' | 'gross' | 'drehstrom' | 'wallbox', reason: string, roomIds: string[]): Circuit => {
    counter++;
    const base = { id: newId('sk'), label: `SK${counter}`, name, distributionId: distId, afdd: false, reason, note: '', rcdId: undefined as string | undefined, breakerGroupId: undefined as string | undefined };
    const c: Circuit = kind === 'licht' ? { ...base, characteristic: 'B', ratedCurrent: 10, poles: 1, cable: 'NYM-J 3×1,5' }
      : kind === 'drehstrom' ? { ...base, characteristic: 'B', ratedCurrent: 16, poles: 3, cable: 'NYM-J 5×2,5' }
      : kind === 'wallbox' ? { ...base, characteristic: 'C', ratedCurrent: 16, poles: 3, cable: 'NYM-J 5×6' }
      : { ...base, characteristic: 'B', ratedCurrent: 16, poles: 1, cable: 'NYM-J 3×2,5' };
    (c as any)._rooms = roomIds;
    (c as any)._kind = kind;
    circuits.push(c);
    return c;
  };

  const rooms = project.rooms.filter((r) => r.inScope);
  const open = (o: Outlet) => POWERED.includes(o.kind) && o.status !== 'bestand_entfaellt' && (mode === 'alle' || !o.circuitId) && !(o.kind === 'schalter' && o.smart && !o.inserts.length);
  const distOf = (r: Room) => r.distributionId ?? project.distributions.find((d) => d.kind === 'UV' && d.roomId === r.id)?.id ?? hv.id;
  const isKitchen = (r: Room) => /küche|kueche/i.test(`${r.name} ${r.usage}`);
  const isBath = (r: Room) => r.wetRoom && /bad|dusche|wc/i.test(`${r.name} ${r.usage}`);

  // 0) Verbraucher mit eigenem Stromkreis (aus der Raumnutzung) – Leitung/LS nach Leistung
  for (const r of rooms) for (const l of r.loads.filter((x) => x.dedicated && x.outletId)) {
    const o = r.outlets.find((x) => x.id === l.outletId);
    if (!o || !open(o) || assignment[o.id]) continue;
    const dim = circuitForLoad(l);
    const kind = /wallbox/i.test(l.label) ? 'wallbox' : dim.poles === 3 ? 'drehstrom' : 'gross';
    const c = mk(distOf(r), `${r.name}: ${l.label}`, kind, `${l.label} ${kw(l.power)} – eigener Kreis`, [r.id]);
    Object.assign(c, dim);
    assignment[o.id] = c.id;
  }

  // 1) Großgeräte, Drehstrom, Wallbox – je eigener Kreis
  for (const r of rooms) for (const o of r.outlets.filter(open)) {
    if (assignment[o.id]) continue;
    const txt = `${o.note} ${r.furniture.map((f) => '').join('')}`;
    if (o.kind === 'herd') assignment[o.id] = mk(distOf(r), `${r.name}: Herd/Kochfeld`, 'drehstrom', 'Großgerät Drehstrom – eigener Kreis', [r.id]).id;
    else if (/wallbox/i.test(txt)) assignment[o.id] = mk(distOf(r), `${r.name}: Wallbox`, 'wallbox', 'E-Mobilität (VDE 0100-722): eigener Kreis, RCD-Typ nach Wallbox', [r.id]).id;
    else if (/garten|außen|aussen|erdkabel/i.test(txt) && (o.kind === 'anschlussdose' || o.kind === 'festanschluss' || o.kind === 'steckdose')) {
      const c = mk(distOf(r), `${r.name}: Außenbereich/Garten`, 'drehstrom', 'Außenbereich eigener Kreis; Erdkabel mit Reserve-Leerrohr', [r.id]);
      c.cable = 'NYY-J 5×4';
      assignment[o.id] = c.id;
    }
    else if (o.kind === 'starkstrom') assignment[o.id] = mk(distOf(r), `${r.name}: CEE/Drehstrom`, 'drehstrom', 'Drehstromsteckdose eigener Kreis', [r.id]).id;
    else if ((o.kind === 'steckdose' || o.kind === 'anschlussdose' || o.kind === 'festanschluss') && BIG.test(txt)) assignment[o.id] = mk(distOf(r), `${r.name}: ${(txt.match(BIG)?.[0] ?? 'Großgerät').replace(/^./, (x) => x.toUpperCase())}`, 'gross', 'Großgerät – eigener Kreis (DIN 18015-2)', [r.id]).id;
  }

  // 2) Küche Arbeitsfläche: zwei Kreise
  for (const r of rooms.filter(isKitchen)) {
    const af = r.outlets.filter((o) => open(o) && !assignment[o.id] && o.kind === 'steckdose' && o.z != null && zToFfb(r, o.z) >= 90).sort((a, b) => (a.wallIndex ?? 0) - (b.wallIndex ?? 0) || (a.s ?? 0) - (b.s ?? 0));
    if (!af.length) continue;
    const half = Math.ceil(af.length / 2);
    const c1 = mk(distOf(r), `${r.name}: Arbeitsfläche 1`, 'steckdose', 'Küche aufgeteilt (Wasserkocher + Kaffeemaschine gleichzeitig)', [r.id]);
    const c2 = af.length > 1 ? mk(distOf(r), `${r.name}: Arbeitsfläche 2`, 'steckdose', 'Küche aufgeteilt', [r.id]) : c1;
    af.forEach((o, i) => (assignment[o.id] = (i < half ? c1 : c2).id));
  }

  // 3) Bad: Steckdosen eigener Kreis; AV/Technik eigener Kreis
  for (const r of rooms) {
    const rest = r.outlets.filter((o) => open(o) && !assignment[o.id] && (o.kind === 'steckdose' || o.kind === 'anschlussdose' || o.kind === 'festanschluss') && !isLight(o));
    const av = rest.filter((o) => AV.test(o.note));
    if (av.length) { const c = mk(distOf(r), `${r.name}: AV/Technik`, 'steckdose', 'Technik/AV getrennt von Raumsteckdosen', [r.id]); av.forEach((o) => (assignment[o.id] = c.id)); }
    if (isBath(r)) { const b = rest.filter((o) => !assignment[o.id]); if (b.length) { const c = mk(distOf(r), `${r.name}: Steckdosen`, 'steckdose', 'Bad eigener Kreis (Föhn, Heizlüfter)', [r.id]); b.forEach((o) => (assignment[o.id] = c.id)); } }
  }

  // 4) Übrige Steckdosen: je Raum, kleine Räume zusammenfassen
  const pending = new Map<string, { places: number; circuit: Circuit }>();
  for (const r of rooms) {
    const rest = r.outlets.filter((o) => open(o) && !assignment[o.id] && (o.kind === 'steckdose' || o.kind === 'anschlussdose' || o.kind === 'festanschluss') && !isLight(o));
    if (!rest.length) continue;
    const places = rest.reduce((s, o) => s + Math.max(1, o.inserts.filter((i) => i.startsWith('steckdose')).length || o.gangs), 0);
    const d = distOf(r);
    const cur = pending.get(d);
    if (cur && cur.places + places <= maxPlaces && places <= maxPlaces / 2) {
      cur.places += places;
      cur.circuit.name += ` + ${r.name}`;
      (cur.circuit as any)._rooms.push(r.id);
      rest.forEach((o) => (assignment[o.id] = cur.circuit.id));
      continue;
    }
    // ggf. auf mehrere Kreise aufteilen
    let chunk: Outlet[] = [];
    let n = 0;
    const flush = () => {
      if (!chunk.length) return;
      const c = mk(d, `${r.name}: Steckdosen`, 'steckdose', places > maxPlaces ? `mehr als ${maxPlaces} Steckdosenplätze – aufgeteilt` : 'Steckdosen je Raum', [r.id]);
      chunk.forEach((o) => (assignment[o.id] = c.id));
      pending.set(d, { places: n, circuit: c });
      chunk = []; n = 0;
    };
    for (const o of rest) {
      const pl = Math.max(1, o.inserts.filter((i) => i.startsWith('steckdose')).length || o.gangs);
      if (n + pl > maxPlaces) flush();
      chunk.push(o); n += pl;
    }
    flush();
  }

  // 5) Licht: je Verteilung bis zu 3 Räume pro Kreis
  const lightGroups = new Map<string, { circuit: Circuit; rooms: number }>();
  for (const r of rooms) {
    const ls = r.outlets.filter((o) => open(o) && !assignment[o.id] && isLight(o));
    if (!ls.length) continue;
    const d = distOf(r);
    let g = lightGroups.get(d);
    if (!g || g.rooms >= 3) { g = { circuit: mk(d, `Licht ${r.name}`, 'licht', 'Licht getrennt von Steckdosen; mehrere Räume je Kreis', [r.id]), rooms: 0 }; lightGroups.set(d, g); }
    else { g.circuit.name += `, ${r.name}`; (g.circuit as any)._rooms.push(r.id); }
    g.rooms++;
    ls.forEach((o) => (assignment[o.id] = g!.circuit.id));
  }

  // 6) RCD-Zuordnung und vorhandene LS
  const newRcds: CircuitProposal['newRcds'] = [];
  const maxPerRcd = normValue(project, 'stromkreis.maxJeRcd');
  for (const dist of project.distributions) {
    const mine = circuits.filter((c) => c.distributionId === dist.id && !keep.includes(c));
    if (!mine.length) continue;
    const rcds = dist.rcds.map((r) => ({ id: r.id, load: keep.filter((c) => c.rcdId === r.id).length, rooms: new Set<string>(), kinds: new Set<string>() }));
    for (const c of mine) {
      const rr: string[] = (c as any)._rooms ?? [];
      const kind: string = (c as any)._kind;
      if (kind === 'wallbox') {
        // Wallbox: eigener RCD, Typ nach Herstellerangabe
        const id = newId('fi');
        newRcds.push({ distributionId: dist.id, id, label: 'FI Wallbox (Typ nach Wallbox: A + DC-Erkennung oder B)' });
        c.rcdId = id;
        c.note = 'Eigener RCD; Typ nach Herstellerangabe der Wallbox – vom Elektriker festzulegen (VDE 0100-722)';
        continue;
      }
      // RCD mit wenig Last, möglichst nicht Licht und Steckdosen desselben Raums zusammen
      let cand = rcds.filter((x) => x.load < maxPerRcd).sort((a, b) => {
        const pa = (kind === 'licht' && rr.some((r) => a.rooms.has(r)) ? 10 : 0) + a.load;
        const pb = (kind === 'licht' && rr.some((r) => b.rooms.has(r)) ? 10 : 0) + b.load;
        return pa - pb;
      })[0];
      if (!cand) {
        const id = newId('fi');
        const label = `FI neu ${newRcds.filter((n) => n.distributionId === dist.id).length + 1} (40 A / 30 mA, Typ A)`;
        newRcds.push({ distributionId: dist.id, id, label });
        cand = { id, load: 0, rooms: new Set(), kinds: new Set() };
        rcds.push(cand);
      }
      c.rcdId = cand.id;
      cand.load++;
      rr.forEach((r) => cand!.rooms.add(r));
    }
    // vorhandene freie LS nutzen
    for (const g of dist.breakers) {
      let free = g.free - keep.filter((c) => c.breakerGroupId === g.id).length;
      for (const c of mine) {
        if (free <= 0) break;
        if (!c.breakerGroupId && c.poles === g.poles && c.characteristic === g.characteristic && c.ratedCurrent === g.ratedCurrent) { c.breakerGroupId = g.id; free--; }
      }
    }
    const missing = mine.filter((c) => !c.breakerGroupId);
    if (missing.length) notes.push(`${dist.name}: ${missing.length} Stromkreis(e) brauchen neue Leitungsschutzschalter (${missing.map((c) => `${c.poles === 3 ? '3× ' : ''}${c.characteristic}${c.ratedCurrent}`).join(', ')}).`);
  }
  if (newRcds.length) notes.push(`${newRcds.length} zusätzliche(r) RCD nötig (max. ${maxPerRcd} Stromkreise je RCD).`);
  for (const c of circuits) { delete (c as any)._rooms; delete (c as any)._kind; }
  return { circuits, assignment, newRcds, notes };
}

/** Vorschlag auf ein Projekt anwenden (Draft-kompatibel). */
export function applyCircuitProposal(p: Project, prop: CircuitProposal, mode: 'offen' | 'alle') {
  p.circuits = prop.circuits.map((c) => ({ ...c }));
  for (const r of p.rooms) for (const o of r.outlets) {
    if (prop.assignment[o.id]) o.circuitId = prop.assignment[o.id];
    else if (mode === 'alle' && o.circuitId && !p.circuits.some((c) => c.id === o.circuitId)) o.circuitId = undefined;
  }
  for (const n of prop.newRcds) {
    const d = p.distributions.find((x) => x.id === n.distributionId);
    if (d && !d.rcds.some((r) => r.id === n.id)) d.rcds.push({ id: n.id, label: n.label, ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: false });
  }
}

export function describeDrop(c: CircuitCalc | undefined): string {
  if (!c || c.voltageDropPct == null) return '–';
  return `${fmt(c.voltageDropPct, 2)} %${c.ok === false ? ' ⚠' : ''}`;
}
