/**
 * Geometrie-Hilfen: Wände aus dem Raumpolygon, Positionen auf Wänden,
 * Dosenmitten von Mehrfachkombinationen, Höhenumrechnung.
 */
import type { Door, Outlet, Project, Room, Settings } from '../model/schema';

export interface Pt { x: number; y: number }

export interface WallGeom {
  index: number;
  a: Pt; // linkes Ende (Blick von innen)
  b: Pt; // rechtes Ende
  length: number;
  dir: Pt; // Einheitsvektor a→b
  normal: Pt; // Einheitsvektor in den Raum hinein
}

export function wallGeoms(room: Room): WallGeom[] {
  const p = room.polygon;
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const dir = { x: dx / length, y: dy / length };
    // Polygon im Uhrzeigersinn (y nach unten) → Innenseite = (−dy, dx)
    const normal = { x: -dir.y, y: dir.x };
    return { index: i, a, b, length, dir, normal };
  });
}

export function wallLength(room: Room, index: number): number {
  return wallGeoms(room)[index]?.length ?? 0;
}

/** Punkt auf Wand `index` im Abstand `s` ab linkem Ende, optional `offset` in den Raum. */
export function pointOnWall(room: Room, index: number, s: number, offset = 0): Pt {
  const w = wallGeoms(room)[index];
  return {
    x: w.a.x + w.dir.x * s + w.normal.x * offset,
    y: w.a.y + w.dir.y * s + w.normal.y * offset,
  };
}

/** Vorzeichenbehaftete Fläche (Shoelace); > 0 bei Uhrzeigersinn in y-unten-Koordinaten. */
export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function isClockwise(poly: Pt[]): boolean {
  return signedArea(poly) > 0;
}

export function roomArea(room: Room): number {
  return Math.abs(signedArea(room.polygon)) / 10000; // m²
}

export function bbox(poly: Pt[]) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Rechteck-Polygon (Nullpunkt oben links, Uhrzeigersinn). */
export function rectPolygon(width: number, depth: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

export function futureBuildup(room: Room): number {
  return room.floor.futureAboveRef.reduce((s, l) => s + l.thickness, 0);
}

/** Höhe über Fertigfußboden aus Höhe über Bezug. */
export function zToFfb(room: Room, z: number): number {
  return z - futureBuildup(room);
}

/** Höhe über Bezug aus Höhe über Fertigfußboden. */
export function ffbToZ(room: Room, hFfb: number): number {
  return hFfb + futureBuildup(room);
}

// ---------------------------------------------------------------------------
// Dosenmitten
// ---------------------------------------------------------------------------

export interface BoxCenter {
  /** Nummer innerhalb der Kombination (1 …). */
  n: number;
  s: number;
  z: number;
}

/**
 * Jede einzelne Dosenmitte einer (Mehrfach-)Kombination auf der Wand.
 * `erste_an_position`: s/z ist die erste Dose, weitere in `growth`-Richtung.
 * `mittig`: s/z ist die Mitte der Kombination.
 */
export function boxCenters(outlet: Outlet, settings: Settings): BoxCenter[] {
  if (outlet.mount !== 'wand' || outlet.s == null || outlet.z == null) return [];
  const pitch = settings.boxPitch;
  const conv = outlet.convention ?? settings.boxConvention;
  const n = outlet.gangs;
  const horizontal = outlet.orientation === 'waagerecht';
  let sign = 1;
  if (horizontal) sign = outlet.growth === 'links' ? -1 : 1;
  else sign = outlet.growth === 'unten' ? -1 : 1;
  const start = conv === 'mittig' ? -((n - 1) / 2) * pitch * sign : 0;
  const res: BoxCenter[] = [];
  for (let i = 0; i < n; i++) {
    const d = start + i * pitch * sign;
    res.push({
      n: i + 1,
      s: round1(horizontal ? outlet.s + d : outlet.s),
      z: round1(horizontal ? outlet.z : outlet.z + d),
    });
  }
  return res;
}

/** Außenmaß der Kombination auf der Wand (Rahmen ca. 8 cm je Platz). */
export function outletExtent(outlet: Outlet, settings: Settings) {
  const c = boxCenters(outlet, settings);
  if (!c.length) return null;
  const half = 4.0; // halber Rahmen (≈ 80 mm)
  const ss = c.map((b) => b.s);
  const zs = c.map((b) => b.z);
  return {
    sMin: Math.min(...ss) - half,
    sMax: Math.max(...ss) + half,
    zMin: Math.min(...zs) - half,
    zMax: Math.max(...zs) + half,
  };
}

// ---------------------------------------------------------------------------
// Türen
// ---------------------------------------------------------------------------

/** s-Position der Griffseite (Schloss) einer Tür auf ihrer Wand. */
export function doorHandleSide(door: Door): 'links' | 'rechts' {
  // Bänder links → Griff rechts (gilt für beide Aufschlagrichtungen, Blick von innen)
  return door.hinge === 'links' ? 'rechts' : 'links';
}

/** Empfohlene Schalterposition neben der Tür (Praxisregel). */
export function suggestedSwitchS(door: Door, distWithFrame = 15, distWithoutFrame = 18): number {
  const d = door.hasFrame ? distWithFrame : distWithoutFrame;
  return doorHandleSide(door) === 'rechts' ? door.s + door.width + d : door.s - d;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function fmt(v: number | undefined | null, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '–';
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return r.toLocaleString('de-DE', { maximumFractionDigits: digits });
}

export function roomById(project: Project, id: string | undefined): Room | undefined {
  return project.rooms.find((r) => r.id === id);
}

export function wallName(room: Room, index: number): string {
  const w = room.walls[index];
  const base = `Wand ${index + 1}`;
  return w?.label ? `${base} (${w.label})` : base;
}
