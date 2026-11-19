/**
 * Geometrie-Änderungen, die alle Bezüge (Wandindex, Abstand s, x/y) mitziehen.
 */
import type { Room } from '../model/schema';
import { isRectRoom } from './room';

export type RectCorner = 0 | 1 | 2 | 3; // oben links, oben rechts, unten rechts, unten links (im Plan)
export const cornerLabel: Record<RectCorner, string> = { 0: 'oben links', 1: 'oben rechts', 2: 'unten rechts', 3: 'unten links' };

/**
 * Schneidet aus einem rechteckigen Raum eine Ecke aus (Kamin, Schacht, Vorsprung).
 * `dx` = Breite waagerecht im Plan, `dy` = Tiefe senkrecht im Plan.
 * Die zwei neuen Wände am Vorsprung bekommen eine Tabuzone der Art `zoneKind`.
 * Liegt der Vorsprung im Nullpunkt (Ecke oben links), wandert der Nullpunkt an
 * die nächste Ecke (Raumkoordinaten und Lage im Geschoss werden verschoben).
 */
export function notchRectCorner(room: Room, corner: RectCorner, dx: number, dy: number, zoneKind: 'kaminwange' | 'tabu' | null = 'kaminwange'): Room {
  if (!isRectRoom(room)) throw new Error('Ecke ausschneiden geht nur bei rechteckigen Räumen.');
  const w = room.polygon[1].x;
  const d = room.polygon[2].y;
  if (dx <= 0 || dy <= 0 || dx >= w || dy >= d) throw new Error('Vorsprung muss kleiner als der Raum sein.');
  const r: Room = JSON.parse(JSON.stringify(room));
  // map[alteWand] = { neue Wand, Verschiebung von s }
  let poly: { x: number; y: number }[];
  let map: { wi: number; ds: number }[];
  let notchWalls: number[];
  let shift = 0;
  switch (corner) {
    case 1:
      poly = [{ x: 0, y: 0 }, { x: w - dx, y: 0 }, { x: w - dx, y: dy }, { x: w, y: dy }, { x: w, y: d }, { x: 0, y: d }];
      map = [{ wi: 0, ds: 0 }, { wi: 3, ds: -dy }, { wi: 4, ds: 0 }, { wi: 5, ds: 0 }];
      notchWalls = [1, 2];
      break;
    case 2:
      poly = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d - dy }, { x: w - dx, y: d - dy }, { x: w - dx, y: d }, { x: 0, y: d }];
      map = [{ wi: 0, ds: 0 }, { wi: 1, ds: 0 }, { wi: 4, ds: -dx }, { wi: 5, ds: 0 }];
      notchWalls = [2, 3];
      break;
    case 3:
      poly = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: dx, y: d }, { x: dx, y: d - dy }, { x: 0, y: d - dy }];
      map = [{ wi: 0, ds: 0 }, { wi: 1, ds: 0 }, { wi: 2, ds: 0 }, { wi: 5, ds: -dy }];
      notchWalls = [3, 4];
      break;
    default:
      // Nullpunkt wandert nach (dx, 0) → alles um −dx verschieben
      shift = dx;
      poly = [{ x: 0, y: 0 }, { x: w - dx, y: 0 }, { x: w - dx, y: d }, { x: -dx, y: d }, { x: -dx, y: dy }, { x: 0, y: dy }];
      map = [{ wi: 0, ds: -dx }, { wi: 1, ds: 0 }, { wi: 2, ds: 0 }, { wi: 3, ds: 0 }];
      notchWalls = [4, 5];
  }
  const oldWalls = r.walls;
  r.polygon = poly;
  r.walls = poly.map((_, i) => {
    const from = map.findIndex((m) => m.wi === i);
    const base = from >= 0 ? { ...oldWalls[from] } : { ...oldWalls[0], label: '', exterior: false, loadBearing: false, preWall: [], zones: [], note: '' };
    const wall = { ...base, index: i };
    if (from >= 0) {
      wall.preWall = wall.preWall.map((p) => ({ ...p, from: Math.max(0, p.from + map[from].ds), to: Math.max(0, p.to + map[from].ds) })).filter((p) => p.to > p.from);
      wall.zones = wall.zones.map((z) => ({ ...z, from: Math.max(0, z.from + map[from].ds), to: Math.max(0, z.to + map[from].ds) })).filter((z) => z.to > z.from);
    }
    return wall;
  });
  for (const wi of notchWalls) {
    const a = poly[wi];
    const b = poly[(wi + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    r.walls[wi].label = zoneKind === 'kaminwange' ? 'Kaminwange' : 'Vorsprung';
    if (zoneKind) r.walls[wi].zones = [{ id: `${r.id}_notch_${wi}`, kind: zoneKind, from: 0, to: len, zFrom: 0, depth: 0, note: '' }];
  }
  const re = <T extends { wallIndex?: number; s?: number }>(o: T) => {
    if (o.wallIndex == null) return;
    const m = map[o.wallIndex];
    o.wallIndex = m.wi;
    if (o.s != null) o.s = Math.max(0, o.s + m.ds);
  };
  r.doors.forEach(re);
  r.windows.forEach(re);
  r.outlets.forEach((o) => { re(o); if (o.x != null) o.x -= shift; });
  r.furniture.forEach((f) => { if (f.wallIndex != null) f.wallIndex = map[f.wallIndex].wi; f.x -= shift; });
  r.obstacles.forEach((o) => { if (o.wallIndex != null) o.wallIndex = map[o.wallIndex].wi; o.x -= shift; });
  r.originOnFloor = { x: r.originOnFloor.x + shift, y: r.originOnFloor.y };
  return r;
}

/** Rechteckmaße eines Raums ändern (nur bei Rechteck). */
export function resizeRect(room: Room, width: number, depth: number): Room {
  if (!isRectRoom(room)) return room;
  const r: Room = JSON.parse(JSON.stringify(room));
  r.polygon = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }];
  return r;
}

// ---------------------------------------------------------------------------
// Allgemein (beliebiger rechtwinkliger Raum, auch mehrfach anwendbar)
// ---------------------------------------------------------------------------

export type NotchZone = 'kaminwange' | 'tabu' | null;
type P = { x: number; y: number };
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P, f = 1): P => ({ x: a.x + b.x * f, y: a.y + b.y * f });
const unit = (v: P): P => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const rnd = (p: P): P => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/** Ecken, die sich aussparen lassen (nach außen zeigend), mit den beiden anliegenden Wänden. */
export function convexCorners(room: Room): { vertex: number; wallIn: number; wallOut: number; lenIn: number; lenOut: number }[] {
  const p = room.polygon;
  const n = p.length;
  const out = [];
  for (let v = 0; v < n; v++) {
    const prev = p[(v - 1 + n) % n], cur = p[v], next = p[(v + 1) % n];
    const dIn = sub(cur, prev), dOut = sub(next, cur);
    if (dIn.x * dOut.y - dIn.y * dOut.x <= 0) continue; // einspringende Ecke
    out.push({ vertex: v, wallIn: (v - 1 + n) % n, wallOut: v, lenIn: Math.hypot(dIn.x, dIn.y), lenOut: Math.hypot(dOut.x, dOut.y) });
  }
  return out;
}

/**
 * Neue Wände übernehmen Eigenschaften und bekommen ggf. eine Tabuzone.
 * `map[alteWand](s)` liefert neue Wand und neues s für Bezüge.
 */
function rebuild(r: Room, poly: P[], wallFrom: (newIndex: number) => number | null, map: (wi: number, s: number) => { wi: number; s: number }, notchWalls: number[], zone: NotchZone, label: string, shift: P = { x: 0, y: 0 }) {
  const old = r.walls;
  const base = old[0];
  r.polygon = poly.map((q) => rnd({ x: q.x - shift.x, y: q.y - shift.y }));
  r.walls = r.polygon.map((_, i) => {
    const from = wallFrom(i);
    const w = from != null ? { ...old[from] } : { ...base, label: '', exterior: false, loadBearing: false, preWall: [], zones: [], note: '' };
    return { ...w, index: i, preWall: [] as typeof w.preWall, zones: [] as typeof w.zones };
  });
  // Zonen und Vorwände der alten Wände an die neue Stelle legen (Anfang und Ende getrennt abbilden)
  for (const [oi, w] of old.entries()) {
    for (const z of w.zones) {
      const a = map(oi, z.from + 0.01), b = map(oi, z.to - 0.01);
      if (a.wi !== b.wi) continue; // über den Vorsprung hinweg: entfällt, der Vorsprung trägt eine eigene Zone
      r.walls[a.wi].zones.push({ ...z, from: Math.max(0, Math.round((a.s - 0.01) * 10) / 10), to: Math.round((b.s + 0.01) * 10) / 10 });
    }
    for (const pw of w.preWall) {
      const a = map(oi, pw.from + 0.01), b = map(oi, pw.to - 0.01);
      if (a.wi !== b.wi) continue;
      r.walls[a.wi].preWall.push({ ...pw, from: Math.max(0, Math.round((a.s - 0.01) * 10) / 10), to: Math.round((b.s + 0.01) * 10) / 10 });
    }
  }
  for (const w of r.walls) { w.zones = w.zones.filter((z) => z.to > z.from); w.preWall = w.preWall.filter((x) => x.to > x.from); }
  for (const wi of notchWalls) {
    const a = r.polygon[wi], b = r.polygon[(wi + 1) % r.polygon.length];
    r.walls[wi].label = label;
    r.walls[wi].preWall = [];
    r.walls[wi].zones = zone ? [{ id: `${r.id}_v${wi}_${Math.round(a.x)}_${Math.round(a.y)}`, kind: zone, from: 0, to: Math.hypot(b.x - a.x, b.y - a.y), zFrom: 0, depth: 0, note: '' }] : [];
  }
  const re = <T extends { wallIndex?: number; s?: number }>(o: T) => {
    if (o.wallIndex == null) return;
    const m = map(o.wallIndex, o.s ?? 0);
    o.wallIndex = m.wi;
    if (o.s != null) o.s = Math.round(Math.max(0, m.s) * 10) / 10;
  };
  r.doors.forEach(re);
  r.windows.forEach(re);
  r.outlets.forEach((o) => { re(o); if (o.x != null) o.x -= shift.x; if (o.y != null) o.y -= shift.y; });
  r.furniture.forEach((f) => { if (f.wallIndex != null) f.wallIndex = map(f.wallIndex, 0).wi; f.x -= shift.x; f.y -= shift.y; });
  r.obstacles.forEach((o) => { if (o.wallIndex != null) o.wallIndex = map(o.wallIndex, 0).wi; o.x -= shift.x; o.y -= shift.y; });
  r.originOnFloor = { x: r.originOnFloor.x + shift.x, y: r.originOnFloor.y + shift.y };
}

/**
 * Spart an einer Ecke ein Rechteck aus (Kamin, Schacht in der Ecke).
 * `alongIn` = Länge entlang der Wand, die in die Ecke läuft; `alongOut` = entlang der Wand, die von der Ecke weg läuft.
 * Liegt die Ecke im Nullpunkt, wandert der Nullpunkt ans Ende des Vorsprungs (wie bisher).
 */
export function notchCorner(room: Room, vertex: number, alongIn: number, alongOut: number, zone: NotchZone = 'kaminwange'): Room {
  const c = convexCorners(room).find((x) => x.vertex === vertex);
  if (!c) throw new Error('An dieser Ecke kann nichts ausgespart werden.');
  if (!(alongIn > 0 && alongOut > 0) || alongIn >= c.lenIn || alongOut >= c.lenOut) throw new Error('Der Vorsprung muss kleiner sein als die beiden Wände an der Ecke.');
  const r: Room = JSON.parse(JSON.stringify(room));
  const p = r.polygon, n = p.length, cur = p[vertex];
  const dIn = unit(sub(cur, p[(vertex - 1 + n) % n])), dOut = unit(sub(p[(vertex + 1) % n], cur));
  const P1 = add(cur, dIn, -alongIn), P3 = add(cur, dOut, alongOut), P2 = add(P1, dOut, alongOut);
  const label = zone === 'kaminwange' ? 'Kaminwange' : 'Vorsprung';
  if (vertex === 0) {
    // [P3, p1 … p(n-1), P1, P2]: Wand 0 verkürzt (s − alongOut), letzte Wand endet an P1, Vorsprung = Wände n, n+1
    const poly = [P3, ...p.slice(1), P1, P2];
    rebuild(r, poly, (i) => (i < n ? i : null), (wi, s) => (wi === 0 ? { wi: 0, s: s - alongOut } : { wi, s }), [n, n + 1], zone, label, P3);
  } else {
    const poly = [...p.slice(0, vertex), P1, P2, P3, ...p.slice(vertex + 1)];
    rebuild(r, poly, (i) => (i < vertex ? i : i < vertex + 2 ? null : i - 2),
      (wi, s) => (wi < vertex ? { wi, s } : wi === vertex ? { wi: vertex + 2, s: s - alongOut } : { wi: wi + 2, s }), [vertex, vertex + 1], zone, label);
  }
  return r;
}

/** Vorsprung mitten an einer Wand (Pfeiler, Schacht, Kamin): `from` ab linker Wandecke, `width` entlang der Wand, `depth` in den Raum. */
export function projectWall(room: Room, wallIndex: number, from: number, width: number, depth: number, zone: NotchZone = 'kaminwange'): Room {
  const p = room.polygon, n = p.length;
  const A = p[wallIndex], B = p[(wallIndex + 1) % n];
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  if (!(from > 0 && width > 0 && depth > 0) || from + width >= len) throw new Error('Der Vorsprung muss ganz auf der Wand liegen. Liegt er in einer Ecke, „Ecke ausgespart“ wählen.');
  const r: Room = JSON.parse(JSON.stringify(room));
  const d = unit(sub(B, A)), nrm = { x: -d.y, y: d.x };
  const Q1 = add(A, d, from), Q2 = add(Q1, nrm, depth), Q3 = add(Q2, d, width), Q4 = add(A, d, from + width);
  const poly = [...p.slice(0, wallIndex + 1), Q1, Q2, Q3, Q4, ...p.slice(wallIndex + 1)];
  const end = from + width;
  rebuild(r, poly, (i) => (i <= wallIndex ? i : i <= wallIndex + 3 ? null : i === wallIndex + 4 ? wallIndex : i - 4),
    (wi, s) => (wi < wallIndex ? { wi, s } : wi > wallIndex ? { wi: wi + 4, s }
      : s >= end ? { wi: wallIndex + 4, s: s - end } : s > from ? { wi: wallIndex + 2, s: s - from } : { wi, s }),
    [wallIndex + 1, wallIndex + 2, wallIndex + 3], zone, zone === 'kaminwange' ? 'Kamin' : 'Vorsprung');
  return r;
}
