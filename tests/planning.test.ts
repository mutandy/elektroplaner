import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { computeRoomRoutes, routeTotals } from '../src/core/planning/routes';
import { computeLengths, proposeCircuits, applyCircuitProposal } from '../src/core/planning/circuits';
import { suggestOutlets, findFreeS } from '../src/core/planning/suggest';
import { packsFor, cableById, connectorFits } from '../src/core/planning/cables';
import { runRules } from '../src/core/rules/rules';
import { buildDocument } from '../src/core/docs/documents';
import { example, miniProject } from './helpers';
import type { Outlet, Project } from '../src/core/model/schema';

const sd = (o: Partial<Outlet>): Outlet => ({ id: o.label ?? 'x', label: 'X1', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 250, z: 30, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'up_tief', inserts: ['steckdose'], controls: [], smart: false, status: 'neu', note: '', ...o } as Outlet);

/** 400×300-Raum, Tür W1 s=100–190 (Bänder links → Einspeisung rechts der Tür bei s=220), Boden schlitzbar 2,5 cm. */
const bodenProject = (outlets: Outlet[]) => produce(miniProject(), (d) => {
  Object.assign(d.rooms[0].floor, { slotsAllowed: true, protectedLayerDepth: 5, maxSlotDepth: 2.5 });
  d.rooms[0].outlets = outlets as any;
});

describe('Leitungswege', () => {
  it('Strategie automatisch: Boden, wenn Bodenschlitze erlaubt', () => {
    const rr = computeRoomRoutes(bodenProject([]), bodenProject([]).rooms[0]);
    expect(rr.strategy).toBe('boden');
    expect(rr.entry).toMatchObject({ wallIndex: 0, s: 220 });
  });

  it('Bodentrasse 12 cm vor der Wand, Stich senkrecht bis unter die Dose', () => {
    const p = bodenProject([sd({ label: 'A1', s: 300, z: 30 })]);
    const rr = computeRoomRoutes(p, p.rooms[0]);
    expect(rr.floorSlots).toHaveLength(1);
    expect(rr.floorSlots[0]).toMatchObject({ wallIndex: 0, sFrom: 220, sTo: 300, length: 80 });
    expect(rr.floorSlots[0].from.y).toBe(12);
    expect(rr.wallSlots).toHaveLength(1);
    expect(rr.wallSlots[0]).toMatchObject({ wallIndex: 0, s: 300, zFrom: 0, zTo: 26.6 });
    // Weg: 80 waagerecht + Stich 26,6 + 2×12 Versatz
    expect(rr.paths[0].fromEntry).toBeCloseTo(80 + 26.6 + 24, 1);
  });

  it('gemeinsame Trasse: Schlitzbreite wächst mit der Kabelzahl (einlagig, kreuzungsfrei)', () => {
    const p = bodenProject([sd({ label: 'A1', s: 300 }), sd({ label: 'A2', s: 350 })]);
    const rr = computeRoomRoutes(p, p.rooms[0]);
    const two = rr.floorSlots.find((f) => f.sFrom === 220)!;
    const one = rr.floorSlots.find((f) => f.sFrom === 300)!;
    expect(two.cables).toEqual(['A1', 'A2']);
    expect(two.width).toBeGreaterThan(one.width);
    expect(one.depth).toBeLessThanOrEqual(25);
  });

  it('zu tiefer Bodenschlitz wird als Fehler gemeldet', () => {
    const p = produce(bodenProject([sd({ label: 'H1', kind: 'herd', s: 300, inserts: ['geraeteanschluss'] })]), (d) => { d.rooms[0].floor.maxSlotDepth = 1.5; d.rooms[0].floor.protectedLayerDepth = 3; d.rooms[0].routing.strategy = 'boden'; });
    const rr = computeRoomRoutes(p, p.rooms[0]);
    expect(rr.issues.some((i) => i.severity === 'fehler' && /Bodenschlitz/.test(i.message))).toBe(true);
  });

  it('nichts freigegeben → Decke abhängen „bedingt“ (Raum hoch genug); alles abgelehnt → kein Leitungsweg (Fehler)', () => {
    const p = produce(miniProject(), (d) => { d.rooms[0].outlets.push(sd({ label: 'A1' }) as any); });
    const rr = computeRoomRoutes(p, p.rooms[0]);
    expect(rr.strategy).toBe('decke');
    expect(rr.strategyReason).toMatch(/abhängen/);
    expect(rr.paths[0].routed).toBe(true);
    // niedriger Raum: Abhängen scheidet aus
    const low = produce(p, (d) => { d.rooms[0].height = 240; });
    expect(computeRoomRoutes(low, low.rooms[0]).strategy).toBe('sockelleiste'); // Abhängen scheidet aus, Kanal vor sichtbarem Aufputz
    expect(rr.issues.some((i) => /bedingt/.test(i.message))).toBe(true);
    const none = produce(p, (d) => { d.rooms[0].routingOptions.surfaceAccepted = 'nein'; d.rooms[0].routingOptions.skirtingAccepted = 'nein'; d.rooms[0].routingOptions.ceilingSuspend = 'nein'; });
    expect(computeRoomRoutes(none, none.rooms[0]).strategy).toBe('keine');
    expect(runRules(none).findings.some((f) => f.ruleId === 'TRASSE' && f.severity === 'fehler')).toBe(true);
  });

  it('waagerechte Wandschlitze laufen nicht über den Türsturz', () => {
    const p = produce(miniProject(), (d) => {
      d.rooms[0].routing.strategy = 'wand_waagerecht';
      d.rooms[0].walls.forEach((w) => (w.horizontalSlotsAllowed = true));
      d.rooms[0].outlets.push(sd({ label: 'A1', s: 50 }) as any); // links der Tür, Einspeisung rechts der Tür
    });
    const rr = computeRoomRoutes(p, p.rooms[0]);
    const h = rr.wallSlots.filter((w) => w.orientation === 'waagerecht');
    expect(h.some((w) => w.wallIndex === 0 && w.s < 190 && w.sTo > 100)).toBe(false); // nicht über der Tür (100–190)
    expect(rr.paths[0].routed).toBe(true);
  });

  it('Bad im Beispiel: Spiegelleuchte über der Vorwand → Schlitz erst ab 120 cm', () => {
    const p = example();
    const rr = computeRoomRoutes(p, p.rooms.find((r) => r.id === 'bad')!);
    const b3 = rr.wallSlots.find((w) => w.cables.includes('B3'))!;
    expect(b3.zFrom).toBe(120);
    expect(rr.wallSlots.some((w) => w.cables.includes('B6'))).toBe(false); // B6 im Vorwand-Hohlraum
    const t = routeTotals(rr);
    expect(t.drillHollow).toBe(3);
    expect(t.drillUP).toBe(4);
  });

  it('Heimkino: Lautsprecher laufen zum AV-Rack, nicht durch den Durchbruch', () => {
    const p = example();
    const rr = computeRoomRoutes(p, p.rooms.find((r) => r.id === 'heimkino')!);
    expect(rr.paths.filter((x) => x.source === 'rack').map((x) => x.label)).toEqual(expect.arrayContaining(['H3', 'H6', 'H10']));
    expect(rr.penetrations[0].cables).toBeLessThan(rr.paths.length);
  });
});

describe('Längen, Spannungsfall, Stromkreisvorschlag', () => {
  it('Gebinde: auf handelsübliche Ringe aufrunden', () => {
    expect(packsFor(cableById('NYM-J 3×1,5'), 37)).toEqual({ packs: [50], total: 50 });
    expect(packsFor(cableById('NYM-J 3×1,5'), 132)).toEqual({ packs: [100, 50], total: 150 });
  });

  it('Leerrohr: HDMI-Stecker passt weder durch M25 noch sicher durch M32, aber durch M40', () => {
    expect(connectorFits('hdmi', 'M25').fits).toBe(false);
    expect(connectorFits('hdmi', 'M32').fits).toBe(false);
    expect(connectorFits('hdmi', 'M40').fits).toBe(true);
  });

  it('Spannungsfall: 2·L·I/(κ·A·U)', () => {
    const l = computeLengths(example());
    const c = l.circuits.find((x) => x.circuitId === 'c1')!; // Licht B10, 1,5 mm²
    expect(c.voltageDropPct).toBeCloseTo((2 * c.farthestM * 10) / (56 * 1.5 * 230) * 100, 1);
  });

  it('Vorschlag: Herd 3-polig, Küche zwei Arbeitsflächenkreise, Licht getrennt, freie LS genutzt', () => {
    const p = example();
    const pr = proposeCircuits(p, 'alle');
    const byName = (re: RegExp) => pr.circuits.filter((c) => re.test(c.name));
    expect(byName(/Herd/)[0]).toMatchObject({ poles: 3, cable: 'NYM-J 5×2,5' });
    expect(byName(/Arbeitsfläche/)).toHaveLength(2);
    expect(byName(/^Licht/).every((c) => c.ratedCurrent === 10 && c.cable === 'NYM-J 3×1,5')).toBe(true);
    expect(pr.circuits.filter((c) => c.breakerGroupId === 'hv_b16').length).toBeLessThanOrEqual(9);
    expect(pr.circuits.filter((c) => c.breakerGroupId === 'hv_b10').length).toBeLessThanOrEqual(3);
    // Zuleitungen zu Unterverteilungen bleiben erhalten
    expect(pr.circuits.map((c) => c.label)).toEqual(expect.arrayContaining(['F12', 'F13']));
    // Jeder 230-V-Auslass bekommt einen Kreis, jeder Kreis mit Steckdosen einen RCD
    const applied = produce(p, (d) => applyCircuitProposal(d as Project, pr, 'alle'));
    const rep = runRules(applied);
    expect(rep.findings.filter((f) => f.ruleId === 'STROMKREIS.ZUORDNUNG')).toEqual([]);
    expect(rep.findings.filter((f) => f.ruleId === 'VDE0100-410.RCD' && f.severity === 'fehler')).toEqual([]);
    expect(rep.findings.filter((f) => f.ruleId === 'VERTEILUNG.PLAETZE' && f.severity === 'fehler')).toEqual([]);
  });
});

describe('Auslass-Vorschläge', () => {
  const schlafzimmer = () => produce(miniProject({ name: 'Schlafzimmer', usage: 'Schlafen' }), (d) => {
    d.rooms[0].furniture.push({ id: 'bett', kind: 'bett', label: 'Bett', x: 110, y: 100, w: 180, d: 200, height: 45, wallIndex: 2, note: '' } as any);
  });

  it('Schalter an der Tür (Griffseite), Licht, Rauchwarnmelder, Nachttischsteckdosen', () => {
    const p = schlafzimmer();
    const s = suggestOutlets(p, p.rooms[0]);
    const keys = s.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['schalter:d1', 'licht:mitte', 'rwm', 'bett-l:bett', 'bett-r:bett']));
    expect(s.find((x) => x.key === 'schalter:d1')!.outlet).toMatchObject({ wallIndex: 0, s: 205 });
    expect(s.find((x) => x.key === 'bett-l:bett')!.outlet.z).toBe(70);
  });

  it('kein Vorschlag erzeugt einen Regelfehler; abgelehnte kommen nicht wieder', () => {
    const p = schlafzimmer();
    const s = suggestOutlets(p, p.rooms[0]);
    const withAll = produce(p, (d) => { s.forEach((x, i) => d.rooms[0].outlets.push({ ...x.outlet, label: `V${i + 1}` } as any)); });
    expect(runRules(withAll, { roomId: 'r1' }).findings.filter((f) => f.severity === 'fehler' && f.outletId)).toEqual([]);
    const dismissed = produce(p, (d) => { d.rooms[0].dismissedSuggestions.push('rwm'); });
    expect(suggestOutlets(dismissed, dismissed.rooms[0]).map((x) => x.key)).not.toContain('rwm');
  });

  it('freie Position meidet Türöffnung und Türblatt', () => {
    const r = miniProject().rooms[0]; // Tür W1 100–190, Bänder links → Blatt 10–100
    const s = findFreeS(r, 0, 120, 4, 30)!;
    expect(s < 6 || s > 197).toBe(true);
  });
});

describe('Schlitzplan', () => {
  it('enthält Regeln, Summen, Bodenschlitze, Wandschlitze, Bohrungen je Raum', () => {
    const html = buildDocument(example(), 'schlitzplan');
    expect(html).toContain('Regeln für die Ausführung');
    expect(html).toContain('Bad – Schlitzplan');
    expect(html).toMatch(/BS1/);
    expect(html).toMatch(/WS1/);
    expect(html).toContain('Bohrungen und Durchbrüche');
    expect(html).toContain('zementärem Reparaturmörtel');
  });
});

describe('Machbarkeit der Leitungswege', () => {
  it('Kellerwohnung: Decke zu niedrig zum Abhängen → Bodenschlitz im Estrich', async () => {
    const { routingFeasibility } = await import('../src/core/planning/feasibility');
    const p = produce(example(), (d) => { d.rooms.find((r) => r.id === 'heimkino')!.routingOptions.ceilingSuspend = 'unbekannt'; });
    const f = routingFeasibility(p, p.rooms.find((r) => r.id === 'heimkino')!);
    expect(f.options.find((o) => o.option === 'decke_abhaengen')!.verdict).toBe('nein');
    expect(f.options.find((o) => o.option === 'decke_abhaengen')!.reasons[0]).toMatch(/zu niedrig/);
    expect(f.options.find((o) => o.option === 'boden')!.verdict).toBe('ja');
    expect(f.recommended!.option).toBe('boden');
  });

  it('Estrich zu dünn bzw. Folie zu flach → Bodenschlitz nicht möglich', async () => {
    const { routingFeasibility } = await import('../src/core/planning/feasibility');
    const p = produce(bodenProject([]), (d) => { d.rooms[0].floor.maxSlotDepth = 1.2; });
    expect(routingFeasibility(p, p.rooms[0]).options.find((o) => o.option === 'boden')!.verdict).toBe('nein');
  });

  it('Sockelleistenkanal: Trasse im Kanal ohne Bodenschlitz, Stiche ab Kanaloberkante', () => {
    const p = produce(bodenProject([sd({ label: 'A1', s: 300, z: 30 })]), (d) => { d.rooms[0].routing.strategy = 'sockelleiste'; });
    const rr = computeRoomRoutes(p, p.rooms[0]);
    expect(rr.floorSlots.every((f) => f.inCavity && f.duct)).toBe(true);
    expect(routeTotals(rr).floorSlotM).toBe(0);
    expect(rr.wallSlots[0].zFrom).toBe(8);
  });
});
