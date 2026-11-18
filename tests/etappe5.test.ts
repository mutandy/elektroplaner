import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { planTheater } from '../src/core/planning/theater';
import { lightingEstimate } from '../src/core/planning/lighting';
import { suggestOutlets } from '../src/core/planning/suggest';
import { runRules } from '../src/core/rules/rules';
import { applyDistributionPhoto, applyFloorPlan, applyRoomText, jsonSchemaFor, FloorPlanResult, RoomTextResult, DistributionPhotoResult } from '../src/core/ai/tasks';
import { buildDocument } from '../src/core/docs/documents';
import { createProject, loadProject } from '../src/core/model/factory';
import { SCHEMA_VERSION, type Project } from '../src/core/model/schema';
import { example, miniProject } from './helpers';

describe('Heimkino', () => {
  const p = example();
  const room = p.rooms.find((r) => r.id === 'heimkino')!;
  const plan = planTheater(p, room, room.theater!);

  it('7.1.4: 12 Kanäle inkl. Sub, Front ±27°, Surround ±100°, Rear ±142°, Höhen in Linie mit Front', () => {
    const c = (code: string) => plan.speakers.find((s) => s.code === code)!;
    expect(plan.speakers.map((s) => s.code)).toEqual(['C', 'FL', 'FR', 'SL', 'SR', 'SBL', 'SBR', 'TFL', 'TFR', 'TRL', 'TRR', 'SUB']);
    expect([c('FL').azimuth, c('FR').azimuth, c('SL').azimuth, c('SBR').azimuth]).toEqual([-27, 27, -100, 142]);
    // von der Leinwand (Wand 3 unten) aus gesehen ist links = Wand 2 (Osten)
    expect(c('SL').wallIndex).toBe(1);
    expect(c('SR').wallIndex).toBe(3);
    // Höhen in Linie mit Front L/R (gleiches x), Elevation in 30–55°
    const flx = room.polygon[1].x - c('FL').s!; // Wand 3 läuft von rechts nach links
    expect(c('TFL').x).toBeCloseTo(flx, -1);
    for (const code of ['TFL', 'TFR', 'TRL', 'TRR']) expect(c(code).elevation).toBeGreaterThanOrEqual(30);
  });

  it('Beamer-Abstand aus Projektionsverhältnis', () => {
    expect(plan.projector!.distance).toBeGreaterThanOrEqual(plan.projector!.min);
    expect(plan.projector!.distance).toBeLessThanOrEqual(plan.projector!.max);
    const tooShort = planTheater(p, room, { ...room.theater!, throwMin: 2.5, throwMax: 3 });
    expect(tooShort.projector!.ok).toBe(false);
  });

  it('fehlende Kanäle werden vorgeschlagen, vorhandene (mit Code) nicht', () => {
    expect(suggestOutlets(p, room).filter((s) => s.key.startsWith('kino:'))).toEqual([]);
    const q = produce(p, (d) => { const r = d.rooms.find((x) => x.id === 'heimkino')!; r.outlets = r.outlets.filter((o) => !o.note.startsWith('[TF')); });
    expect(suggestOutlets(q, q.rooms.find((r) => r.id === 'heimkino')!).filter((s) => s.key.startsWith('kino:')).map((s) => s.key)).toEqual(['kino:TFL', 'kino:TFR']);
  });
});

describe('Beleuchtung und Abstände', () => {
  it('Lichtstrom = Lux × Fläche / 0,5', () => {
    const p = produce(miniProject(), (d) => { d.rooms[0].roomType = 'buero'; });
    const e = lightingEstimate(p, p.rooms[0]); // 12 m², 500 lx
    expect(e.lumenNeeded).toBe(12000);
    expect(e.recommended).toBe(8);
    expect(runRules(p).findings.some((f) => f.ruleId === 'BELEUCHTUNG.ABSCHAETZUNG')).toBe(true);
  });

  it('Möbel im Türaufschlag → Warnung', () => {
    // Tür W1 s=100–190, Bänder links (Band bei x=100), öffnet nach innen
    const p = produce(miniProject(), (d) => { d.rooms[0].furniture.push({ id: 's', kind: 'schrank', label: 'Schrank', x: 120, y: 20, w: 60, d: 40, height: 200, note: '' } as any); });
    expect(runRules(p).findings.some((f) => f.ruleId === 'ABSTAND.TUERAUFSCHLAG')).toBe(true);
    const away = produce(miniProject(), (d) => { d.rooms[0].furniture.push({ id: 's', kind: 'schrank', label: 'Schrank', x: 300, y: 200, w: 60, d: 40, height: 200, note: '' } as any); });
    expect(runRules(away).findings.some((f) => f.ruleId === 'ABSTAND.TUERAUFSCHLAG')).toBe(false);
  });
});

describe('KI-Ergebnisse übernehmen (ohne API)', () => {
  it('JSON-Schemas sind geschlossen (strukturierte Ausgabe)', () => {
    const open: string[] = [];
    const walk = (o: any, path: string) => { if (o && typeof o === 'object') { if (o.type === 'object' && o.additionalProperties !== false) open.push(path); for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`); } };
    for (const s of [FloorPlanResult, RoomTextResult, DistributionPhotoResult]) walk(jsonSchemaFor(s), 'root');
    expect(open).toEqual([]);
  });

  it('Grundriss: Räume mit Bestandsname, Maß aus Bemaßung, Lage aus Bild × Maßstab', () => {
    const base = produce(createProject(), (d) => { Object.assign(d.floors[0], { backgroundPlan: 'data:image/jpeg;base64,AA', backgroundSize: { w: 1000, h: 500 }, backgroundScale: 2 }); });
    const result: FloorPlanResult = {
      rooms: [
        { label: 'HEIZUNG', bbox: { x0: 0.1, y0: 0.2, x1: 0.22, y1: 0.55 }, widthM: 2.4, depthM: 3.38, kind: 'raum', notes: 'FHT' },
        { label: 'TREPPENH.', bbox: { x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.9 }, widthM: null, depthM: null, kind: 'treppe', notes: '' },
      ],
      overallDimension: { lengthM: 18, description: 'Maßkette unten' }, notes: '',
    };
    const p = produce(base, (d) => { applyFloorPlan(d as Project, d.floors[0].id, result, [{ index: 0, name: 'Küche' }, { index: 1, name: '' }]); });
    const k = p.rooms.find((r) => r.name === 'Küche')!;
    expect(k).toMatchObject({ formerName: 'HEIZUNG', provenance: 'aus_plan', originOnFloor: { x: 200, y: 200 } });
    expect(k.polygon[2]).toEqual({ x: 240, y: 338 });
    const t = p.rooms.find((r) => r.formerName === 'TREPPENH.')!;
    expect(t.polygon[2]).toEqual({ x: 200, y: 400 }); // 0,1 × 1000 px × 2 cm/px, 0,4 × 500 × 2
  });

  it('Verteilungsfoto: LS-Gruppen, RCDs, freie TE, Hinweis zur Bestätigung', () => {
    const p = produce(createProject(), (d) => { d.distributions.push({ id: 'hv', name: 'HV', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'unbekannt', meter: '', freeModules: 0, breakers: [], rcds: [], hasSpd: false, photos: [], note: '' }); });
    const r: DistributionPhotoResult = { devices: [
      { kind: 'RCD', characteristic: null, ratedCurrent: 40, poles: 4, residualCurrent: 30, rcdType: 'A', count: 2, label: null },
      { kind: 'LS', characteristic: 'B', ratedCurrent: 16, poles: 1, residualCurrent: null, rcdType: null, count: 9, label: null },
      { kind: 'SPD', characteristic: null, ratedCurrent: null, poles: null, residualCurrent: null, rcdType: null, count: 1, label: null },
    ], freeModules: 6, mainFuse: '3× 50 A', uncertain: ['zweite Reihe unscharf'] };
    const q = produce(p, (d) => applyDistributionPhoto(d as Project, 'hv', r));
    const hv = q.distributions[0];
    expect(hv.rcds).toHaveLength(2);
    expect(hv.breakers[0]).toMatchObject({ characteristic: 'B', ratedCurrent: 16, count: 9, free: 0 });
    expect(hv).toMatchObject({ freeModules: 6, mainFuse: '3× 50 A', hasSpd: true });
    expect(hv.note).toMatch(/zu bestätigen/);
  });

  it('Raumbeschreibung: Typ, Verbraucher, Möbel an die genannte Wand', () => {
    const p = miniProject();
    const r: RoomTextResult = { roomType: 'schlafen', usage: 'Schlafen', futureUsage: 'Kinderzimmer', loads: [{ label: 'Klimagerät', power: 1000, phases: 1, dedicated: true }], furniture: [{ kind: 'bett', label: 'Doppelbett', wallSide: 'oben', widthCm: 180, depthCm: 200 }], wishes: ['USB am Bett'], questions: [] };
    const q = produce(p, (d) => applyRoomText(d as Project, 'r1', r, { type: true, loads: true, furniture: true }));
    const room = q.rooms[0];
    expect(room.roomType).toBe('schlafen');
    expect(room.loads[0]).toMatchObject({ label: 'Klimagerät', dedicated: true });
    expect(room.furniture[0]).toMatchObject({ kind: 'bett', y: 0, w: 180, d: 200, wallIndex: 0 });
    expect(room.note).toContain('USB am Bett');
  });
});

describe('Fotos und Migration', () => {
  it('Fotos erscheinen im Ausführungsplan', () => {
    const p = produce(example(), (d) => { d.rooms.find((r) => r.id === 'bad')!.photos.push({ id: 'f1', dataUrl: 'data:image/jpeg;base64,AA', caption: 'Vorwand vor Beplankung', wallIndex: 1, at: '' }); });
    const html = buildDocument(p, 'ausfuehrung');
    expect(html).toContain('Bad – Fotos');
    expect(html).toContain('Vorwand vor Beplankung');
  });

  it('Projektdatei v6 → aktuelle Version (Fotos als Objekte)', () => {
    const v6 = JSON.parse(readFileSync(new URL('./fixtures/projekt-v6.json', import.meta.url), 'utf8'));
    v6.rooms[0].photos = ['data:image/jpeg;base64,AA'];
    const p = loadProject(v6);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.rooms[0].photos[0]).toMatchObject({ dataUrl: 'data:image/jpeg;base64,AA', caption: '' });
  });
});
