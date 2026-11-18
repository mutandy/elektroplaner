/**
 * Leitungswege je Raum – aus dem Modell berechnet, nie gespeichert.
 *
 * Grundprinzip (kreuzungsfrei und einlagig durch Bauart):
 *  - Alle Leitungen eines Raums kommen an einer Einspeisung an (Durchbruch neben
 *    der Haupttür, Griffseite).
 *  - Von dort läuft eine gemeinsame Trasse entlang der Wände (Boden: Schlitz
 *    `floorOffset` cm vor der Wand; Aufputz: Rohr unter der Decke; waagerechte
 *    Wandschlitze: obere Installationszone). Alle Leitungen liegen nebeneinander
 *    auf dieser einen Linie, deshalb kreuzt sich nichts.
 *  - Zu jedem Auslass geht ein senkrechter Stich (Wandschlitz, Vorwand-Hohlraum
 *    oder Aufputzrohr).
 *  - Decke (Hohlraum/abgehängt/schlitzbar): Leitungen laufen in der Decke direkt
 *    zum Ziel und senkrecht von oben zur Dose.
 */
import type { Outlet, Project, Room, RoutingStrategy } from '../model/schema';
import { boxCenters, doorHandleSide, futureBuildup, pointOnWall, wallGeoms, wallName, fmt, type Pt } from '../geometry/room';
import { normValue } from '../rules/normValues';
import { cableById } from './cables';
import { outletKindLabel } from '../model/labels';

export type ResolvedStrategy = Exclude<RoutingStrategy, 'auto'>;

export interface FloorSlot {
  id: string;
  wallIndex: number;
  /** Abschnitt entlang der Wand (s), Trasse `offset` cm vor der Wand. */
  sFrom: number;
  sTo: number;
  from: Pt;
  to: Pt;
  length: number; // cm
  width: number; // mm
  depth: number; // mm
  cables: string[]; // Auslass-Labels
  /** Liegt im Hohlraum einer Vorwand/Baffle – kein Schlitz nötig. */
  inCavity: boolean;
  crossesDoor: boolean;
}

export interface WallSlot {
  id: string;
  wallIndex: number;
  orientation: 'senkrecht' | 'waagerecht';
  /** senkrecht: s; waagerecht: sFrom..sTo */
  s: number;
  sTo: number;
  zFrom: number;
  zTo: number;
  width: number; // mm
  depth: number; // mm
  cables: string[];
  inVerticalZone: boolean;
}

export interface SurfaceRun {
  id: string;
  kind: 'trasse' | 'stich' | 'decke';
  wallIndex?: number;
  from: Pt;
  to: Pt;
  z: number;
  zTo?: number;
  length: number;
  cables: string[];
}

export interface CeilingRun {
  id: string;
  from: Pt;
  to: Pt;
  length: number;
  slot: boolean;
  cables: string[];
}

export interface Drilling {
  outletId: string;
  label: string;
  n: number;
  wallIndex?: number;
  s?: number;
  z?: number;
  x?: number;
  y?: number;
  kind: 'UP' | 'Hohlwand' | 'Aufputz' | 'Bestand' | 'Decke';
  diameter: number; // mm
}

export interface Penetration {
  id: string;
  wallIndex: number;
  s: number;
  z: number;
  diameter: number; // mm
  cables: number;
  fireStop: boolean;
  note: string;
}

export interface OutletPath {
  outletId: string;
  label: string;
  /** Position auf der Trasse (Umfangskoordinate) */
  t: number;
  /** Weg Einspeisung → Auslass (cm), ohne Reserven. */
  fromEntry: number;
  /** davon waagerecht (Trasse/Decke) und senkrecht (Stich) */
  along: number;
  vertical: number;
  /** Quelle: Raumeinspeisung oder AV-Rack */
  source: 'einspeisung' | 'rack';
  /** Höhe, an der die Leitung den Auslass verlässt/erreicht. */
  z: number;
  routed: boolean;
}

export interface RouteIssue { severity: 'fehler' | 'warnung' | 'hinweis'; message: string; outletId?: string }

export interface RoomRoutes {
  roomId: string;
  strategy: ResolvedStrategy | 'keine';
  strategyReason: string;
  entry: { wallIndex: number; s: number; point: Pt; z: number };
  floorSlots: FloorSlot[];
  wallSlots: WallSlot[];
  surfaceRuns: SurfaceRun[];
  ceilingRuns: CeilingRun[];
  drillings: Drilling[];
  penetrations: Penetration[];
  paths: OutletPath[];
  issues: RouteIssue[];
  perimeter: number;
}

// ---------------------------------------------------------------------------

const needsCable = (o: Outlet) => o.status !== 'bestand_bleibt' && o.status !== 'bestand_entfaellt' && o.kind !== 'rauchwarnmelder';

/** Kabeltyp eines Auslasses (Stromkreisleitung bzw. Daten-/Audiokabel). */
export function outletCable(project: Project, o: Outlet): string {
  if (o.kind === 'lan') return 'Cat.7';
  if (o.kind === 'lautsprecher') return 'LS 2×2,5';
  if (o.kind === 'tv_sat') return 'Koax';
  if (o.kind === 'klingel') return 'J-Y(St)Y 2×2×0,8';
  const c = project.circuits.find((c) => c.id === o.circuitId);
  if (c) return c.cable;
  if (o.kind === 'herd' || o.kind === 'starkstrom') return 'NYM-J 5×2,5';
  if (o.kind === 'licht_decke' || o.kind === 'licht_wand' || o.kind === 'schalter' || o.kind === 'taster') return 'NYM-J 3×1,5';
  return 'NYM-J 3×2,5';
}

export function resolveStrategy(room: Room): { strategy: ResolvedStrategy | 'keine'; reason: string } {
  const want = room.routing.strategy;
  if (want !== 'auto') return { strategy: want, reason: 'vom Nutzer festgelegt' };
  if (room.installationType.startsWith('aufputz')) return { strategy: 'aufputz', reason: 'Aufputz-Installation' };
  if (room.floor.slotsAllowed && !room.floor.underfloorHeating) return { strategy: 'boden', reason: 'Bodenschlitze erlaubt (Wände waagerecht und Decke werden geschont)' };
  if (room.ceiling.slotsAllowed || room.ceiling.cavityDepth > 0 || room.ceiling.construction === 'abgehaengt' || room.ceiling.construction === 'holzbalken') return { strategy: 'decke', reason: 'Decke als Kabelweg nutzbar' };
  if (room.walls.some((w) => w.horizontalSlotsAllowed)) return { strategy: 'wand_waagerecht', reason: 'waagerechte Wandschlitze erlaubt' };
  return { strategy: 'keine', reason: 'weder Boden, Decke noch waagerechte Wandschlitze freigegeben' };
}

export function defaultEntry(room: Room): { wallIndex: number; s: number } {
  if (room.routing.entry) return room.routing.entry;
  const door = room.doors.find((d) => d.isMainEntrance) ?? room.doors[0];
  if (!door) return { wallIndex: 0, s: 20 };
  const len = wallGeoms(room)[door.wallIndex].length;
  const s = doorHandleSide(door) === 'rechts' ? door.s + door.width + 30 : door.s - 30;
  return { wallIndex: door.wallIndex, s: Math.max(5, Math.min(len - 5, s)) };
}

/** Innen versetztes Polygon (Trassenlinie im Abstand o vor allen Wänden). */
function offsetPolygon(room: Room, o: number): Pt[] {
  const ws = wallGeoms(room);
  return room.polygon.map((v, i) => {
    const n1 = ws[(i - 1 + ws.length) % ws.length].normal;
    const n2 = ws[i].normal;
    const k = o / (1 + n1.x * n2.x + n1.y * n2.y);
    return { x: v.x + (n1.x + n2.x) * k, y: v.y + (n1.y + n2.y) * k };
  });
}

export function computeRoomRoutes(project: Project, room: Room): RoomRoutes {
  const ws = wallGeoms(room);
  const cum: number[] = [];
  let acc = 0;
  for (const w of ws) { cum.push(acc); acc += w.length; }
  const P = acc;
  const tOf = (wi: number, s: number) => cum[wi] + Math.max(0, Math.min(ws[wi].length, s));
  const fb = futureBuildup(room);
  const H = room.height;
  const settings = project.settings;
  const { strategy, reason } = resolveStrategy(room);
  const entryWS = defaultEntry(room);
  const issues: RouteIssue[] = [];
  const res: RoomRoutes = {
    roomId: room.id, strategy, strategyReason: reason,
    entry: { ...entryWS, point: pointOnWall(room, entryWS.wallIndex, entryWS.s), z: 0 },
    floorSlots: [], wallSlots: [], surfaceRuns: [], ceilingRuns: [], drillings: [], penetrations: [], paths: [], issues, perimeter: P,
  };
  const tEntry = tOf(entryWS.wallIndex, entryWS.s);

  // ---- Bohrungen (unabhängig vom Leitungsweg) --------------------------------
  for (const o of room.outlets) {
    if (o.status === 'bestand_entfaellt') continue;
    const kind: Drilling['kind'] = o.status === 'bestand_bleibt' || o.boxType === 'bestand' ? 'Bestand'
      : o.mount !== 'wand' ? (o.boxType === 'aufputz' ? 'Aufputz' : 'Decke')
      : o.boxType === 'hohlwand' || o.boxType === 'vorwand' ? 'Hohlwand'
      : o.boxType === 'aufputz' || o.boxType === 'aufputz_holz' ? 'Aufputz' : 'UP';
    if (o.mount === 'wand') {
      for (const c of boxCenters(o, settings)) res.drillings.push({ outletId: o.id, label: o.gangs > 1 ? `${o.label}.${c.n}` : o.label, n: c.n, wallIndex: o.wallIndex, s: c.s, z: c.z, kind, diameter: settings.boxDrill * 10 });
    } else if (o.x != null && o.y != null && o.kind !== 'rauchwarnmelder') {
      res.drillings.push({ outletId: o.id, label: o.label, n: 1, x: o.x, y: o.y, kind, diameter: settings.boxDrill * 10 });
    }
  }

  if (strategy === 'keine') {
    if (room.outlets.some(needsCable)) issues.push({ severity: 'fehler', message: `${room.name}: kein Leitungsweg möglich (${reason}). Bitte Leitungsweg im Raum festlegen oder Boden/Decke/Wand freigeben.` });
    return res;
  }

  const cover = normValue(project, 'trasse.ueberdeckung');
  const gap = normValue(project, 'trasse.kabelabstand');
  const extra = normValue(project, 'trasse.schlitzzugabe');
  const slotDims = (cables: string[], labelsToCable: Map<string, string>) => {
    const ds = cables.map((l) => cableById(labelsToCable.get(l) ?? '').diameter);
    const width = Math.round(ds.reduce((a, b) => a + b, 0) + gap * Math.max(0, ds.length - 1) + extra);
    const depth = Math.round(Math.max(...ds, 0) + cover);
    return { width, depth };
  };

  // Hohlräume (Vorwand/Baffle) je Wand
  const cavityAt = (wi: number, s: number, z?: number) => room.walls[wi]?.preWall.find((p) => s >= p.from - 0.5 && s <= p.to + 0.5 && (z == null || z <= (p.height ?? H)));

  // ---- Ziele: jeder Auslass mit neuer Leitung -------------------------------
  interface Target { o: Outlet; t: number; wi?: number; s?: number; zLow: number; zHigh: number; cable: string; ceiling: boolean }
  const targets: Target[] = [];
  const labelCable = new Map<string, string>();
  for (const o of room.outlets) {
    if (!needsCable(o)) continue;
    const cable = outletCable(project, o);
    labelCable.set(o.label, cable);
    if (o.mount === 'wand' && o.wallIndex != null && o.s != null && o.z != null) {
      const cs = boxCenters(o, settings);
      const r = settings.boxDrill / 2;
      // Stich an der Dose, die der Einspeisung am nächsten liegt
      const sRiser = cs.reduce((best, c) => (Math.abs(tOf(o.wallIndex!, c.s) - tEntry) < Math.abs(tOf(o.wallIndex!, best) - tEntry) ? c.s : best), cs[0].s);
      targets.push({ o, t: tOf(o.wallIndex, sRiser), wi: o.wallIndex, s: sRiser, zLow: Math.min(...cs.map((c) => c.z)) - r, zHigh: Math.max(...cs.map((c) => c.z)) + r, cable, ceiling: false });
    } else if (o.x != null && o.y != null) {
      // Decken-/Bodenauslass: nächster Wandpunkt für Trasse
      let best = { t: 0, d: Infinity, wi: 0, s: 0 };
      ws.forEach((w) => {
        const s = Math.max(0, Math.min(w.length, (o.x! - w.a.x) * w.dir.x + (o.y! - w.a.y) * w.dir.y));
        const p = pointOnWall(room, w.index, s);
        const d = Math.hypot(p.x - o.x!, p.y - o.y!);
        if (d < best.d) best = { t: tOf(w.index, s), d, wi: w.index, s };
      });
      targets.push({ o, t: best.t, wi: best.wi, s: best.s, zLow: H, zHigh: H, cable, ceiling: true });
    }
  }

  const perimDist = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, P - d); };
  /** Richtung des kürzeren Wegs von a nach b (+1 im Uhrzeigersinn, −1 dagegen), blockierte Bereiche beachten. */
  const blocked: [number, number][] = [];
  const pathIntervals = (a: number, b: number): [number, number][] | null => {
    const fwd: [number, number][] = b >= a ? [[a, b]] : [[a, P], [0, b]];
    const bwd: [number, number][] = a >= b ? [[b, a]] : [[b, P], [0, a]];
    const len = (iv: [number, number][]) => iv.reduce((s, [x, y]) => s + (y - x), 0);
    const ok = (iv: [number, number][]) => !iv.some(([x, y]) => blocked.some(([bx, by]) => x < by - 0.01 && bx < y - 0.01));
    const cands = [fwd, bwd].filter(ok).sort((p, q) => len(p) - len(q));
    return cands[0] ?? null;
  };

  // Blockaden für Wand-/Aufputztrassen: Türen (Sturz) – Boden: Tür = Schwellenübergang (erlaubt)
  // Aufputz: Trasse unter der Decke, bei niedrigen Räumen knapp über dem höchsten Sturz
  const openingTops = [...room.doors.map((d) => d.height + fb), ...room.windows.filter((w) => w.status !== 'wird_zugemauert').map((w) => w.sill + w.height)];
  const zSurface = Math.min(H - 5, Math.max(H - room.routing.surfaceBelowCeiling, ...openingTops.map((t) => t + 3)));
  const zTrack = strategy === 'aufputz' ? zSurface : strategy === 'wand_waagerecht' ? H - fb - 30 : 0;
  if (strategy === 'aufputz' && zSurface > H - room.routing.surfaceBelowCeiling) issues.push({ severity: 'hinweis', message: `${room.name}: Aufputztrasse liegt bei ${fmt(zSurface)} cm (knapp über Tür-/Fenstersturz statt ${fmt(room.routing.surfaceBelowCeiling)} cm unter der Decke).` });
  if (strategy === 'aufputz' || strategy === 'wand_waagerecht') {
    // Aufputz darf über den Sturz hinweg, Wandschlitze nicht in den Sturz (Sturzhöhe + Auflager)
    const clear = strategy === 'aufputz' ? 2 : normValue(project, 'sturz.hoehe');
    const bear = strategy === 'aufputz' ? 0 : 20;
    for (const d of room.doors) if (d.height + fb > zTrack - clear) blocked.push([tOf(d.wallIndex, d.s - bear), tOf(d.wallIndex, d.s + d.width + bear)]);
    for (const w of room.windows) if (w.status !== 'wird_zugemauert' && w.sill + w.height > zTrack - clear) blocked.push([tOf(w.wallIndex, w.s - bear), tOf(w.wallIndex, w.s + w.width + bear)]);
    for (const w of room.walls) for (const z of w.zones) if (z.kind !== 'brandwand' && (z.zTo ?? H) > zTrack - clear) blocked.push([tOf(w.index, z.from), tOf(w.index, z.to)]);
    if (strategy === 'wand_waagerecht') room.walls.forEach((w) => { if (!w.horizontalSlotsAllowed) blocked.push([cum[w.index], cum[w.index] + ws[w.index].length]); });
  }

  // Abschnitte der Trasse mit ihren Kabeln sammeln
  const usage: { iv: [number, number]; label: string }[] = [];
  const offset = room.routing.floorOffset;

  // Lautsprecher laufen sternförmig zum AV-Rack (falls im Raum), alles andere zur Einspeisung
  const rack = room.furniture.find((f) => f.kind === 'rack');
  let rackSrc: { wi: number; s: number; t: number } | undefined;
  if (rack) {
    const c = { x: rack.x + rack.w / 2, y: rack.y + rack.d / 2 };
    let best = { d: Infinity, wi: 0, s: 0 };
    ws.forEach((w) => {
      const s = Math.max(0, Math.min(w.length, (c.x - w.a.x) * w.dir.x + (c.y - w.a.y) * w.dir.y));
      const p = pointOnWall(room, w.index, s);
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < best.d) best = { d, wi: w.index, s };
    });
    rackSrc = { wi: best.wi, s: best.s, t: tOf(best.wi, best.s) };
  }

  for (const tg of targets) {
    const src = tg.o.kind === 'lautsprecher' && rackSrc ? rackSrc : { wi: entryWS.wallIndex, s: entryWS.s, t: tEntry };
    const wantsCeiling = tg.ceiling || strategy === 'decke';
    if (wantsCeiling && strategy !== 'aufputz') {
      // Weg über die Decke
      const ceilingOk = room.ceiling.slotsAllowed || room.ceiling.cavityDepth > 0 || room.ceiling.construction === 'abgehaengt' || room.ceiling.construction === 'holzbalken';
      if (!ceilingOk) {
        issues.push({ severity: 'fehler', outletId: tg.o.id, message: `${tg.o.label} (${outletKindLabel[tg.o.kind]}): neuer Deckenauslass, aber die Decke darf nicht geschlitzt werden und hat keinen Hohlraum. Bestandsauslass nutzen oder Aufputz/Leuchte an der Wand.` });
        res.paths.push({ outletId: tg.o.id, label: tg.o.label, t: tg.t, fromEntry: 0, along: 0, vertical: 0, source: 'einspeisung', z: H, routed: false });
        continue;
      }
      const target = tg.ceiling ? { x: tg.o.x!, y: tg.o.y! } : pointOnWall(room, tg.wi!, tg.s!, 3);
      const start = pointOnWall(room, src.wi, src.s, 3);
      const len = Math.abs(target.x - start.x) + Math.abs(target.y - start.y);
      res.ceilingRuns.push({ id: '', from: start, to: target, length: len, slot: room.ceiling.slotsAllowed && room.ceiling.cavityDepth === 0, cables: [tg.o.label] });
      // senkrechter Anteil: an der Einspeisung (bei Boden-/Aufputz-Einspeisung) und zur Wanddose
      let vertical = 0;
      if (!tg.ceiling) {
        vertical += H - tg.zHigh;
        const cav = cavityAt(tg.wi!, tg.s!);
        if (!cav || (cav.height ?? H) < H) res.wallSlots.push({ id: '', wallIndex: tg.wi!, orientation: 'senkrecht', s: tg.s!, sTo: tg.s!, zFrom: Math.max(tg.zHigh, cav ? cav.height ?? H : 0), zTo: H, width: 0, depth: 0, cables: [tg.o.label], inVerticalZone: true });
      }
      res.paths.push({ outletId: tg.o.id, label: tg.o.label, t: tg.t, fromEntry: len + vertical + (strategy === 'boden' ? H : 0), along: len, vertical: vertical + (strategy === 'boden' ? H : 0), source: src === rackSrc ? 'rack' : 'einspeisung', z: H, routed: true });
      if (strategy === 'boden') {
        // Steigschlitz an der Einspeisung (bzw. am Rack) vom Boden bis in die Decke
        const cav = cavityAt(src.wi, src.s);
        if (!cav || (cav.height ?? H) < H) res.wallSlots.push({ id: '', wallIndex: src.wi, orientation: 'senkrecht', s: src.s, sTo: src.s, zFrom: cav ? cav.height ?? H : 0, zTo: H, width: 0, depth: 0, cables: [tg.o.label], inVerticalZone: true });
      }
      continue;
    }
    const iv = pathIntervals(src.t, tg.t);
    if (!iv) {
      issues.push({ severity: 'fehler', outletId: tg.o.id, message: `${tg.o.label}: Trasse ist in beide Richtungen blockiert (Tür-/Fenstersturz, Kamin oder Wand ohne Freigabe für waagerechte Schlitze).` });
      res.paths.push({ outletId: tg.o.id, label: tg.o.label, t: tg.t, fromEntry: 0, along: 0, vertical: 0, source: 'einspeisung', z: 0, routed: false });
      continue;
    }
    for (const x of iv) usage.push({ iv: x, label: tg.o.label });
    const along = iv.reduce((s, [a, b]) => s + (b - a), 0);
    let vertical: number;
    if (strategy === 'boden') {
      vertical = tg.zLow + 2 * offset;
      // In einer Vorwand läuft die Leitung im Hohlraum hoch; darüber Wandschlitz ab Vorwand-Oberkante
      const cav = cavityAt(tg.wi!, tg.s!);
      const cavTop = cav ? cav.height ?? H : 0;
      if (!cav || cavTop < tg.zLow) {
        res.wallSlots.push({ id: '', wallIndex: tg.wi!, orientation: 'senkrecht', s: tg.s!, sTo: tg.s!, zFrom: cav ? cavTop : 0, zTo: tg.zLow, width: 0, depth: 0, cables: [tg.o.label], inVerticalZone: true });
      }
    } else {
      vertical = Math.max(0, zTrack - tg.zHigh);
      if (strategy === 'wand_waagerecht') {
        const cav = cavityAt(tg.wi!, tg.s!);
        if (!cav) res.wallSlots.push({ id: '', wallIndex: tg.wi!, orientation: 'senkrecht', s: tg.s!, sTo: tg.s!, zFrom: tg.zHigh, zTo: zTrack, width: 0, depth: 0, cables: [tg.o.label], inVerticalZone: true });
      } else {
        const p = pointOnWall(room, tg.wi!, tg.s!);
        res.surfaceRuns.push({ id: '', kind: tg.ceiling ? 'decke' : 'stich', wallIndex: tg.wi, from: p, to: tg.ceiling ? { x: tg.o.x!, y: tg.o.y! } : p, z: tg.ceiling ? H : tg.zHigh, zTo: zTrack, length: tg.ceiling ? Math.abs(tg.o.x! - p.x) + Math.abs(tg.o.y! - p.y) : zTrack - tg.zHigh, cables: [tg.o.label] });
        if (tg.ceiling) vertical = (H - zTrack) + Math.abs(tg.o.x! - p.x) + Math.abs(tg.o.y! - p.y);
      }
    }
    res.paths.push({ outletId: tg.o.id, label: tg.o.label, t: tg.t, fromEntry: along + vertical, along, vertical, source: src === rackSrc ? 'rack' : 'einspeisung', z: strategy === 'boden' ? 0 : zTrack, routed: true });
  }

  // ---- Trassenabschnitte zusammenfassen (je Wand, gleiche Kabelmenge) --------
  const cuts = new Set<number>([0, P, ...cum]);
  for (const u of usage) { cuts.add(u.iv[0]); cuts.add(u.iv[1]); }
  for (const d of room.doors) { cuts.add(tOf(d.wallIndex, d.s)); cuts.add(tOf(d.wallIndex, d.s + d.width)); }
  for (const w of room.walls) for (const p of w.preWall) { cuts.add(tOf(w.index, p.from)); cuts.add(tOf(w.index, p.to)); }
  const pts = [...cuts].sort((a, b) => a - b);
  const offPoly = offsetPolygon(room, strategy === 'boden' ? offset : 2);
  const at = (t: number): { wi: number; s: number } => {
    let wi = cum.findIndex((c, i) => t >= c - 1e-6 && t <= c + ws[i].length + 1e-6);
    if (wi < 0) wi = ws.length - 1;
    return { wi, s: t - cum[wi] };
  };
  const trackPoint = (wi: number, s: number): Pt => {
    // Punkt auf der versetzten Trasse: lineare Interpolation zwischen versetzten Ecken
    const a = offPoly[wi];
    const b = offPoly[(wi + 1) % offPoly.length];
    const f = ws[wi].length ? s / ws[wi].length : 0;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const pieces: { wi: number; s1: number; s2: number; cables: string[] }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b - a < 0.05) continue;
    const cables = usage.filter((u) => u.iv[0] <= a + 1e-6 && u.iv[1] >= b - 1e-6 && u.iv[1] > u.iv[0]).map((u) => u.label).sort();
    if (!cables.length) continue;
    const { wi, s } = at((a + b) / 2);
    const s1 = a - cum[wi], s2 = b - cum[wi];
    void s;
    const last = pieces[pieces.length - 1];
    const inCav = (x: number) => !!cavityAt(wi, x);
    if (last && last.wi === wi && Math.abs(last.s2 - s1) < 0.05 && last.cables.join() === cables.join() && inCav(last.s1 + 0.1) === inCav(s1 + 0.1)) last.s2 = s2;
    else pieces.push({ wi, s1, s2, cables });
  }

  for (const pc of pieces) {
    const dims = slotDims(pc.cables, labelCable);
    const crossesDoor = room.doors.some((d) => d.wallIndex === pc.wi && pc.s1 < d.s + d.width && d.s < pc.s2);
    if (strategy === 'boden') {
      res.floorSlots.push({ id: '', wallIndex: pc.wi, sFrom: pc.s1, sTo: pc.s2, from: trackPoint(pc.wi, pc.s1), to: trackPoint(pc.wi, pc.s2), length: pc.s2 - pc.s1, ...dims, cables: pc.cables, inCavity: !!cavityAt(pc.wi, (pc.s1 + pc.s2) / 2), crossesDoor });
    } else if (strategy === 'wand_waagerecht') {
      res.wallSlots.push({ id: '', wallIndex: pc.wi, orientation: 'waagerecht', s: pc.s1, sTo: pc.s2, zFrom: zTrack, zTo: zTrack, ...dims, cables: pc.cables, inVerticalZone: true });
    } else if (strategy === 'aufputz') {
      res.surfaceRuns.push({ id: '', kind: 'trasse', wallIndex: pc.wi, from: pointOnWall(room, pc.wi, pc.s1), to: pointOnWall(room, pc.wi, pc.s2), z: zTrack, length: pc.s2 - pc.s1, cables: pc.cables });
    }
  }

  // ---- Senkrechte Wandschlitze zusammenfassen (gleiche Wand, ±3 cm) ---------
  const merged: WallSlot[] = [];
  for (const sl of res.wallSlots.filter((w) => w.orientation === 'senkrecht')) {
    const m = merged.find((x) => x.wallIndex === sl.wallIndex && Math.abs(x.s - sl.s) <= 3 && x.zFrom <= sl.zTo && sl.zFrom <= x.zTo + 50);
    if (m) { m.zFrom = Math.min(m.zFrom, sl.zFrom); m.zTo = Math.max(m.zTo, sl.zTo); m.cables.push(...sl.cables); }
    else merged.push({ ...sl, cables: [...sl.cables] });
  }
  res.wallSlots = [...merged, ...res.wallSlots.filter((w) => w.orientation === 'waagerecht')];
  const vFrom = normValue(project, 'zone.v.von'), vTo = normValue(project, 'zone.v.bis');
  const lowZoneTop = normValue(project, 'zone.h.unten.bis') + fb;
  for (const sl of res.wallSlots) {
    const d = slotDims(sl.cables, labelCable);
    sl.width = d.width;
    sl.depth = d.depth;
    if (sl.orientation === 'senkrecht') {
      const len = ws[sl.wallIndex].length;
      const edges = [0, len, ...room.doors.filter((x) => x.wallIndex === sl.wallIndex).flatMap((x) => [x.s, x.s + x.width]), ...room.windows.filter((x) => x.wallIndex === sl.wallIndex).flatMap((x) => [x.s, x.s + x.width])];
      sl.inVerticalZone = edges.some((e) => Math.abs(sl.s - e) >= vFrom - 0.5 && Math.abs(sl.s - e) <= vTo + 0.5);
      const shortStub = strategy === 'boden' ? sl.zTo <= lowZoneTop + 5 : sl.zFrom >= H - fb - 45 - 5;
      if (!sl.inVerticalZone && !shortStub) issues.push({ severity: 'warnung', message: `Wandschlitz an ${wallName(room, sl.wallIndex)} bei ${fmt(sl.s)} cm (${sl.cables.join(', ')}) liegt außerhalb der senkrechten Installationszonen (DIN 18015-3).` });
      if (sl.depth / 10 > normValue(project, 'schlitz.senkrecht.maxTiefe')) issues.push({ severity: 'warnung', message: `Wandschlitz ${wallName(room, sl.wallIndex)} bei ${fmt(sl.s)} cm braucht ${sl.depth} mm Tiefe – mehr als ohne Nachweis zulässig (${fmt(normValue(project, 'schlitz.senkrecht.maxTiefe') * 10, 0)} mm). Leitungen aufteilen oder Statik fragen.` });
      if (sl.width / 10 > normValue(project, 'schlitz.senkrecht.maxBreite')) issues.push({ severity: 'warnung', message: `Wandschlitz ${wallName(room, sl.wallIndex)} bei ${fmt(sl.s)} cm wird ${sl.width} mm breit – über dem Richtwert ohne Nachweis.` });
      for (const z of room.walls[sl.wallIndex].zones) if (z.kind !== 'brandwand' && sl.s > z.from - 2 && sl.s < z.to + 2) issues.push({ severity: 'fehler', message: `Wandschlitz bei ${fmt(sl.s)} cm an ${wallName(room, sl.wallIndex)} liegt in der ${z.kind === 'kaminwange' ? 'Kaminwange' : 'Tabuzone'}.` });
    } else if (sl.depth / 10 > normValue(project, 'schlitz.waagerecht.maxTiefe')) {
      issues.push({ severity: 'warnung', message: `Waagerechter Schlitz an ${wallName(room, sl.wallIndex)} braucht ${sl.depth} mm Tiefe – ohne statischen Nachweis sind nur ${fmt(normValue(project, 'schlitz.waagerecht.maxTiefe') * 10, 0)} mm zulässig.` });
    }
  }

  // ---- Prüfungen Bodenschlitz ------------------------------------------------
  const maxDepthMm = room.floor.maxSlotDepth * 10;
  for (const fs of res.floorSlots) {
    if (!fs.inCavity && fs.depth > maxDepthMm) issues.push({ severity: 'fehler', message: `Bodenschlitz entlang ${wallName(room, fs.wallIndex)} braucht ${fs.depth} mm Tiefe, erlaubt sind ${fmt(maxDepthMm, 0)} mm. Leitungen auf eine andere Trasse verteilen oder dünnere Leitungen wählen.` });
  }
  if (res.floorSlots.some((f) => f.crossesDoor)) issues.push({ severity: 'hinweis', message: `${room.name}: Bodentrasse quert eine Türöffnung – Übergang unter der Türschwelle einplanen (Schutzrohr, Schwelle erst danach setzen).` });

  // ---- Durchbruch an der Einspeisung ----------------------------------------
  const all = targets.filter((t) => res.paths.find((p) => p.outletId === t.o.id)?.routed && !(t.o.kind === 'lautsprecher' && rackSrc));
  if (all.length) {
    const area = all.reduce((s, t) => s + (Math.PI / 4) * cableById(t.cable).diameter ** 2, 0);
    const diameter = Math.max(25, Math.ceil(Math.sqrt((area / 0.4) * (4 / Math.PI)) / 5) * 5); // Füllgrad 40 %
    const wall = room.walls[entryWS.wallIndex];
    const doorFire = room.doors.some((d) => d.wallIndex === entryWS.wallIndex && d.fireRating !== 'keine');
    const fire = doorFire || wall.zones.some((z) => z.kind === 'brandwand');
    const z = strategy === 'boden' ? 5 + fb : strategy === 'decke' ? H - 10 : zTrack;
    res.penetrations.push({ id: 'D1', wallIndex: entryWS.wallIndex, s: entryWS.s, z, diameter, cables: all.length, fireStop: fire, note: fire ? 'Brandabschnitt: zugelassene Abschottung (MLAR) – nur durch Fachbetrieb' : 'Durchbruch zum Nachbarraum, nach Verlegung verschließen' });
    res.entry.z = z;
  }

  // ---- Aufputz: Hindernisse unter der Decke (Tor, Laufschiene) --------------
  if (strategy === 'aufputz') {
    for (const run of res.surfaceRuns.filter((r) => r.kind === 'decke')) {
      for (const ob of room.obstacles.filter((o) => (o.zTo ?? H) >= H - 30)) {
        const minX = Math.min(run.from.x, run.to.x), maxX = Math.max(run.from.x, run.to.x);
        const minY = Math.min(run.from.y, run.to.y), maxY = Math.max(run.from.y, run.to.y);
        if (minX < ob.x + ob.w && ob.x < maxX + 0.1 && minY < ob.y + ob.d && ob.y < maxY + 0.1) issues.push({ severity: 'warnung', message: `Deckenleitung zu ${run.cables.join(', ')} kreuzt „${ob.label || ob.kind}“ – Bereich freihalten, Leitung außen herum führen.` });
      }
    }
    if (/garage/i.test(`${room.name} ${room.usage}`)) issues.push({ severity: 'hinweis', message: `${room.name}: Leitungen bis ca. 1,5 m Höhe mechanisch schützen (Stahlrohr/Kanal), Anfahrschutz an Wallbox und Verteiler.` });
  }

  // ---- IDs vergeben -----------------------------------------------------------
  res.floorSlots.forEach((x, i) => (x.id = `BS${i + 1}`));
  res.wallSlots.forEach((x, i) => (x.id = `WS${i + 1}`));
  res.surfaceRuns.forEach((x, i) => (x.id = `AP${i + 1}`));
  res.ceilingRuns.forEach((x, i) => (x.id = `DE${i + 1}`));
  return res;
}

export function computeAllRoutes(project: Project): Map<string, RoomRoutes> {
  const m = new Map<string, RoomRoutes>();
  for (const r of project.rooms.filter((r) => r.inScope)) m.set(r.id, computeRoomRoutes(project, r));
  return m;
}

/** Summen für Schlitzplan. */
export function routeTotals(rr: RoomRoutes) {
  return {
    floorSlotM: rr.floorSlots.filter((f) => !f.inCavity).reduce((s, f) => s + f.length, 0) / 100,
    wallSlotM: rr.wallSlots.reduce((s, w) => s + (w.orientation === 'senkrecht' ? w.zTo - w.zFrom : w.sTo - w.s), 0) / 100,
    ceilingSlotM: rr.ceilingRuns.filter((c) => c.slot).reduce((s, c) => s + c.length, 0) / 100,
    surfaceM: rr.surfaceRuns.reduce((s, r) => s + r.length, 0) / 100,
    drillUP: rr.drillings.filter((d) => d.kind === 'UP').length,
    drillHollow: rr.drillings.filter((d) => d.kind === 'Hohlwand').length,
    drillCeiling: rr.drillings.filter((d) => d.kind === 'Decke').length,
    surfaceBoxes: rr.drillings.filter((d) => d.kind === 'Aufputz').length,
    existing: rr.drillings.filter((d) => d.kind === 'Bestand').length,
    penetrations: rr.penetrations.length,
  };
}
