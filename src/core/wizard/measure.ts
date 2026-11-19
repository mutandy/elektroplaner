/**
 * Aufmaß Schritt für Schritt (fürs Handy): aus zwei Innenmaßen, der Höhe und
 * den Öffnungen (Türen, Fenster, Tore, Durchgänge …) wird ein Rechteckraum
 * mit richtig sitzenden Öffnungen.
 *
 * Wandzählung wie im ganzen Programm: Wand 1 ist die Wand, vor der man steht
 * (im Plan oben). Im Uhrzeigersinn folgen Wand 2 (rechts), Wand 3 (gegenüber,
 * hinter einem) und Wand 4 (links). Abstände werden mit Blick auf die Wand
 * von der linken Ecke gemessen – wahlweise von rechts, dann wird umgerechnet.
 *
 * Kamin, Schacht oder Vorsprung: in einer Ecke ausgespart oder mitten an einer
 * Wand. Sie werden vor den Öffnungen erfasst; Türen und Fenster misst man dann
 * an den echten Wänden (z. B. ab der Kaminkante).
 */
import type { Door, Room, Window } from '../model/schema';
import { createRectRoom, newId } from '../model/factory';
import { notchCorner, projectWall, type NotchZone } from '../geometry/edit';
import { wallGeoms } from '../geometry/room';

export type OpeningKind = 'tuer' | 'fenster' | 'tor' | 'durchgang' | 'sonstiges';

export const openingKindLabel: Record<OpeningKind, string> = {
  tuer: 'Tür',
  fenster: 'Fenster',
  tor: 'Garagentor / Tor',
  durchgang: 'Durchgang ohne Tür',
  sonstiges: 'Sonstige Öffnung (Durchreiche, Lüftung …)',
};

export interface MeasuredOpening {
  id: string;
  kind: OpeningKind;
  /** 0–3 */
  wall: number;
  /** Abstand von der Ecke bis zur Rohbaukante der Öffnung (cm) */
  distance: number;
  /** von welcher Ecke gemessen (Blick auf die Wand) */
  from: 'links' | 'rechts';
  width: number;
  height: number;
  /** Fenster/sonstige: Brüstungshöhe über Fußboden (cm) */
  sill?: number;
  /** Tür: Bänder (Scharniere) links/rechts, Blick von innen */
  hinge?: 'links' | 'rechts';
  /** Tür: geht in den Raum auf? */
  swing?: 'innen' | 'aussen';
  leadsTo?: string;
  /** Tür/Durchgang führt in diesen (schon angelegten) Raum */
  leadsToRoomId?: string;
}

export type NotchWhat = 'kamin' | 'schacht' | 'vorsprung';
export const notchWhatLabel: Record<NotchWhat, string> = { kamin: 'Kamin', schacht: 'Schacht', vorsprung: 'Pfeiler / Vorsprung' };
const zoneOf = (w: NotchWhat): NotchZone => (w === 'kamin' ? 'kaminwange' : 'tabu');

/** Kamin, Schacht, Vorsprung – bezogen auf das Rechteck aus Wand 1 und Wand 2. */
export interface MeasuredNotch {
  id: string;
  kind: 'ecke' | 'wand';
  what: NotchWhat;
  /** Ecke: 0 = zwischen Wand 4 und 1, 1 = Wand 1/2, 2 = Wand 2/3, 3 = Wand 3/4 */
  corner?: 0 | 1 | 2 | 3;
  /** Wand (0–3) und Abstand von ihrer linken Ecke */
  wall?: number;
  from?: number;
  /** Ecke: entlang der Wand, die in die Ecke läuft / entlang der Wand, die von ihr weg läuft. Wand: Breite entlang / Tiefe in den Raum. */
  a: number;
  b: number;
}

export interface MeasureDraft {
  name: string;
  /** Länge Wand 1 (= Wand 3 im Rechteck) */
  length1: number | null;
  /** Länge Wand 2 (= Wand 4 im Rechteck) */
  length2: number | null;
  height: number | null;
  notches: MeasuredNotch[];
  openings: MeasuredOpening[];
  /** Raum hat schon eine eigene Form: nur Höhe und Öffnungen werden erfasst */
  fixedPolygon?: { x: number; y: number }[];
}

export const emptyDraft = (name = ''): MeasureDraft => ({ name, length1: null, length2: null, height: null, notches: [], openings: [] });

export const WALL_HINT = ['vor dir (Start)', 'rechts', 'gegenüber / hinter dir', 'links'];

/** Wände der Ecke k im Rechteck: Wand davor (läuft in die Ecke) und Wand danach. */
export const cornerWalls = (k: number) => [(k + 3) % 4, k] as const;

/**
 * Form des Raums aus dem Aufmaß: Rechteck, dann Vorsprünge an Wänden (von hinten nach vorn,
 * damit Wandnummern stimmen), dann Ecken (Nullpunkt-Ecke zuletzt). Wirft bei unmöglichen Maßen.
 */
export function shapeRoom(d: Pick<MeasureDraft, 'length1' | 'length2' | 'notches' | 'fixedPolygon'>, base?: Room): Room {
  if (d.fixedPolygon) return { ...(base ?? createRectRoom({ id: 'aufmass', floorId: 'x', name: 'x', width: 100, depth: 100, height: 250 })), polygon: d.fixedPolygon } as Room;
  const w = d.length1 || 400, dep = d.length2 || 300;
  let r: Room = base
    ? { ...JSON.parse(JSON.stringify(base)), polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: dep }, { x: 0, y: dep }] }
    : createRectRoom({ id: 'aufmass', floorId: 'x', name: 'x', width: w, depth: dep, height: 250 });
  if (base) {
    while (r.walls.length > 4) r.walls.pop();
    while (r.walls.length < 4) r.walls.push({ ...r.walls[r.walls.length - 1], index: r.walls.length, label: '', preWall: [], zones: [] } as Room['walls'][number]);
    r.walls.forEach((x, i) => { x.index = i; x.zones = x.zones.filter((z) => z.kind !== 'kaminwange' && z.kind !== 'tabu'); });
  }
  const walls = d.notches.filter((n) => n.kind === 'wand').sort((x, y) => (y.wall! - x.wall!) || (y.from! - x.from!));
  for (const n of walls) r = projectWall(r, n.wall!, n.from!, n.a, n.b, zoneOf(n.what));
  const rectCorner = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: dep }, { x: 0, y: dep }];
  for (const n of d.notches.filter((x) => x.kind === 'ecke').sort((x, y) => (y.corner! - x.corner!))) {
    const c = rectCorner[n.corner!];
    const v = r.polygon.findIndex((p) => Math.abs(p.x - c.x) < 0.05 && Math.abs(p.y - c.y) < 0.05);
    if (v < 0) throw new Error('Zwei Vorsprünge überschneiden sich.');
    r = notchCorner(r, v, n.a, n.b, zoneOf(n.what));
  }
  return r;
}

/** Wandlängen der tatsächlichen Form (bei unmöglichen Maßen: das Rechteck). */
export function shapeWalls(d: Pick<MeasureDraft, 'length1' | 'length2' | 'notches' | 'fixedPolygon'>): { length: number; label: string }[] {
  let r: Room;
  try { r = shapeRoom(d); } catch { r = shapeRoom({ ...d, notches: [] }); }
  return wallGeoms(r).map((g, i) => ({ length: Math.round(g.length * 10) / 10, label: r.walls[i]?.label ?? '' }));
}

export function notchError(d: MeasureDraft, n: MeasuredNotch): string | null {
  try { shapeRoom({ ...d, notches: [...d.notches.filter((x) => x.id !== n.id), n] }); return null; } catch (e) { return (e as Error).message; }
}

export function wallLengthOf(d: Pick<MeasureDraft, 'length1' | 'length2' | 'notches' | 'fixedPolygon'>, wall: number): number {
  return shapeWalls(d)[wall]?.length ?? 0;
}

/** Position der linken Öffnungskante ab linker Wandecke (s im Programm). */
export function openingS(d: Pick<MeasureDraft, 'length1' | 'length2' | 'notches' | 'fixedPolygon'>, o: Pick<MeasuredOpening, 'wall' | 'distance' | 'from' | 'width'>): number {
  return o.from === 'links' ? o.distance : wallLengthOf(d, o.wall) - o.distance - o.width;
}

export function defaultsFor(kind: OpeningKind): Pick<MeasuredOpening, 'width' | 'height' | 'sill' | 'hinge' | 'swing'> {
  switch (kind) {
    case 'tuer': return { width: 88.5, height: 201, hinge: 'links', swing: 'innen' };
    case 'fenster': return { width: 101, height: 126, sill: 90 };
    case 'tor': return { width: 250, height: 212 };
    case 'durchgang': return { width: 90, height: 200 };
    case 'sonstiges': return { width: 50, height: 50, sill: 100 };
  }
}

/** Plausibilität einer Öffnung; leere Liste = in Ordnung. */
export function checkOpening(d: MeasureDraft, o: MeasuredOpening): string[] {
  const out: string[] = [];
  const len = wallLengthOf(d, o.wall);
  const s = openingS(d, o);
  if (!(o.width > 0)) out.push('Breite fehlt.');
  if (!(o.height > 0)) out.push('Höhe fehlt.');
  if (len && (s < 0 || s + o.width > len + 0.01)) out.push(`Passt nicht auf Wand ${o.wall + 1} (${len} cm lang): Öffnung läge bei ${round(s)}–${round(s + o.width)} cm.`);
  if (d.height && (o.sill ?? 0) + o.height > d.height + 0.01) out.push(`Höher als der Raum (${d.height} cm).`);
  for (const x of d.openings) {
    if (x.id === o.id || x.wall !== o.wall) continue;
    const xs = openingS(d, x);
    const vertical = (o.sill ?? 0) < (x.sill ?? 0) + x.height && (x.sill ?? 0) < (o.sill ?? 0) + o.height;
    if (s < xs + x.width && xs < s + o.width && vertical) out.push(`Überschneidet sich mit ${openingKindLabel[x.kind]} auf derselben Wand (${round(xs)}–${round(xs + x.width)} cm).`);
  }
  return out;
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Türen und Fenster in Programm-Form. */
export function openingsToRoom(d: MeasureDraft): { doors: Door[]; windows: Window[] } {
  const doors: Door[] = [];
  const windows: Window[] = [];
  let main = false;
  for (const o of d.openings) {
    const s = round(openingS(d, o));
    if (o.kind === 'fenster' || o.kind === 'sonstiges') {
      windows.push({ id: newId('f'), wallIndex: o.wall, s, width: o.width, sill: o.sill ?? 0, height: o.height, status: 'bleibt', lightWell: false, provenance: 'gemessen' });
      continue;
    }
    const isDoor = o.kind === 'tuer';
    doors.push({
      // Kennung behalten: verknüpfte Türen im Nachbarraum zeigen darauf
      id: o.id || newId('t'), wallIndex: o.wall, s, width: o.width, height: o.height,
      leadsToRoomId: o.leadsToRoomId,
      hinge: o.hinge ?? 'links',
      // Durchgang/Tor ohne Türblatt im Raum: kein Aufschlag nach innen
      swing: isDoor ? (o.swing ?? 'innen') : 'aussen',
      hasFrame: isDoor,
      fireRating: 'keine',
      leadsTo: o.leadsTo ?? (o.kind === 'tor' ? 'Außen (Tor)' : o.kind === 'durchgang' ? 'Durchgang' : ''),
      isMainEntrance: isDoor && !main ? (main = true) : false,
      provenance: 'gemessen',
    });
  }
  return { doors, windows };
}

/** Fertiges Aufmaß auf einen bestehenden Raum anwenden (Maße, Höhe, Öffnungen). */
export function applyMeasure(r: Room, d: MeasureDraft): void {
  if (!d.fixedPolygon) {
    // Rechteck + Vorsprünge; Wandangaben (Material …) bleiben, Auslässe und Möbel werden mitgezogen
    const shaped = shapeRoom(d, JSON.parse(JSON.stringify(r)) as Room);
    r.polygon = shaped.polygon;
    r.walls = shaped.walls;
    r.outlets = shaped.outlets;
    r.furniture = shaped.furniture;
    r.obstacles = shaped.obstacles;
    r.originOnFloor = shaped.originOnFloor;
  }
  r.height = d.height!;
  const { doors, windows } = openingsToRoom(d);
  r.doors = doors;
  r.windows = windows;
  if (d.name.trim()) r.name = d.name.trim();
  r.provenance = 'gemessen';
}

export function draftComplete(d: MeasureDraft): boolean {
  if (!d.height || !d.openings.every((o) => checkOpening(d, o).length === 0)) return false;
  if (d.fixedPolygon) return true;
  try { shapeRoom(d); } catch { return false; }
  return !!(d.length1 && d.length2);
}

/**
 * Vorhandener Raum als Ausgangspunkt. Rechteck: alles neu messbar. Andere Form
 * (z. B. schon mit Kamin): die Form bleibt, erfasst werden Höhe und Öffnungen.
 */
export function draftFromRoom(r: Room): MeasureDraft {
  const rect = r.polygon.length === 4;
  const xs = r.polygon.map((p) => p.x), ys = r.polygon.map((p) => p.y);
  const n = r.polygon.length;
  return {
    name: r.name,
    length1: Math.max(...xs) - Math.min(...xs),
    length2: Math.max(...ys) - Math.min(...ys),
    height: r.height,
    notches: [],
    fixedPolygon: rect ? undefined : r.polygon.map((p) => ({ ...p })),
    openings: [
      ...r.doors.filter((x) => x.wallIndex < n).map((x) => ({ id: x.id, kind: (x.hasFrame ? 'tuer' : x.width > 200 ? 'tor' : 'durchgang') as OpeningKind, wall: x.wallIndex, distance: x.s, from: 'links' as const, width: x.width, height: x.height, hinge: x.hinge, swing: x.swing, leadsTo: x.leadsTo, leadsToRoomId: x.leadsToRoomId })),
      ...r.windows.filter((x) => x.wallIndex < n).map((x) => ({ id: x.id, kind: 'fenster' as OpeningKind, wall: x.wallIndex, distance: x.s, from: 'links' as const, width: x.width, height: x.height, sill: x.sill })),
    ],
  };
}
