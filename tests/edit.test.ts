import { describe, expect, it } from 'vitest';
import { notchRectCorner } from '../src/core/geometry/edit';
import { wallGeoms, pointOnWall } from '../src/core/geometry/room';
import { miniProject } from './helpers';

describe('Ecke ausschneiden (Kamin)', () => {
  const room = () => {
    const r = structuredClone(miniProject().rooms[0]); // 400 × 300, Tür in Wand 1 bei s=100
    r.doors.push({ ...r.doors[0], id: 'd2', wallIndex: 2, s: 50 }); // Wand 3 (unten)
    r.windows.push({ id: 'f', wallIndex: 3, s: 120, width: 80, sill: 90, height: 100, status: 'bleibt', lightWell: false, provenance: 'gemessen' });
    return r;
  };

  it('unten links (wie Küche): 6 Wände, Kaminwangen-Zonen, Bezüge verschoben', () => {
    const r = notchRectCorner(room(), 3, 54, 38);
    expect(wallGeoms(r).map((w) => Math.round(w.length))).toEqual([400, 300, 346, 38, 54, 262]);
    expect(r.walls[3].zones[0]).toMatchObject({ kind: 'kaminwange', from: 0, to: 38 });
    expect(r.walls[4].zones[0]).toMatchObject({ kind: 'kaminwange', from: 0, to: 54 });
    // Fenster auf alter Wand 4 (links, s ab unten) liegt jetzt auf Wand 6, s − 38
    expect(r.windows[0]).toMatchObject({ wallIndex: 5, s: 82 });
    // Tür auf Wand 3 bleibt Wand 3, gleiche Weltposition
    expect(pointOnWall(r, r.doors[1].wallIndex, r.doors[1].s)).toEqual(pointOnWall(room(), 2, 50));
  });

  it('oben links (im Nullpunkt): Nullpunkt wandert, Weltlage bleibt gleich', () => {
    const before = room();
    const r = notchRectCorner(before, 0, 50, 40);
    expect(r.polygon[0]).toEqual({ x: 0, y: 0 });
    expect(r.originOnFloor.x).toBe(before.originOnFloor.x + 50);
    const world = (rr: typeof r, wi: number, s: number) => { const p = pointOnWall(rr, wi, s); return { x: p.x + rr.originOnFloor.x, y: p.y + rr.originOnFloor.y }; };
    expect(world(r, r.doors[0].wallIndex, r.doors[0].s)).toEqual(world(before, 0, 100));
    expect(world(r, r.windows[0].wallIndex, r.windows[0].s)).toEqual(world(before, 3, 120));
  });

  it('oben rechts und unten rechts', () => {
    expect(wallGeoms(notchRectCorner(room(), 1, 60, 30)).map((w) => w.length)).toEqual([340, 30, 60, 270, 400, 300]);
    expect(wallGeoms(notchRectCorner(room(), 2, 60, 30)).map((w) => w.length)).toEqual([400, 270, 60, 30, 340, 300]);
  });

  it('lehnt zu große Vorsprünge ab', () => {
    expect(() => notchRectCorner(room(), 1, 500, 30)).toThrow();
  });
});

describe('Vorsprünge allgemein (Kamin, Schacht, Pfeiler)', async () => {
  const { notchCorner, projectWall, convexCorners, notchRectCorner: nrc } = await import('../src/core/geometry/edit');
  const { createRectRoom } = await import('../src/core/model/factory');
  const { wallGeoms: wg, isRectRoom } = await import('../src/core/geometry/room');
  const base = () => createRectRoom({ id: 'r', floorId: 'eg', name: 'Küche', width: 400, depth: 300, height: 250,
    doors: [{ id: 't', wallIndex: 2, s: 250, width: 88.5, height: 201, hinge: 'links', swing: 'innen', hasFrame: true, fireRating: 'keine', leadsTo: '', isMainEntrance: true, provenance: 'gemessen' }] as any });

  it('Ecke unten links wie die Kamin-Küche: gleiche Wände wie die bisherige Funktion', () => {
    const a = notchCorner(base(), 3, 54, 38); // Wand 3 läuft in die Ecke (54 entlang W3), Wand 4 läuft weg (38 entlang W4)
    const b = nrc(base(), 3, 54, 38);
    expect(wg(a).map((w) => w.length)).toEqual(wg(b).map((w) => w.length));
    expect(a.walls.filter((w) => w.zones.some((z) => z.kind === 'kaminwange'))).toHaveLength(2);
  });

  it('mehrere Ecken nacheinander; Nullpunkt-Ecke verschiebt den Nullpunkt', () => {
    let r = notchCorner(base(), 2, 40, 30);
    expect(isRectRoom(r)).toBe(false);
    expect(convexCorners(r).length).toBe(5);
    r = notchCorner(r, 0, 50, 60);
    expect(r.polygon[0]).toEqual({ x: 0, y: 0 });
    expect(r.polygon.length).toBe(8);
    const len = wg(r).map((w) => w.length);
    expect(len.reduce((s, l) => s + l, 0)).toBeCloseTo(2 * (400 + 300), 5); // Umfang eines Rechtecks bleibt bei Eck-Aussparungen gleich
  });

  it('Vorsprung mitten an der Wand: 4 neue Wände, Tür hinter dem Vorsprung wandert auf das Reststück', () => {
    const r = projectWall(base(), 2, 60, 50, 40); // Wand 3 (unten), 60 cm ab linker Ecke, 50 breit, 40 tief
    expect(r.polygon.length).toBe(8);
    const len = wg(r).map((w) => w.length);
    expect(len.slice(2, 7)).toEqual([60, 40, 50, 40, 400 - 110]);
    expect(r.doors[0]).toMatchObject({ wallIndex: 6, s: 250 - 110 });
    expect(r.walls[4].zones[0].kind).toBe('kaminwange');
  });

  it('zu große Maße werden abgelehnt', () => {
    expect(() => notchCorner(base(), 1, 400, 20)).toThrow();
    expect(() => projectWall(base(), 0, 0, 50, 20)).toThrow();
  });
});
