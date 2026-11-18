/**
 * Aufmaß Schritt für Schritt (fürs Handy): aus zwei Innenmaßen, der Höhe und
 * den Öffnungen (Türen, Fenster, Tore, Durchgänge …) wird ein Rechteckraum
 * mit richtig sitzenden Öffnungen.
 *
 * Wandzählung wie im ganzen Programm: Wand 1 ist die Wand, vor der man steht
 * (im Plan oben). Im Uhrzeigersinn folgen Wand 2 (rechts), Wand 3 (gegenüber,
 * hinter einem) und Wand 4 (links). Abstände werden mit Blick auf die Wand
 * von der linken Ecke gemessen – wahlweise von rechts, dann wird umgerechnet.
 */
import type { Door, Room, Window } from '../model/schema';
import { newId } from '../model/factory';

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
}

export interface MeasureDraft {
  name: string;
  /** Länge Wand 1 (= Wand 3) */
  length1: number | null;
  /** Länge Wand 2 (= Wand 4) */
  length2: number | null;
  height: number | null;
  openings: MeasuredOpening[];
}

export const emptyDraft = (name = ''): MeasureDraft => ({ name, length1: null, length2: null, height: null, openings: [] });

export const WALL_HINT = ['vor dir (Start)', 'rechts', 'gegenüber / hinter dir', 'links'];

export function wallLengthOf(d: Pick<MeasureDraft, 'length1' | 'length2'>, wall: number): number {
  return (wall % 2 === 0 ? d.length1 : d.length2) ?? 0;
}

/** Position der linken Öffnungskante ab linker Wandecke (s im Programm). */
export function openingS(d: Pick<MeasureDraft, 'length1' | 'length2'>, o: Pick<MeasuredOpening, 'wall' | 'distance' | 'from' | 'width'>): number {
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
      id: newId('t'), wallIndex: o.wall, s, width: o.width, height: o.height,
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
  const w = d.length1!, dep = d.length2!;
  r.polygon = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: dep }, { x: 0, y: dep }];
  // vier Wände; vorhandene Wandangaben (Material …) bleiben, soweit es sie gibt
  while (r.walls.length > 4) r.walls.pop();
  while (r.walls.length < 4) r.walls.push({ ...(r.walls[r.walls.length - 1] ?? {}), index: r.walls.length, label: '', preWall: [], zones: [] } as Room['walls'][number]);
  r.walls.forEach((x, i) => { x.index = i; });
  r.height = d.height!;
  const { doors, windows } = openingsToRoom(d);
  r.doors = doors;
  r.windows = windows;
  if (d.name.trim()) r.name = d.name.trim();
  r.provenance = 'gemessen';
}

export function draftComplete(d: MeasureDraft): boolean {
  return !!(d.length1 && d.length2 && d.height) && d.openings.every((o) => checkOpening(d, o).length === 0);
}

/** Vorhandenen Rechteckraum als Ausgangspunkt (zum Nachmessen). */
export function draftFromRoom(r: Room): MeasureDraft {
  const rect = r.polygon.length === 4;
  const xs = r.polygon.map((p) => p.x), ys = r.polygon.map((p) => p.y);
  return {
    name: r.name,
    length1: rect ? Math.max(...xs) - Math.min(...xs) : null,
    length2: rect ? Math.max(...ys) - Math.min(...ys) : null,
    height: r.height,
    openings: [
      ...r.doors.filter((x) => x.wallIndex < 4).map((x) => ({ id: x.id, kind: (x.hasFrame ? 'tuer' : x.width > 200 ? 'tor' : 'durchgang') as OpeningKind, wall: x.wallIndex, distance: x.s, from: 'links' as const, width: x.width, height: x.height, hinge: x.hinge, swing: x.swing, leadsTo: x.leadsTo })),
      ...r.windows.filter((x) => x.wallIndex < 4).map((x) => ({ id: x.id, kind: 'fenster' as OpeningKind, wall: x.wallIndex, distance: x.s, from: 'links' as const, width: x.width, height: x.height, sill: x.sill })),
    ],
  };
}
