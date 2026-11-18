/** Erzeugen, Laden und Migrieren von Projekten. */
import { Project, Room, SCHEMA_VERSION, type ProjectInput, type RoomInput } from './schema';
import { rectPolygon, isClockwise, type Pt } from '../geometry/room';
import { guessRoomType } from './roomTypes';

let counter = 0;
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createProject(partial: Partial<ProjectInput> = {}): Project {
  const floorId = 'geschoss_eg';
  const base: ProjectInput = {
    schemaVersion: SCHEMA_VERSION,
    id: newId('projekt'),
    name: 'Neues Projekt',
    projectType: 'neubau',
    floors: [{ id: floorId, name: 'Erdgeschoss', level: 0 }],
    rooms: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...partial,
  };
  return Project.parse(base);
}

/** Wände passend zum Polygon erzeugen/ergänzen. */
export function wallsForPolygon(polygon: Pt[], existing: RoomInput['walls'] = [], defaults: Partial<RoomInput['walls'][number]> = {}) {
  return polygon.map((_, i) => ({ ...defaults, ...(existing?.[i] ?? {}), index: i }));
}

export function createRectRoom(
  input: Omit<RoomInput, 'polygon' | 'walls'> & { width: number; depth: number; walls?: RoomInput['walls']; wallDefaults?: Partial<RoomInput['walls'][number]> },
): Room {
  const { width, depth, walls, wallDefaults, ...rest } = input;
  const polygon = rectPolygon(width, depth);
  return Room.parse({ ...rest, polygon, walls: wallsForPolygon(polygon, walls, wallDefaults) });
}

export function createPolygonRoom(
  input: Omit<RoomInput, 'walls'> & { walls?: RoomInput['walls']; wallDefaults?: Partial<RoomInput['walls'][number]> },
): Room {
  const { walls, wallDefaults, ...rest } = input;
  let polygon = rest.polygon;
  if (!isClockwise(polygon)) polygon = [polygon[0], ...polygon.slice(1).reverse()];
  return Room.parse({ ...rest, polygon, walls: wallsForPolygon(polygon, walls, wallDefaults) });
}

export class ProjectLoadError extends Error {
  constructor(message: string, public issues: string[] = []) {
    super(message);
  }
}

/**
 * Migrationen: je Version eine Funktion, die ein Objekt der Version n
 * in Version n+1 überführt. Neue Versionen hier anhängen.
 */
const migrations: Record<number, (p: any) => any> = {
  // v1 → v2: Assistent-Fortschritt, Hintergrund-Grundriss, Raum-Vorgaben.
  // Bestehende Projekte gelten als fertig erfasst.
  1: (p) => {
    const up = (core: any) => ({ ...core, schemaVersion: 2, wizard: core.wizard ?? { finished: true, step: 'start', done: [], skipped: [] } });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v2 → v3: Leitungsweg-Einstellungen je Raum (Standard „auto“), abgelehnte Vorschläge.
  2: (p) => {
    const up = (core: any) => ({ ...core, schemaVersion: 3 });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v3 → v4: Material, Kosten, Aufgaben (alles mit Standardwerten).
  3: (p) => {
    const up = (core: any) => ({ ...core, schemaVersion: 4 });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v4 → v5: Raumtyp + Verbraucher je Raum, Geschosshöhe. Raumtyp wird aus Name/Nutzung erraten.
  4: (p) => {
    const up = (core: any) => ({
      ...core,
      schemaVersion: 5,
      rooms: (core.rooms ?? []).map((r: any) => ({ ...r, roomType: r.roomType ?? guessRoomType(r.name) ?? guessRoomType(r.usage ?? '') })),
    });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v5 → v6: Leitungsweg-Möglichkeiten je Raum (Standard „unbekannt“).
  5: (p) => {
    const up = (core: any) => ({ ...core, schemaVersion: 6 });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v6 → v7: Fotos als Objekte (Data-URL, Beschriftung, Wand), Heimkino-Einstellungen, Leuchten-Lichtstrom.
  6: (p) => {
    const ph = (list: any[]) => (list ?? []).map((x: any, i: number) => (typeof x === 'string' ? { id: `foto_${i + 1}`, dataUrl: x, caption: '', at: '' } : x));
    const up = (core: any) => ({
      ...core,
      schemaVersion: 7,
      rooms: (core.rooms ?? []).map((r: any) => ({ ...r, photos: ph(r.photos) })),
      distributions: (core.distributions ?? []).map((d: any) => ({ ...d, photos: ph(d.photos) })),
    });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
  // v7 → v8: Wallbox wird fest angeschlossen (Leitungsauslass), nicht über eine Geräteanschlussdose.
  7: (p) => {
    const WB = /wallbox|ladestation/i;
    const up = (core: any) => ({
      ...core,
      schemaVersion: 8,
      rooms: (core.rooms ?? []).map((r: any) => {
        const wbLoads = new Set((r.loads ?? []).filter((l: any) => WB.test(l.label ?? '')).map((l: any) => l.outletId).filter(Boolean));
        return {
          ...r,
          loads: (r.loads ?? []).map((l: any) => (WB.test(l.label ?? '') && l.connection === 'anschlussdose' ? { ...l, connection: 'festanschluss' } : l)),
          outlets: (r.outlets ?? []).map((o: any) => (o.kind === 'anschlussdose' && (WB.test(o.note ?? '') || wbLoads.has(o.id))
            ? { ...o, kind: 'festanschluss', inserts: (o.inserts ?? []).filter((i: string) => i !== 'geraeteanschluss') }
            : o)),
        };
      }),
    });
    return { ...up(p), versions: (p.versions ?? []).map((v: any) => ({ ...v, snapshot: up(v.snapshot) })) };
  },
};

export function migrate(raw: any): any {
  let p = raw;
  if (typeof p !== 'object' || p === null) throw new ProjectLoadError('Keine gültige Projektdatei.');
  let v = Number(p.schemaVersion ?? 0);
  if (v > SCHEMA_VERSION) {
    throw new ProjectLoadError(`Projektdatei hat Schema-Version ${v}, dieses Programm kennt nur bis ${SCHEMA_VERSION}. Bitte Programm aktualisieren.`);
  }
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new ProjectLoadError(`Keine Migration von Schema-Version ${v} vorhanden.`);
    p = m(p);
    v = Number(p.schemaVersion);
  }
  return p;
}

/** Projektdatei (JSON-Text oder Objekt) laden, migrieren und validieren. */
export function loadProject(input: string | unknown): Project {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new ProjectLoadError('Die Datei ist kein gültiges JSON.');
    }
  }
  const migrated = migrate(raw);
  const res = Project.safeParse(migrated);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ProjectLoadError('Projektdatei passt nicht zum Datenmodell.', issues);
  }
  return checkReferences(res.data);
}

/** Referenzielle Integrität prüfen (Wandindizes, Stromkreise, Räume). */
export function checkReferences(p: Project): Project {
  const issues: string[] = [];
  const circuitIds = new Set(p.circuits.map((c) => c.id));
  const distIds = new Set(p.distributions.map((d) => d.id));
  const floorIds = new Set(p.floors.map((f) => f.id));
  const roomIds = new Set<string>();
  for (const r of p.rooms) {
    if (roomIds.has(r.id)) issues.push(`Raum-ID doppelt: ${r.id}`);
    roomIds.add(r.id);
    if (!floorIds.has(r.floorId)) issues.push(`${r.name}: Geschoss ${r.floorId} fehlt`);
    if (r.walls.length !== r.polygon.length) issues.push(`${r.name}: Anzahl Wände (${r.walls.length}) ≠ Polygonecken (${r.polygon.length})`);
    const n = r.polygon.length;
    const chk = (what: string, wi: number | undefined) => {
      if (wi != null && (wi < 0 || wi >= n)) issues.push(`${r.name}: ${what} verweist auf Wand ${wi + 1}, die es nicht gibt`);
    };
    r.doors.forEach((d) => chk(`Tür ${d.id}`, d.wallIndex));
    r.windows.forEach((w) => chk(`Fenster ${w.id}`, w.wallIndex));
    const labels = new Set<string>();
    for (const o of r.outlets) {
      chk(`Auslass ${o.label}`, o.wallIndex);
      if (labels.has(o.label)) issues.push(`${r.name}: Auslass-Bezeichnung ${o.label} doppelt`);
      labels.add(o.label);
      if (o.circuitId && !circuitIds.has(o.circuitId)) issues.push(`${r.name}: Auslass ${o.label} verweist auf unbekannten Stromkreis ${o.circuitId}`);
      if (o.mount === 'wand' && (o.wallIndex == null || o.s == null || o.z == null)) issues.push(`${r.name}: Wandauslass ${o.label} braucht Wand, Position und Höhe`);
      if (o.mount !== 'wand' && (o.x == null || o.y == null)) issues.push(`${r.name}: Decken-/Bodenauslass ${o.label} braucht x/y`);
    }
  }
  for (const c of p.circuits) {
    if (!distIds.has(c.distributionId)) issues.push(`Stromkreis ${c.label}: Verteilung ${c.distributionId} fehlt`);
  }
  if (issues.length) throw new ProjectLoadError('Projektdatei ist in sich widersprüchlich.', issues);
  return p;
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}
