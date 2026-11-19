/**
 * Grundriss aus Türverbindungen: Räume, deren Türen miteinander verknüpft sind
 * („Tür in der Küche führt in den Flur“), werden im Geschoss so gedreht und
 * verschoben, dass die beiden Türen genau gegenüberliegen – mit der Wandstärke
 * dazwischen. So entsteht beim Anlegen Raum für Raum ein Grundriss.
 *
 * Räume, deren Lage aus einem Plan stammt oder von Hand gesetzt wurde, bleiben
 * fest; berechnet werden nur die übrigen (placedBy leer oder „tueren“).
 */
import type { Door, Project, Room } from '../model/schema';
import { floorPolygon, rotatePt, toFloor, wallGeoms, type Pt } from './room';

export const DEFAULT_WALL_THICKNESS = 12; // cm, typische tragende/nichttragende Innenwand im Rohbau (Annahme, je Wand änderbar)
const ROTATIONS = [0, 90, 180, 270] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, '');

/** Gegenstück einer verknüpften Tür im Nachbarraum suchen (noch ohne Partner). */
function findPartner(from: Room, door: Door, target: Room): Door | undefined {
  const free = target.doors.filter((d) => !d.pairDoorId || d.pairDoorId === door.id);
  const explicit = free.filter((d) => d.leadsToRoomId === from.id);
  const byName = free.filter((d) => !d.leadsToRoomId && d.leadsTo && norm(d.leadsTo) === norm(from.name));
  const open = free.filter((d) => !d.leadsToRoomId && !d.leadsTo);
  const pool = explicit.length ? explicit : byName.length ? byName : open.length === 1 ? open : [];
  // bei mehreren: die mit der ähnlichsten Breite
  return [...pool].sort((a, b) => Math.abs(a.width - door.width) - Math.abs(b.width - door.width))[0];
}

/**
 * Tür mit einem Raum verknüpfen (oder lösen: targetRoomId = null) und das
 * Gegenstück im Nachbarraum zuordnen. Arbeitet auf einem veränderbaren Projekt (Immer-Entwurf).
 */
export function linkDoor(p: Project, roomId: string, doorId: string, targetRoomId: string | null, freeText = '') {
  const room = p.rooms.find((r) => r.id === roomId);
  const door = room?.doors.find((d) => d.id === doorId);
  if (!room || !door) return;
  // alte Verknüpfung lösen
  if (door.pairDoorId) {
    for (const r of p.rooms) for (const d of r.doors) if (d.id === door.pairDoorId && d.pairDoorId === door.id) d.pairDoorId = undefined;
    door.pairDoorId = undefined;
  }
  if (!targetRoomId) { door.leadsToRoomId = undefined; door.leadsTo = freeText; return; }
  const target = p.rooms.find((r) => r.id === targetRoomId);
  if (!target) return;
  door.leadsToRoomId = target.id;
  door.leadsTo = target.name;
  pairDoors(p);
}

/** Alle verknüpften, noch unverbundenen Türen ihrem Gegenstück zuordnen; verwaiste Verknüpfungen lösen. */
export function pairDoors(p: Project) {
  const where = new Map<string, { room: Room; door: Door }>();
  for (const room of p.rooms) for (const door of room.doors) where.set(door.id, { room, door });
  for (const room of p.rooms) for (const door of room.doors) {
    if (!door.pairDoorId) continue;
    const other = where.get(door.pairDoorId);
    if (!other || other.door.pairDoorId !== door.id || door.leadsToRoomId !== other.room.id || other.door.leadsToRoomId !== room.id) door.pairDoorId = undefined;
  }
  // Freitext „führt zu Flur“ einem inzwischen angelegten Raum gleichen Namens zuordnen
  for (const room of p.rooms) for (const door of room.doors) {
    if (door.leadsToRoomId || !door.leadsTo) continue;
    const named = p.rooms.filter((r) => r.floorId === room.floorId && r.id !== room.id && norm(r.name) === norm(door.leadsTo));
    if (named.length === 1) door.leadsToRoomId = named[0].id;
  }
  for (const room of p.rooms) {
    for (const door of room.doors) {
      if (door.pairDoorId || !door.leadsToRoomId) continue;
      const target = p.rooms.find((r) => r.id === door.leadsToRoomId);
      if (!target || target.floorId !== room.floorId) continue;
      const partner = findPartner(room, door, target);
      if (!partner) continue;
      door.pairDoorId = partner.id;
      partner.pairDoorId = door.id;
      partner.leadsToRoomId = room.id;
      partner.leadsTo = room.name;
    }
  }
}

export interface Placement { roomId: string; origin: Pt; rotation: 0 | 90 | 180 | 270 }
export interface FloorLayout {
  placements: Placement[];
  /** Räume ohne Türverbindung zu den übrigen (bleiben, wo sie sind, bzw. werden daneben abgelegt) */
  unconnected: string[];
  problems: string[];
}

const movable = (r: Room) => r.placedBy !== 'plan' && r.placedBy !== 'hand';

/** Mittelpunkt einer Tür in Raumkoordinaten und Richtung ihrer Wand. */
function doorFrame(room: Room, d: Door) {
  const w = wallGeoms(room)[d.wallIndex];
  if (!w) return null;
  const s = d.s + d.width / 2;
  return { c: { x: w.a.x + w.dir.x * s, y: w.a.y + w.dir.y * s }, dir: w.dir, normal: w.normal, thickness: room.walls[d.wallIndex]?.thickness };
}

/** Lage aller Räume eines Geschosses aus den Türverbindungen berechnen (ändert nichts). */
export function layoutFloor(project: Project, floorId: string): FloorLayout {
  const rooms = project.rooms.filter((r) => r.floorId === floorId);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const placed = new Map<string, Placement>();
  const problems: string[] = [];
  const queue: string[] = [];
  const fix = (r: Room) => { placed.set(r.id, { roomId: r.id, origin: { ...r.originOnFloor }, rotation: r.rotation ?? 0 }); queue.push(r.id); };

  // Startpunkte: Räume mit fester Lage, sonst der erste Raum
  for (const r of rooms) if (!movable(r)) fix(r);
  const connected = (r: Room) => r.doors.some((d) => d.pairDoorId && d.leadsToRoomId && byId.has(d.leadsToRoomId));
  if (!placed.size) { const first = rooms.find(connected) ?? rooms[0]; if (first) fix(first); }

  const place = () => {
    while (queue.length) {
      const xId = queue.shift()!;
      const x = byId.get(xId)!;
      const px = placed.get(xId)!;
      const xr = { ...x, originOnFloor: px.origin, rotation: px.rotation };
      for (const dx of x.doors) {
        const y = dx.leadsToRoomId ? byId.get(dx.leadsToRoomId) : undefined;
        const dy = y?.doors.find((d) => d.id === dx.pairDoorId);
        if (!y || !dy) continue;
        const fx = doorFrame(x, dx), fy = doorFrame(y, dy);
        if (!fx || !fy) continue;
        const wx = toFloor(xr, fx.c);
        const dirX = rotatePt(fx.dir, px.rotation);
        const out = rotatePt({ x: -fx.normal.x, y: -fx.normal.y }, px.rotation); // aus dem Raum X hinaus
        const t = fx.thickness ?? fy.thickness ?? DEFAULT_WALL_THICKNESS;
        // Drehung für Y: seine Türwand muss der von X genau entgegenlaufen
        const rot = ROTATIONS.find((r) => { const d = rotatePt(fy.dir, r); return Math.abs(d.x + dirX.x) < 0.02 && Math.abs(d.y + dirX.y) < 0.02; });
        if (rot == null) { problems.push(`${x.name} ↔ ${y.name}: Die Türwände stehen schräg zueinander – Lage bitte von Hand setzen.`); continue; }
        const rel = rotatePt(fy.c, rot);
        const origin = { x: Math.round((wx.x + out.x * t - rel.x) * 10) / 10, y: Math.round((wx.y + out.y * t - rel.y) * 10) / 10 };
        const have = placed.get(y.id);
        if (have) {
          const dev = Math.hypot(have.origin.x - origin.x, have.origin.y - origin.y);
          if (have.rotation !== rot || dev > 10) problems.push(`${x.name} ↔ ${y.name}: Die Maße passen nicht ganz zusammen (Abweichung ${have.rotation !== rot ? 'in der Ausrichtung' : `${Math.round(dev)} cm`}). Raummaße oder Türlage prüfen.`);
          continue;
        }
        if (!movable(y)) continue;
        placed.set(y.id, { roomId: y.id, origin, rotation: rot });
        queue.push(y.id);
      }
    }
  };
  place();
  // weitere Gruppen ohne Verbindung zur ersten: eigener Startraum, rechts daneben ablegen
  let guard = 0;
  while (guard++ < rooms.length) {
    const rest = rooms.filter((r) => !placed.has(r.id) && connected(r));
    if (!rest.length) break;
    fix(rest[0]);
    place();
  }

  const unconnected = rooms.filter((r) => !placed.has(r.id)).map((r) => r.id);
  // Überlappungen prüfen
  const boxes = [...placed.values()].map((pl) => {
    const r = byId.get(pl.roomId)!;
    const poly = floorPolygon({ ...r, originOnFloor: pl.origin, rotation: pl.rotation });
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    return { r, minX: Math.min(...xs) + 2, maxX: Math.max(...xs) - 2, minY: Math.min(...ys) + 2, maxY: Math.max(...ys) - 2, rect: r.polygon.length === 4 };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.rect && b.rect && a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY) problems.push(`${a.r.name} und ${b.r.name} überlappen sich – Raummaße oder Türlage prüfen.`);
  }
  return { placements: [...placed.values()].filter((pl) => movable(byId.get(pl.roomId)!)), unconnected, problems };
}

/** Berechnete Lage übernehmen (nur für Räume, die das Programm verschieben darf). */
export function applyLayout(p: Project, floorId: string): FloorLayout {
  const res = layoutFloor(p, floorId);
  for (const pl of res.placements) {
    const r = p.rooms.find((x) => x.id === pl.roomId);
    if (!r || !movable(r)) continue;
    r.originOnFloor = pl.origin;
    r.rotation = pl.rotation;
    r.placedBy = 'tueren';
  }
  return res;
}
