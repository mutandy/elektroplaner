/** Erzeugt examples/kellerwohnung.json aus examples/keller.ts. */
import { writeFileSync } from 'node:fs';
import { buildKellerProject } from '../examples/keller';
import { serializeProject, checkReferences } from '../src/core/model/factory';

const p = checkReferences(buildKellerProject());
p.createdAt = p.updatedAt = '2026-11-18T12:00:00.000Z';
writeFileSync(new URL('../examples/kellerwohnung.json', import.meta.url), serializeProject(p) + '\n');
console.log('examples/kellerwohnung.json geschrieben');
