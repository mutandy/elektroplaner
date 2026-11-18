import { describe, expect, it } from 'vitest';
import { boxCenters, pointOnWall, wallGeoms, zToFfb, ffbToZ, suggestedSwitchS, roomArea } from '../src/core/geometry/room';
import { example, miniProject } from './helpers';
import type { Outlet } from '../src/core/model/schema';

const outlet = (o: Partial<Outlet>): Outlet => ({ id: 'o', label: 'O', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 100, z: 30, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'up_tief', inserts: [], controls: [], smart: false, status: 'neu', note: '', ...o });

describe('Bezugssystem', () => {
  const p = miniProject();
  const r = p.rooms[0];
  it('Wände laufen im Uhrzeigersinn, Innennormale zeigt in den Raum', () => {
    const w = wallGeoms(r);
    expect(w.map((x) => x.length)).toEqual([400, 300, 400, 300]);
    expect(w[0].normal).toEqual({ x: -0, y: 1 });
    expect(w[1].normal.x).toBeCloseTo(-1);
  });
  it('s wird ab linker Ecke beim Blick von innen gemessen', () => {
    // Wand 3 (unten) läuft von (400,300) nach (0,300): s=50 liegt bei x=350
    expect(pointOnWall(r, 2, 50)).toEqual({ x: 350, y: 300 });
    // Wand 4 (links) läuft von (0,300) nach (0,0)
    expect(pointOnWall(r, 3, 100)).toEqual({ x: 0, y: 200 });
  });
  it('Fläche', () => expect(roomArea(r)).toBeCloseTo(12));
});

describe('Dosenmitten bei Mehrfachkombinationen', () => {
  const s = miniProject().settings;
  it('erste Dose an Position, weitere nach rechts im Abstand 71 mm', () => {
    expect(boxCenters(outlet({ gangs: 3 }), s).map((b) => b.s)).toEqual([100, 107.1, 114.2]);
  });
  it('weitere Dosen nach links', () => {
    expect(boxCenters(outlet({ gangs: 2, growth: 'links' }), s).map((b) => b.s)).toEqual([100, 92.9]);
  });
  it('mittig: Position ist die Mitte', () => {
    expect(boxCenters(outlet({ gangs: 3, convention: 'mittig' }), s).map((b) => b.s)).toEqual([92.9, 100, 107.1]);
  });
  it('senkrecht nach unten', () => {
    expect(boxCenters(outlet({ gangs: 2, orientation: 'senkrecht', growth: 'unten', z: 105 }), s).map((b) => b.z)).toEqual([105, 97.9]);
  });
});

describe('Höhen mit Bodenaufbau', () => {
  const p = example();
  const bad = p.rooms.find((r) => r.id === 'bad')!;
  it('rechnet zwischen Bezug und FFB um (Aufbau 1,5 cm)', () => {
    expect(zToFfb(bad, 31.5)).toBeCloseTo(30);
    expect(ffbToZ(bad, 105)).toBeCloseTo(106.5);
  });
});

describe('Schalter neben der Tür', () => {
  const door = miniProject().rooms[0].doors[0];
  it('Bänder links → Griff rechts → 15 cm neben Zarge', () => expect(suggestedSwitchS(door)).toBe(205));
  it('ohne Zarge 18 cm', () => expect(suggestedSwitchS({ ...door, hasFrame: false })).toBe(208));
  it('Bänder rechts → Griff links', () => expect(suggestedSwitchS({ ...door, hinge: 'rechts' })).toBe(85));
});
