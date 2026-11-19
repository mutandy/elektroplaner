import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { merge3 } from '../src/core/model/merge';
import { Project as ProjectSchema, type Project } from '../src/core/model/schema';
import { example } from './helpers';

const edit = (p: Project, fn: (d: Project) => void) => produce(p, (d) => { fn(d as Project); });

describe('Gleichzeitig auf zwei Geräten', () => {
  it('Handy ändert die Küche, PC das Bad: beides bleibt', () => {
    const base = example();
    const pc = edit(base, (d) => { d.rooms.find((r) => r.id === 'bad')!.height = 240; });
    const phone = edit(base, (d) => { d.rooms.find((r) => r.id === 'kueche')!.name = 'Wohnküche'; });
    const merged = merge3(base, pc, phone);
    expect(merged.rooms.find((r) => r.id === 'bad')!.height).toBe(240);
    expect(merged.rooms.find((r) => r.id === 'kueche')!.name).toBe('Wohnküche');
    expect(() => ProjectSchema.parse(merged)).not.toThrow();
  });

  it('beide setzen neue Auslässe im selben Raum: alle bleiben; gelöschter Raum bleibt gelöscht', () => {
    const base = example();
    const flur = base.rooms.find((r) => r.id === 'flur')!;
    const o = flur.outlets[0];
    const mine = edit(base, (d) => { d.rooms.find((r) => r.id === 'flur')!.outlets.push({ ...o, id: 'neu_pc', label: 'F98' }); });
    const theirs = edit(base, (d) => {
      d.rooms.find((r) => r.id === 'flur')!.outlets.push({ ...o, id: 'neu_handy', label: 'F99' });
      d.rooms = d.rooms.filter((r) => r.id !== 'kellerraum');
    });
    const merged = merge3(base, mine, theirs);
    const ids = merged.rooms.find((r) => r.id === 'flur')!.outlets.map((x) => x.id);
    expect(ids).toContain('neu_pc');
    expect(ids).toContain('neu_handy');
    expect(merged.rooms.some((r) => r.id === 'kellerraum')).toBe(false);
  });

  it('beide ändern denselben Wert: der eigene (zuletzt gespeicherte) gewinnt; Protokoll von beiden', () => {
    const base = example();
    const mine = edit(base, (d) => { d.name = 'Name PC'; d.changeLog.push({ at: '2099-01-01T10:00:00Z', text: 'PC' }); });
    const theirs = edit(base, (d) => { d.name = 'Name Handy'; d.changeLog.push({ at: '2099-01-01T09:00:00Z', text: 'Handy' }); });
    const merged = merge3(base, mine, theirs);
    expect(merged.name).toBe('Name PC');
    expect(merged.changeLog.slice(-2).map((x) => x.text)).toEqual(['Handy', 'PC']);
  });

  it('ich lösche einen Auslass, das andere Gerät verschiebt ihn: er bleibt (verschoben)', () => {
    const base = example();
    const room = base.rooms.find((r) => r.id === 'flur')!;
    const oid = room.outlets[0].id;
    const mine = edit(base, (d) => { const r = d.rooms.find((x) => x.id === 'flur')!; r.outlets = r.outlets.filter((x) => x.id !== oid); });
    const theirs = edit(base, (d) => { d.rooms.find((x) => x.id === 'flur')!.outlets.find((x) => x.id === oid)!.s = 33; });
    const merged = merge3(base, mine, theirs);
    expect(merged.rooms.find((x) => x.id === 'flur')!.outlets.find((x) => x.id === oid)?.s).toBe(33);
  });
});
