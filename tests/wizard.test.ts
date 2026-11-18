import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { createProject, createRectRoom, loadProject } from '../src/core/model/factory';
import { Project, SCHEMA_VERSION } from '../src/core/model/schema';
import { allSteps, missingFor, progress, wallSideLabel } from '../src/core/wizard/steps';
import { example } from './helpers';

describe('Migration', () => {
  it('Projektdatei v1 wird auf die aktuelle Version gehoben und gilt als fertig erfasst', () => {
    const v1 = JSON.parse(readFileSync(new URL('./fixtures/projekt-v1.json', import.meta.url), 'utf8'));
    expect(v1.schemaVersion).toBe(1);
    const p = loadProject(v1);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.wizard.finished).toBe(true);
    expect(p.rooms.length).toBe(v1.rooms.length);
  });
});

describe('Assistent', () => {
  const empty = () => createProject({ name: 'Neues Projekt' });

  it('neues Projekt beginnt im Assistenten bei Schritt „projekt.start“', () => {
    const p = empty();
    expect(p.wizard.finished).toBe(false);
    expect(p.wizard.step).toBe('start');
    expect(allSteps(p)[0].id).toBe('projekt.start');
  });

  it('fragt erst, was fehlt: Name, Bundesland, Verteilung, Räume', () => {
    const p = empty();
    const miss = (id: string) => missingFor(p, allSteps(p).find((s) => s.id === id)!);
    expect(miss('projekt.start')).toContain('Projektname');
    expect(miss('projekt.gebaeude')[0]).toMatch(/Bundesland/);
    expect(miss('projekt.verteilung')).toContain('Hauptverteilung');
    expect(miss('raeume')[0]).toMatch(/mindestens ein Raum/);
  });

  it('jeder geplante Raum bekommt seine Unterschritte; Neubau ohne Bestandsleitungen', () => {
    const room = createRectRoom({ id: 'r', floorId: 'geschoss_eg', name: 'Küche', formerName: 'HEIZUNG', width: 240, depth: 338, height: 225 });
    const p = Project.parse({ ...empty(), projectType: 'teilsanierung', rooms: [room] });
    const ids = allSteps(p).map((s) => s.id);
    expect(ids).toContain('raum:r:tueren');
    expect(ids).toContain('raum:r:bestand');
    const neubau = produce(p, (d) => { d.projectType = 'neubau'; });
    expect(allSteps(neubau).map((s) => s.id)).not.toContain('raum:r:bestand');
    // Unbekannte Wände/Decke und fehlende Tür werden als offen gemeldet
    const open = progress(p).open.map((o) => o.step.id);
    expect(open).toEqual(expect.arrayContaining(['raum:r:waende', 'raum:r:tueren', 'raum:r:decke', 'raum:r:nutzung']));
  });

  it('Wandlage für Laien: W1 oben, W2 rechts, W3 unten, W4 links', () => {
    const r = example().rooms.find((x) => x.id === 'bad')!;
    expect([0, 1, 2, 3].map((i) => wallSideLabel(r, i))).toEqual(['oben im Plan', 'rechts im Plan', 'unten im Plan', 'links im Plan']);
  });

  it('Beispielprojekt hat keine offenen Pflichtangaben im Projektteil', () => {
    const p = example();
    const projectOpen = progress(p).open.filter((o) => !o.step.roomId).map((o) => o.step.id);
    expect(projectOpen).toEqual([]);
  });
});
