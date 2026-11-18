import { describe, expect, it } from 'vitest';
import { renderRoomPlan, renderFloorOverview } from '../src/core/render/plan';
import { renderElevation } from '../src/core/render/elevation';
import { buildDocument } from '../src/core/docs/documents';
import { boxTable } from '../src/core/docs/tables';
import { example } from './helpers';

const p = example();
const bad = p.rooms.find((r) => r.id === 'bad')!;

describe('Rendering', () => {
  it('Draufsicht Bad (Snapshot)', () => {
    expect(renderRoomPlan(p, bad, { scale: 25 })).toMatchSnapshot();
  });
  it('Wandabwicklung Bad Wand 2 mit Vorwand (Snapshot)', () => {
    expect(renderElevation(p, bad, 1, { scale: 25 })).toMatchSnapshot();
  });
  it('Draufsicht enthält Nullpunkt, alle Auslässe und Tooltips', () => {
    const svg = renderRoomPlan(p, bad);
    expect(svg).toContain('Nullpunkt des Raums');
    for (const o of bad.outlets) expect(svg).toContain(`data-outlet="${o.id}"`);
    expect(svg).toContain('<title>B6: Steckdose');
  });
  it('Ebenen lassen sich ausblenden', () => {
    const svg = renderRoomPlan(p, bad, { layers: ['230v'] });
    expect(svg).toContain('.ly-moebel{display:none}');
    expect(svg).not.toContain('data-outlet="b4"'); // Deckenlicht liegt auf Ebene Licht
  });
  it('Gesamtansicht zeigt neue und alte Raumnamen', () => {
    const svg = renderFloorOverview(p, 'geschoss_kg');
    expect(svg).toContain('Heimkino');
    expect(svg).toContain('Bestand: WASCH.+TROCKNEN ③');
  });
  it('Dosentabelle gibt jede Dosenmitte einer Kombination aus', () => {
    const b2 = boxTable(p, bad).find((r) => r.label === 'B2')!;
    expect(b2.centers.map((c) => c.s)).toEqual(['253,6', '246,5']); // mittig um 250, weitere nach links
    expect(b2.zFfb).toBe('105');
  });
  it('Druckdokumente: Hinweis Elektrofachkraft und Seitenzahlen auf jeder Seite', () => {
    for (const kind of ['raumlayout', 'ausfuehrung'] as const) {
      const html = buildDocument(p, kind);
      const pages = html.match(/<section class="page">/g)!.length;
      expect(html.match(/ersetzt keine Elektrofachkraft/g)!.length).toBeGreaterThanOrEqual(pages);
      expect(html).toContain(`Seite ${pages} / ${pages}`);
    }
  });
  it('eine Änderung zieht sich durch alle Ausgaben', () => {
    const moved = structuredClone(p);
    moved.rooms.find((r) => r.id === 'bad')!.outlets.find((o) => o.label === 'B6')!.s = 123.5;
    expect(buildDocument(moved, 'ausfuehrung')).toContain('123,5');
    expect(renderElevation(moved, moved.rooms.find((r) => r.id === 'bad')!, 1)).toContain('123,5');
  });
});
