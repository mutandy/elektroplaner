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
