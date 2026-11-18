import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { assistantProgress, isDone, questionList } from '../src/core/wizard/questions';
import { createProject } from '../src/core/model/factory';
import { example } from './helpers';
import type { Project } from '../src/core/model/schema';

describe('Assistent: Fragen', () => {
  it('neues Projekt: Projektfragen, Grundriss und Räume je Geschoss, dann Vorschläge und Abschluss', () => {
    const p = createProject({ projectType: 'neubau' });
    const ids = questionList(p).map((q) => q.id);
    expect(ids[0]).toBe('p.art');
    expect(ids).not.toContain('p.bestand'); // Neubau: nichts Bestehendes
    expect(ids).not.toContain('p.smartsystem'); // Smart Home aus
    expect(ids.slice(-3)).toEqual(['v.dosen', 'v.kreise', 'fertig']);
    expect(ids).toContain(`g.plan:${p.floors[0].id}`);
  });

  it('Bestand und Smart Home blenden die passenden Fragen ein', () => {
    const p = produce(createProject({ projectType: 'teilsanierung' }), (d) => { d.smartHome.enabled = true; });
    const ids = questionList(p as Project).map((q) => q.id);
    expect(ids).toContain('p.bestand');
    expect(ids).toContain('p.smartsystem');
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
    if (q) expect(isDone(p, q)).toBe(true); // Bad hat eine Nutzung
    expect(pr.rooms.find((r) => r.roomId === bad.id)!.total).toBeGreaterThan(5);
  });
});
