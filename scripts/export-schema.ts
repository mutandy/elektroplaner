/** Exportiert das Datenmodell als JSON Schema (schema/projekt.schema.json). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Project, SCHEMA_VERSION } from '../src/core/model/schema';

mkdirSync(new URL('../schema/', import.meta.url), { recursive: true });
const schema = zodToJsonSchema(Project, { name: 'Projekt', $refStrategy: 'none' });
writeFileSync(new URL(`../schema/projekt.v${SCHEMA_VERSION}.schema.json`, import.meta.url), JSON.stringify(schema, null, 2) + '\n');
console.log(`schema/projekt.v${SCHEMA_VERSION}.schema.json geschrieben`);
