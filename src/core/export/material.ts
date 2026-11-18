/** Export der Material-/Bestellliste, Kostenschätzung und Aufgaben als CSV und XLSX. */
import type { Project } from '../model/schema';
import type { MaterialList } from '../planning/bom';
import type { CostEstimate } from '../planning/costs';
import type { Task } from '../planning/tasks';
import { DISCLAIMER } from '../docs/documents';

const csvCell = (v: unknown) => {
  const s = typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV mit Semikolon und UTF-8-BOM (öffnet direkt korrekt in Excel/LibreOffice). */
export function materialCsv(list: MaterialList): string {
  const head = ['Gruppe', 'Position', 'Bedarf', 'Einheit', 'Bestellung', 'Bestellmenge', 'Einzelpreis €', 'Summe €', 'erledigt', 'Hinweis'];
  const rows = list.lines.map((l) => [l.group, l.label, l.need, l.unit, l.orderText, l.order, l.unitPrice, l.total, l.checked ? 'x' : '', l.note]);
  rows.push(['', 'Summe (Richtwert)', '', '', '', '', '', list.total, '', '']);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export async function materialXlsx(project: Project, list: MaterialList, costs: CostEstimate, tasks: Task[], excelJs?: any): Promise<ArrayBuffer> {
  const ExcelJS = excelJs ?? (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Elektroplaner';
  wb.created = new Date();
  const euroFmt = '#,##0.00 "€"';
  const header = (ws: any, cols: { header: string; key: string; width: number }[]) => {
    ws.columns = cols;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // Materialliste
  const ws = wb.addWorksheet('Materialliste');
  header(ws, [
    { header: 'Gruppe', key: 'group', width: 30 }, { header: 'Position', key: 'label', width: 55 }, { header: 'Bedarf', key: 'need', width: 10 },
    { header: 'Einheit', key: 'unit', width: 8 }, { header: 'Bestellung', key: 'orderText', width: 22 }, { header: 'Bestellmenge', key: 'order', width: 13 },
    { header: 'Einzelpreis', key: 'unitPrice', width: 12 }, { header: 'Summe', key: 'total', width: 12 }, { header: 'erledigt', key: 'checked', width: 9 }, { header: 'Hinweis', key: 'note', width: 50 },
  ]);
  let r = 2;
  for (const g of list.groups) {
    for (const l of g.lines) {
      ws.addRow({ ...l, checked: l.checked ? '✔' : '' });
      ws.getCell(`H${r}`).value = { formula: `F${r}*G${r}`, result: l.total };
      r++;
    }
    const sum = ws.addRow({ label: `Summe ${g.group}`, total: g.total });
    sum.font = { bold: true };
    r++;
  }
  const tot = ws.addRow({ label: 'Gesamtsumme (Richtwert, ohne Gewähr)', total: list.total });
  tot.font = { bold: true };
  ws.getColumn('unitPrice').numFmt = euroFmt;
  ws.getColumn('total').numFmt = euroFmt;
  ws.addRow({});
  ws.addRow({ label: DISCLAIMER });

  // Kosten
  const wc = wb.addWorksheet('Kostenschätzung');
  header(wc, [
    { header: 'Gewerk', key: 'title', width: 46 }, { header: 'Umfang', key: 'detail', width: 70 }, { header: 'Wer', key: 'who', width: 18 },
    { header: 'Stunden', key: 'hours', width: 10 }, { header: 'von', key: 'min', width: 12 }, { header: 'bis', key: 'max', width: 12 },
  ]);
  costs.rows.forEach((x) => wc.addRow(x));
  const ct = wc.addRow({ title: 'Summe (Richtwert)', min: costs.min, max: costs.max });
  ct.font = { bold: true };
  wc.getColumn('min').numFmt = euroFmt;
  wc.getColumn('max').numFmt = euroFmt;
  wc.addRow({});
  wc.addRow({ title: `Vorarbeiten: ${costs.mode === 'eigenleistung' ? 'Eigenleistung' : 'Handwerker'}` });
  wc.addRow({ title: 'Grobe Schätzung mit Spanne – ersetzt kein Angebot.' });

  // Aufgaben
  const wt = wb.addWorksheet('Aufgaben');
  header(wt, [{ header: 'Phase', key: 'phase', width: 30 }, { header: 'Aufgabe', key: 'text', width: 100 }, { header: 'Wer', key: 'who', width: 18 }, { header: 'Haltepunkt', key: 'hold', width: 11 }, { header: 'erledigt', key: 'done', width: 9 }, { header: 'Notiz', key: 'note', width: 30 }]);
  tasks.forEach((t) => wt.addRow({ ...t, hold: t.hold ? '!' : '', done: t.done ? '✔' : '' }));
  wt.getColumn('text').alignment = { wrapText: true, vertical: 'top' };

  for (const sheet of [ws, wc, wt]) {
    sheet.headerFooter.oddFooter = `${project.name} – &P/&N`;
    sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
