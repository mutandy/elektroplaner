import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createProject, createRectRoom } from '../src/core/model/factory';
import { applyLayout, layoutFloor, linkDoor } from '../src/core/geometry/layout';
import { floorPolygon } from '../src/core/geometry/room';
import type { Door, Project } from '../src/core/model/schema';

const door = (id: string, wallIndex: number, s: number, leadsTo = ''): Door => ({ id, wallIndex, s, width: 90, height: 201, hinge: 'links', swing: 'innen', hasFrame: true, fireRating: 'keine', leadsTo, isMainEntrance: false, provenance: 'gemessen' } as Door);

function twoRooms(): Project {
  const p = createProject({ name: 'Test' });
  const f = p.floors[0].id;
  const kueche = createRectRoom({ id: 'kueche', floorId: f, name: 'Küche', width: 400, depth: 300, height: 250, doors: [door('tk', 0, 50)] as any });
  const flur = createRectRoom({ id: 'flur', floorId: f, name: 'Flur', width: 200, depth: 500, height: 250, doors: [door('tf', 0, 100, 'Küche')] as any });
  return { ...p, rooms: [kueche, flur] } as Project;
}

describe('Grundriss aus Türverbindungen', () => {
  it('Tür verknüpfen findet das Gegenstück im Nachbarraum (gleicher Name)', () => {
    const p = produce(twoRooms(), (d) => { linkDoor(d as Project, 'kueche', 'tk', 'flur'); });
    expect(p.rooms[0].doors[0]).toMatchObject({ leadsToRoomId: 'flur', pairDoorId: 'tf' });
    expect(p.rooms[1].doors[0]).toMatchObject({ leadsToRoomId: 'kueche', pairDoorId: 'tk', leadsTo: 'Küche' });
  });

  it('Flur wird gedreht und so gelegt, dass die Türen gegenüberliegen (12 cm Wand dazwischen)', () => {
    const p = produce(twoRooms(), (d) => { linkDoor(d as Project, 'kueche', 'tk', 'flur'); applyLayout(d as Project, d.floors[0].id); });
    const flur = p.rooms.find((r) => r.id === 'flur')!;
    expect(flur.rotation).toBe(180);
    expect(flur.originOnFloor).toEqual({ x: 240, y: -12 });
    const fp = floorPolygon(flur);
    expect(Math.max(...fp.map((q) => q.y))).toBe(-12); // Unterkante Flur 12 cm über der Küche
    expect(flur.placedBy).toBe('tueren');
  });

  it('von Hand gesetzter Flur bleibt fest, die Küche wird an ihn angelegt', () => {
    const base = produce(twoRooms(), (d) => { linkDoor(d as Project, 'kueche', 'tk', 'flur'); const f = d.rooms[1]; f.placedBy = 'hand'; f.originOnFloor = { x: 1000, y: 1000 }; });
    const res = layoutFloor(base, base.floors[0].id);
    expect(res.placements.some((pl) => pl.roomId === 'flur')).toBe(false);
    expect(res.placements.find((pl) => pl.roomId === 'kueche')).toBeTruthy();
    expect(res.problems).toEqual([]);
  });

  it('zwei von Hand gesetzte Räume, die nicht zusammenpassen: Hinweis', () => {
    const base = produce(twoRooms(), (d) => { linkDoor(d as Project, 'kueche', 'tk', 'flur'); for (const r of d.rooms) { r.placedBy = 'hand'; r.originOnFloor = { x: 0, y: 0 }; } });
    expect(layoutFloor(base, base.floors[0].id).problems.join(' ')).toMatch(/passen nicht/);
  });

  it('Räume ohne Verbindung werden als „nicht verbunden“ gemeldet', () => {
    const p = twoRooms();
    const res = layoutFloor(p, p.floors[0].id);
    expect(res.unconnected.length).toBeGreaterThan(0);
  });
});
