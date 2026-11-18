/**
 * PDF-Export über Chromium (Playwright).
 *   npm run pdf -- [projekt.json] [ausgabeordner]
 * Ohne Argumente: Beispielprojekt → out/
 * Erzeugt alle Dokumente als PDF sowie Materialliste als CSV und XLSX.
 * Wird mit esbuild gebündelt und mit Node ausgeführt (siehe package.json).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { loadProject } from '../src/core/model/factory';
import { buildDocument, documentLabel, type DocumentKind } from '../src/core/docs/documents';

const require = createRequire(import.meta.url);
const input = process.argv[2] ?? 'examples/kellerwohnung.json';
const outDir = resolve(process.argv[3] ?? 'out');
mkdirSync(outDir, { recursive: true });

const project = loadProject(readFileSync(input, 'utf8'));
let chromium: any;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright fehlt. Einmalig installieren:\n  npm i -D playwright\n  npx playwright install chromium\nAlternativ in der App unter „Ausgaben“ drucken (Druckdialog → Als PDF speichern).');
  process.exit(1);
}
const browser = await chromium.launch();
try {
  for (const kind of Object.keys(documentLabel) as DocumentKind[]) {
    const html = buildDocument(project, kind);
    writeFileSync(join(outDir, `${kind}.html`), html);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const file = join(outDir, `${kind}.pdf`);
    await page.pdf({ path: file, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
    await page.close();
    console.log(`${documentLabel[kind]} → ${file}`);
  }
} finally {
  await browser.close();
}

// Material-Exporte (CSV, XLSX) neben die PDFs legen
{
  const { computeMaterial } = await import('../src/core/planning/bom');
  const { estimateCosts } = await import('../src/core/planning/costs');
  const { buildTasks } = await import('../src/core/planning/tasks');
  const { computeLengths } = await import('../src/core/planning/circuits');
  const { materialCsv, materialXlsx } = await import('../src/core/export/material');
  const lengths = computeLengths(project);
  const list = computeMaterial(project, lengths);
  writeFileSync(join(outDir, 'materialliste.csv'), materialCsv(list));
  const ExcelJS = require('exceljs');
  writeFileSync(join(outDir, 'material-kosten-aufgaben.xlsx'), Buffer.from(await materialXlsx(project, list, estimateCosts(project, lengths), buildTasks(project, lengths.routes), ExcelJS)));
  console.log(`Materialliste → ${join(outDir, 'materialliste.csv')} und .xlsx`);
}
