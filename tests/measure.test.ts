import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyMeasure, checkOpening, draftComplete, draftFromRoom, emptyDraft, openingS, type MeasureDraft } from '../src/core/wizard/measure';
import { createRectRoom } from '../src/core/model/factory';
import { wallGeoms } from '../src/core/geometry/room';
import type { Room } from '../src/core/model/schema';

const draft = (): MeasureDraft => ({
  ...emptyDraft('Garage'), length1: 300, length2: 600, height: 250,
  openings: [
    { id: 'a', kind: 'tuer', wall: 0, distance: 20, from: 'links', width: 88.5, height: 201, hinge: 'links', swing: 'innen', leadsTo: 'Flur' },
    { id: 'b', kind: 'tor', wall: 2, distance: 25, from: 'rechts', width: 250, height: 212 },
    { id: 'c', kind: 'fenster', wall: 1, distance: 100, from: 'links', width: 100, height: 60, sill: 150 },
  ],
});

describe('Aufmaß Schritt für Schritt', () => {
  it('von rechts gemessen wird auf linke Kante umgerechnet', () => {
    const d = draft();
    expect(openingS(d, d.openings[1])).toBe(300 - 25 - 250);
  });

  it('erzeugt Rechteckraum mit Türen, Tor und Fenster an der richtigen Stelle', () => {
    const base = createRectRoom({ id: 'r', floorId: 'eg', name: 'x', width: 100, depth: 100, height: 200 });
    const d = draft();
    expect(draftComplete(d)).toBe(true);
    const r = produce(base, (x) => { applyMeasure(x as Room, d); });
    expect(r.name).toBe('Garage');
    expect(wallGeoms(r).map((w) => w.length)).toEqual([300, 600, 300, 600]);
    expect(r.height).toBe(250);
    expect(r.doors).toHaveLength(2);
    const tor = r.doors.find((x) => x.wallIndex === 2)!;
    expect(tor).toMatchObject({ s: 25, width: 250, hasFrame: false, swing: 'aussen' });
    expect(r.doors.find((x) => x.wallIndex === 0)).toMatchObject({ s: 20, hasFrame: true, swing: 'innen', isMainEntrance: true, leadsTo: 'Flur' });
    expect(r.windows[0]).toMatchObject({ wallIndex: 1, s: 100, sill: 150, height: 60 });
  });

  it('meldet Öffnungen, die nicht auf die Wand passen oder sich überschneiden', () => {
    const d = draft();
    expect(checkOpening(d, { ...d.openings[0], distance: 250 })[0]).toMatch(/Passt nicht/);
    const clash = { ...d.openings[0], id: 'z', distance: 50 };
    expect(checkOpening({ ...d, openings: [...d.openings, clash] }, clash).some((m) => /Überschneidet/.test(m))).toBe(true);
    expect(checkOpening(d, { ...d.openings[2], sill: 220 })[0]).toMatch(/Höher als der Raum/);
  });

  it('Rundreise: Raum → Aufmaß → Raum', () => {
    const base = createRectRoom({ id: 'r', floorId: 'eg', name: 'x', width: 100, depth: 100, height: 200 });
    const r = produce(base, (x) => { applyMeasure(x as Room, draft()); });
    const back = draftFromRoom(r);
    expect(back.length1).toBe(300);
    expect(back.openings.find((o) => o.kind === 'tor')).toMatchObject({ wall: 2, distance: 25, from: 'links' });
  });
});

describe('Aufmaß mit Kamin', () => {
  it('Küche mit Kamin unten links: Tür ab Kaminkante gemessen sitzt richtig, Kaminwangen sind Tabuzone', async () => {
    const { shapeWalls } = await import('../src/core/wizard/measure');
    const d: MeasureDraft = {
      ...emptyDraft('Küche'), length1: 400, length2: 300, height: 225,
      notches: [{ id: 'k', kind: 'ecke', what: 'kamin', corner: 3, a: 54, b: 38 }],
      openings: [],
    };
    const walls = shapeWalls(d);
    expect(walls.map((w) => w.length)).toEqual([400, 300, 346, 38, 54, 262]);
    expect(walls[3].label).toBe('Kaminwange');
    // Tür in Wand 6 (läuft von der Kaminkante nach oben; Blick auf die Wand: Kaminkante links): 20 cm ab der oberen Ecke, also von rechts gemessen
    d.openings.push({ id: 't', kind: 'tuer', wall: 5, distance: 20, from: 'rechts', width: 88.5, height: 201, hinge: 'links', swing: 'innen' });
    expect(checkOpening(d, d.openings[0])).toEqual([]);
    const base = createRectRoom({ id: 'r', floorId: 'eg', name: 'x', width: 100, depth: 100, height: 200 });
    const r = produce(base, (x) => { applyMeasure(x as Room, d); });
    expect(r.polygon).toHaveLength(6);
    expect(r.doors[0]).toMatchObject({ wallIndex: 5, s: 262 - 20 - 88.5 });
    expect(r.walls.filter((w) => w.zones.some((z) => z.kind === 'kaminwange'))).toHaveLength(2);
  });

  it('Vorsprung mitten an der Wand und unmögliche Maße', async () => {
    const { shapeWalls, notchError } = await import('../src/core/wizard/measure');
    const d: MeasureDraft = { ...emptyDraft(''), length1: 400, length2: 300, height: 250, notches: [{ id: 'p', kind: 'wand', what: 'vorsprung', wall: 0, from: 100, a: 40, b: 25 }], openings: [] };
    expect(shapeWalls(d).length).toBe(8);
    expect(notchError(d, { id: 'x', kind: 'ecke', what: 'schacht', corner: 1, a: 500, b: 20 })).toMatch(/kleiner/);
  });

  it('Raum mit eigener Form: nur Höhe und Öffnungen ändern, Form bleibt', () => {
    const base = createRectRoom({ id: 'r', floorId: 'eg', name: 'x', width: 400, depth: 300, height: 200 });
    const shaped = produce(base, (x) => { applyMeasure(x as Room, { ...emptyDraft(''), length1: 400, length2: 300, height: 225, notches: [{ id: 'k', kind: 'ecke', what: 'kamin', corner: 3, a: 54, b: 38 }], openings: [] }); });
    const d = draftFromRoom(shaped as Room);
    expect(d.fixedPolygon).toHaveLength(6);
    d.openings.push({ id: 'f', kind: 'fenster', wall: 0, distance: 100, from: 'links', width: 80, height: 60, sill: 150 });
    const after = produce(shaped, (x) => { applyMeasure(x as Room, d); });
    expect(after.polygon).toEqual(shaped.polygon);
    expect(after.windows).toHaveLength(1);
  });
});
