import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { assistantProgress, isDone, questionList } from '../src/core/wizard/questions';
import { createProject } from '../src/core/model/factory';
import { proposeCircuits } from '../src/core/planning/circuits';
import { runRules } from '../src/core/rules/rules';
import { computeMaterial } from '../src/core/planning/bom';
import { example } from './helpers';
import type { Project } from '../src/core/model/schema';

describe('Assistent: Fragen', () => {
  it('neues Projekt: Projektfragen, Grundriss und Räume je Geschoss, dann Vorschläge und Abschluss', () => {
    const p = createProject({ projectType: 'neubau' });
    const ids = questionList(p).map((q) => q.id);
    expect(ids[0]).toBe('p.art');
    expect(ids).not.toContain('v.vorhanden'); // Neubau: nichts Bestehendes
    expect(ids).not.toContain('p.smartsystem'); // Smart Home aus
    expect(ids.slice(-3)).toEqual(['v.dosen', 'v.kreise', 'fertig']);
    expect(ids).toContain(`g.plan:${p.floors[0].id}`);
  });

  it('„Was bleibt?“ wird nicht mehr am Anfang gefragt, sondern bei Bestand nach den Vorschlägen und vor den Stromkreisen', () => {
    const p = produce(createProject({ projectType: 'teilsanierung' }), (d) => { d.smartHome.enabled = true; });
    const ids = questionList(p as Project).map((q) => q.id);
    expect(ids.some((x) => x.startsWith('p.bestand'))).toBe(false);
    expect(ids).toContain('p.smartsystem');
    expect(ids.indexOf('v.dosen')).toBeLessThan(ids.indexOf('v.vorhanden'));
    expect(ids.indexOf('v.vorhanden')).toBeLessThan(ids.indexOf('v.kreise'));
  });

  it('Raumfragen je Raum; Aufputzräume ohne Fußbodenheizungs-Frage; per Kachel gewählte Nutzung wird nicht erneut gefragt', () => {
    const p = example();
    const garage = p.rooms.find((r) => r.id === 'garage')!;
    const qs = questionList(p).filter((q) => q.roomId === garage.id).map((q) => q.key);
    expect(qs).not.toContain('raum.fbh');
    const p2 = produce(p, (d) => { d.wizard.done.push(`raum:${garage.id}:typ`); });
    expect(questionList(p2 as Project).some((q) => q.id === `raum:${garage.id}:typ`)).toBe(false);
  });

  it('Fortschritt zählt beantwortete Fragen; Daten zählen mit (Nutzung, bestätigter Raum)', () => {
    const p = example();
    const pr = assistantProgress(p);
    expect(pr.total).toBe(questionList(p).length);
    const bad = p.rooms.find((r) => r.id === 'bad')!;
    const q = questionList(p).find((x) => x.id === `raum:${bad.id}:typ`);
    if (q) expect(isDone(p, q)).toBe(true);
    expect(pr.rooms.find((r) => r.roomId === bad.id)!.total).toBeGreaterThan(5);
  });
});

describe('Schon vorhanden (Bestand bleibt)', () => {
  it('vorhandene Wallbox: kein neuer Stromkreis, keine Wallbox-Prüfung, keine neue Leitung', () => {
    const base = produce(example(), (d) => { d.rooms.find((r) => r.id === 'garage')!.outlets.find((x) => x.id === 'ga3')!.circuitId = undefined; }) as Project;
    const wbCircuit = (p: Project) => 'ga3' in proposeCircuits(p, 'offen').assignment;
    expect(wbCircuit(base)).toBe(true);
    const kept = produce(base, (d) => { d.rooms.find((r) => r.id === 'garage')!.outlets.find((x) => x.id === 'ga3')!.status = 'bestand_bleibt'; }) as Project;
    expect(wbCircuit(kept)).toBe(false);
    expect(runRules(kept).findings.some((f) => f.ruleId === 'VDE0100-722.EMOBILITAET')).toBe(false);
    expect(runRules(kept, { roomId: 'garage' }).findings.some((f) => f.ruleId === 'STROMKREIS.ZUORDNUNG' && /GA3/.test(f.message))).toBe(false);
    // mit Stromkreis im Beispiel: Leitung 5×6 entfällt, wenn die Wallbox schon da ist
    const withCircuit = example();
    const keptWithCircuit = produce(withCircuit, (d) => { const o = d.rooms.find((r) => r.id === 'garage')!.outlets.find((x) => x.id === 'ga3')!; o.status = 'bestand_bleibt'; o.circuitId = undefined; }) as Project;
    const cable = (p: Project) => computeMaterial(p).lines.filter((l) => /5×6/.test(l.label)).reduce((s, l) => s + l.need, 0);
    expect(cable(keptWithCircuit)).toBeLessThan(cable(withCircuit));
  });
});
