import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { computeMaterial } from '../src/core/planning/bom';
import { estimateCosts } from '../src/core/planning/costs';
import { buildTasks, PHASES } from '../src/core/planning/tasks';
import { materialCsv, materialXlsx } from '../src/core/export/material';
import { buildDocument } from '../src/core/docs/documents';
import { loadProject } from '../src/core/model/factory';
import { SCHEMA_VERSION } from '../src/core/model/schema';
import { example } from './helpers';
import ExcelJS from 'exceljs';

describe('Material- und Bestellliste', () => {
  const p = example();
  const list = computeMaterial(p);
  const line = (id: string) => list.lines.find((l) => l.id === id)!;

  it('Kabel aus Leitungslängen, auf Gebinde aufgerundet', () => {
    const nym = line('kabel.NYM-J 3×2,5');
    expect(nym.need).toBeGreaterThan(100);
    expect(nym.order % 50).toBe(0);
    expect(nym.order).toBeGreaterThanOrEqual(nym.need);
  });

  it('Dosen und Rahmen aus den Auslässen (Mehrfachdosen = mehrere Dosen, ein Rahmen)', () => {
    const rooms = p.rooms.filter((r) => r.inScope);
    const upTief = rooms.flatMap((r) => r.outlets).filter((o) => o.mount === 'wand' && o.boxType === 'up_tief' && o.status === 'neu').reduce((s, o) => s + o.gangs, 0);
    expect(line('dose.up_tief').need).toBe(upTief);
    expect(line('dose.up_tief').order % 25).toBe(0);
    expect(line('sp.rahmen4').need).toBe(1); // H15 4-fach
  });

  it('Kleinmaterial aus Schlitzvolumen; Erdkabel bringt Warnband und Schutzrohr', () => {
    expect(line('km.reparaturmoertel').need).toBeGreaterThan(10);
    expect(line('km.gips').need).toBeGreaterThan(5);
    expect(line('km.warnband')).toBeTruthy();
    expect(line('km.abschottung').need).toBeGreaterThanOrEqual(0);
  });

  it('Verteiler: neue LS und RCD aus den Stromkreisen', () => {
    const newLs3 = p.circuits.filter((c) => !c.breakerGroupId && c.poles === 3).length;
    expect(line('vt.ls3').need).toBe(newLs3);
    expect(line('vt.rcd').need).toBe(p.distributions.flatMap((d) => d.rcds).filter((r) => !r.existing).length);
  });

  it('Überschreiben, Abhaken, eigene Positionen', () => {
    const q = produce(p, (d) => {
      d.material.qtyOverrides['kabel.NYM-J 3×2,5'] = 300;
      d.material.priceOverrides['kabel.NYM-J 3×2,5'] = 1;
      d.material.checked['dose.up_tief'] = true;
      d.material.extras.push({ id: 'x1', group: 'Eigene Positionen', label: 'Leiter leihen', unit: 'Tag', qty: 2, price: 10, note: '' });
    });
    const l2 = computeMaterial(q);
    expect(l2.lines.find((l) => l.id === 'kabel.NYM-J 3×2,5')).toMatchObject({ order: 300, unitPrice: 1, total: 300 });
    expect(l2.lines.find((l) => l.id === 'x1')!.total).toBe(20);
    expect(l2.openTotal).toBeLessThan(l2.total);
  });

  it('Summen je Gruppe ergeben die Gesamtsumme', () => {
    expect(list.groups.reduce((s, g) => s + g.total, 0)).toBeCloseTo(list.total, 2);
  });
});

describe('Kosten und Aufgaben', () => {
  it('Eigenleistung ist günstiger als Handwerker; Elektrofachkraft immer enthalten', () => {
    const p = example();
    const own = estimateCosts(produce(p, (d) => { d.costs.mode = 'eigenleistung'; }));
    const pro = estimateCosts(produce(p, (d) => { d.costs.mode = 'handwerker'; }));
    expect(own.max).toBeLessThan(pro.min + pro.max);
    expect(own.min).toBeLessThan(pro.min);
    expect(own.rows.find((r) => r.id === 'elektro')!.min).toBeGreaterThan(0);
    expect(own.hoursOwn).toBeGreaterThan(0);
    expect(pro.hoursOwn).toBe(0);
    expect(own.min).toBeLessThan(own.max);
  });

  it('Aufgaben in Bauphasen-Reihenfolge mit Haltepunkten; Bestandsleitungen erzeugen Prüfaufgaben', () => {
    const p = example();
    const t = buildTasks(p);
    const phaseIdx = t.map((x) => PHASES.indexOf(x.phase));
    expect([...phaseIdx].sort((a, b) => a - b)).toEqual(phaseIdx);
    expect(t.some((x) => /Zugtest/.test(x.text))).toBe(true);
    expect(t.find((x) => x.id === 'doku.iso')).toMatchObject({ who: 'Elektrofachkraft', hold: true });
    expect(t.some((x) => /Erdkabel/.test(x.text))).toBe(true);
    const done = produce(p, (d) => { d.tasks['doku.iso'] = { done: true, note: '12.12.' }; });
    expect(buildTasks(done).find((x) => x.id === 'doku.iso')).toMatchObject({ done: true, note: '12.12.' });
  });
});

describe('Exporte', () => {
  const p = example();
  const list = computeMaterial(p);

  it('CSV: Semikolon, deutsches Dezimalkomma, BOM', () => {
    const csv = materialCsv(list);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('Gruppe;Position;Bedarf');
    expect(csv).toMatch(/;0,75;/);
  });

  it('XLSX: drei Blätter, Summenformel je Zeile', async () => {
    const buf = await materialXlsx(p, list, estimateCosts(p), buildTasks(p), ExcelJS);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Materialliste', 'Kostenschätzung', 'Aufgaben']);
    expect((wb.getWorksheet('Materialliste')!.getCell('H2').value as any).formula).toBe('F2*G2');
  });

  it('PDF-Dokumente Material, Kosten, Aufgaben mit Hinweis Elektrofachkraft', () => {
    for (const k of ['material', 'kosten', 'aufgaben'] as const) {
      const html = buildDocument(p, k);
      expect(html).toContain('ersetzt keine Elektrofachkraft');
    }
    expect(buildDocument(p, 'material')).toContain('☐');
    expect(buildDocument(p, 'aufgaben')).toContain('⛔');
  });

  it('Projektdatei v3 wird auf die aktuelle Version migriert', () => {
    const v3 = JSON.parse(readFileSync(new URL('./fixtures/projekt-v3.json', import.meta.url), 'utf8'));
    expect(v3.schemaVersion).toBe(3);
    const q = loadProject(v3);
    expect(q.schemaVersion).toBe(SCHEMA_VERSION);
    expect(q.costs.mode).toBe('eigenleistung');
    expect(q.material.extras).toEqual([]);
  });
});
