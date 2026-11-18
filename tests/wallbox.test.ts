import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadProject } from '../src/core/model/factory';
import { SCHEMA_VERSION } from '../src/core/model/schema';
import { runRules } from '../src/core/rules/rules';
import { computeMaterial } from '../src/core/planning/bom';
import { example } from './helpers';

describe('Wallbox als Festanschluss', () => {
  it('Migration v7 → v8 macht aus der Wallbox-Anschlussdose einen Festanschluss', () => {
    const v7 = JSON.parse(readFileSync(new URL('./fixtures/projekt-v7.json', import.meta.url), 'utf8'));
    const p = loadProject(v7);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    const ga3 = p.rooms.find((r) => r.id === 'garage')!.outlets.find((o) => o.id === 'ga3')!;
    expect(ga3.kind).toBe('festanschluss');
    expect(ga3.inserts).not.toContain('geraeteanschluss');
    // andere Anschlussdosen bleiben
    expect(p.rooms.find((r) => r.id === 'bad')!.outlets.find((o) => o.id === 'b5')!.kind).toBe('anschlussdose');
  });

  it('kein Hinweis beim Festanschluss, aber bei einer Wallbox an einer Anschlussdose', () => {
    const p = example();
    expect(runRules(p).findings.some((f) => /fest angeschlossen/.test(f.message))).toBe(false);
    const garage = p.rooms.find((r) => r.id === 'garage')!;
    garage.outlets.find((o) => o.id === 'ga3')!.kind = 'anschlussdose';
    expect(runRules(p).findings.some((f) => /fest angeschlossen/.test(f.message))).toBe(true);
  });

  it('Material: Festanschluss braucht keine Dose und keinen Geräteanschluss-Einsatz', () => {
    const p = example();
    const before = computeMaterial(p);
    const ga3 = p.rooms.find((r) => r.id === 'garage')!.outlets.find((o) => o.id === 'ga3')!;
    ga3.kind = 'anschlussdose';
    ga3.inserts = ['geraeteanschluss'];
    const after = computeMaterial(p);
    const qty = (l: typeof before, id: string) => l.lines.filter((i) => i.id === id).reduce((s, i) => s + i.need, 0);
    expect(qty(after, 'sp.geraeteanschluss')).toBeGreaterThan(qty(before, 'sp.geraeteanschluss'));
  });
});
