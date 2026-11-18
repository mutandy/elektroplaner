import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadProject, ProjectLoadError, serializeProject, createPolygonRoom } from '../src/core/model/factory';
import { SCHEMA_VERSION } from '../src/core/model/schema';
import { example, miniProject } from './helpers';

describe('Datenmodell', () => {
  it('Beispielprojekt lädt, ist versioniert und referenziell konsistent', () => {
    const p = example();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.rooms.map((r) => r.name)).toContain('Heimkino');
    expect(p.rooms.find((r) => r.id === 'heimkino')!.formerName).toBe('KELLER ③ (oben rechts)');
  });

  it('Rundreise Export → Import verändert nichts', () => {
    const p = example();
    expect(loadProject(serializeProject(p))).toEqual(p);
  });

  it('Beispiel-JSON entspricht dem Generator (keine Handpflege)', async () => {
    const { buildKellerProject } = await import('../examples/keller');
    const gen = buildKellerProject();
    const file = JSON.parse(readFileSync(new URL('../examples/kellerwohnung.json', import.meta.url), 'utf8'));
    expect({ ...gen, createdAt: '', updatedAt: '' }).toEqual({ ...file, createdAt: '', updatedAt: '' });
  });

  it('lehnt kaputtes JSON und neuere Schema-Versionen verständlich ab', () => {
    expect(() => loadProject('{kein json')).toThrow('kein gültiges JSON');
    expect(() => loadProject({ ...example(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(ProjectLoadError);
  });

  it('meldet fehlerhafte Referenzen (Wandindex, Stromkreis)', () => {
    const p = miniProject();
    const bad = JSON.parse(serializeProject(p));
    bad.rooms[0].doors[0].wallIndex = 9;
    bad.rooms[0].outlets.push({ id: 'o', label: 'X1', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 50, z: 30, circuitId: 'gibtsnicht' });
    try {
      loadProject(bad);
      throw new Error('hätte werfen müssen');
    } catch (e) {
      const issues = (e as ProjectLoadError).issues.join('\n');
      expect(issues).toContain('Wand 10');
      expect(issues).toContain('unbekannten Stromkreis');
    }
  });

  it('Polygonräume gegen den Uhrzeigersinn werden umgedreht, Nullpunkt bleibt', () => {
    const r = createPolygonRoom({ id: 'x', floorId: 'f', name: 'L', height: 250, polygon: [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 0 }] });
    expect(r.polygon[0]).toEqual({ x: 0, y: 0 });
    expect(r.polygon[1]).toEqual({ x: 400, y: 0 });
    expect(r.walls).toHaveLength(4);
  });
});
