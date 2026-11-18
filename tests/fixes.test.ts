import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { runRules } from '../src/core/rules/rules';
import { fixesFor, upsizeCable, verifyFix } from '../src/core/rules/fixes';
import type { Project } from '../src/core/model/schema';
import { example } from './helpers';

const apply = (p: Project, fn: (d: Project) => void) => produce(p, (d) => { fn(d as Project); });

describe('Lösungsvorschläge', () => {
  it('jede Meldung im Beispiel: alle angebotenen Änderungen lösen die Meldung (Zeitmessung)', () => {
    const p = example();
    const t0 = Date.now();
    const report = runRules(p);
    let offered = 0;
    const summary: string[] = [];
    for (const f of report.findings) {
      const fx = fixesFor(p, f);
      for (const x of fx) if (x.apply) { offered++; expect(verifyFix(p, f, x)).toBe(true); }
      summary.push(`${f.severity} ${f.ruleId} ${f.ref ?? ''}: ${fx.map((x) => x.label).join(' | ') || '–'}`);
    }
    console.log(summary.join('\n'), `\n${report.findings.length} Meldungen, ${offered} Änderungsvorschläge, ${Date.now() - t0} ms`);
  });

  it('Flur mit zu wenig Steckdosen: Vorschlag setzt Steckdosen an freie Stellen', () => {
    let p = example();
    const flur = p.rooms.find((r) => r.id === 'flur')!;
    p = apply(p, (d) => { const r = d.rooms.find((x) => x.id === 'flur')!; r.outlets = r.outlets.filter((o) => o.kind !== 'steckdose'); });
    const f = runRules(p, { roomId: flur.id }).findings.find((x) => x.ruleId === 'DIN18015-2.AUSSTATTUNG' && /Steckdosen/.test(x.message));
    expect(f, 'Flur ohne Steckdose sollte gemeldet werden').toBeTruthy();
    const fx = fixesFor(p, f!);
    expect(fx.length).toBeGreaterThan(0);
    const after = apply(p, (d) => fx[0].apply!(d));
    expect(runRules(after, { roomId: flur.id }).findings.some((x) => x.ruleId === 'DIN18015-2.AUSSTATTUNG' && x.severity === 'warnung' && /Steckdosen/.test(x.message))).toBe(false);
    expect(after.rooms.find((r) => r.id === 'flur')!.outlets.filter((o) => o.kind === 'steckdose').length).toBeGreaterThan(0);
  });

  it('Schalter auf der Bandseite wird auf die Griffseite verschoben', () => {
    let p = example();
    const room = p.rooms.find((r) => r.doors.length && r.outlets.some((o) => o.kind === 'schalter'))!;
    const sw = room.outlets.find((o) => o.kind === 'schalter')!;
    const d = room.doors.find((x) => x.wallIndex === sw.wallIndex) ?? room.doors[0];
    // auf die Bandseite setzen
    p = apply(p, (x) => { const o = x.rooms.find((r) => r.id === room.id)!.outlets.find((o) => o.id === sw.id)!; o.wallIndex = d.wallIndex; o.s = d.hinge === 'links' ? d.s - 15 : d.s + d.width + 15; });
    const f = runRules(p, { roomId: room.id }).findings.find((x) => x.ruleId === 'SCHALTER.GRIFFSEITE' && x.outletId === sw.id && x.severity === 'warnung');
    expect(f).toBeTruthy();
    const fx = fixesFor(p, f!).filter((x) => x.apply);
    expect(fx.length).toBeGreaterThan(0);
    expect(fx[0].label).toMatch(/verschieben/);
  });

  it('Wallbox an Anschlussdose → Festanschluss', () => {
    const p = apply(example(), (d) => { d.rooms.find((r) => r.id === 'garage')!.outlets.find((o) => o.id === 'ga3')!.kind = 'anschlussdose'; });
    const f = runRules(p).findings.find((x) => /fest angeschlossen/.test(x.message))!;
    const fx = fixesFor(p, f);
    expect(fx[0].label).toMatch(/Festanschluss/);
  });

  it('Querschnitt vergrößern', () => {
    expect(upsizeCable('NYM-J 3×1,5')).toBe('NYM-J 3×2,5');
    expect(upsizeCable('NYM-J 5×6')).toBe('NYM-J 5×10');
  });
});
