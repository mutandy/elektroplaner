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
