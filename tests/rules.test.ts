import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { runRules } from '../src/core/rules/rules';
import { example, miniProject } from './helpers';
import type { Outlet, Project } from '../src/core/model/schema';

const add = (p: Project, o: Partial<Outlet>) => produce(p, (d) => {
  d.rooms[0].outlets.push({ id: o.label ?? 'o', label: 'X1', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 200, z: 30, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'up_tief', inserts: ['steckdose'], controls: [], smart: false, status: 'neu', note: '', ...o } as Outlet);
});
const ids = (p: Project) => runRules(p).findings.map((f) => `${f.ruleId}:${f.severity}`);

describe('Regeln', () => {
  it('jede Meldung hat Quelle und Begründung', () => {
    for (const f of runRules(example()).findings) {
      expect(f.source.length).toBeGreaterThan(2);
      expect(f.message.length).toBeGreaterThan(10);
    }
  });

  it('Beispielprojekt hat keine Fehler', () => {
    expect(runRules(example()).counts.fehler).toBe(0);
  });

  it('Dose in Türöffnung → Fehler', () => {
    expect(ids(add(miniProject(), { s: 140 }))).toContain('TUER.OEFFNUNG:fehler');
  });

  it('Dose hinter dem geöffneten Türblatt → Warnung', () => {
    // Bänder links bei s=100, Blatt liegt offen auf 10…100
    expect(ids(add(miniProject(), { s: 60, z: 105, kind: 'schalter' }))).toContain('TUER.OEFFNUNG:warnung');
  });

  it('Schalter auf der Bandseite → Warnung; auf der Griffseite 15 cm → ok', () => {
    expect(ids(add(miniProject(), { s: 85, z: 105, kind: 'schalter' }))).toContain('SCHALTER.GRIFFSEITE:warnung');
    const ok = ids(add(miniProject(), { s: 205, z: 105, kind: 'schalter' }));
    expect(ok.filter((x) => x.startsWith('SCHALTER'))).toEqual([]);
  });

  it('Installationszone: 30 cm ü. FFB ok, 70 cm mitten auf der Wand → Warnung', () => {
    expect(ids(add(miniProject(), { s: 300, z: 30 })).filter((x) => x.startsWith('DIN18015'))).toEqual([]);
    expect(ids(add(miniProject(), { s: 300, z: 70 }))).toContain('DIN18015-3.ZONE:warnung');
    // senkrechte Zone neben der Tür (Türkante 190, Abstand 20)
    expect(ids(add(miniProject(), { s: 210, z: 70 })).filter((x) => x.startsWith('DIN18015'))).toEqual([]);
  });

  it('Normwert-Überschreibung wirkt (untere Zone bis 80 cm)', () => {
    const p = produce(add(miniProject(), { s: 300, z: 70 }), (d) => { d.settings.normOverrides['zone.h.unten.bis'] = 80; });
    expect(ids(p)).not.toContain('DIN18015-3.ZONE:warnung');
  });

  it('Hohlwanddose über der Vorwand → Fehler; UP-Dose hinter Vorwand → Warnung', () => {
    const base = produce(miniProject(), (d) => { d.rooms[0].walls[1].preWall.push({ id: 'vw', from: 50, to: 200, height: 120, depth: 20, construction: 'trockenbau', label: 'WC' }); });
    const high = produce(base, (d) => { d.rooms[0].outlets.push({ id: 'a', label: 'A1', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 100, z: 118, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'vorwand', inserts: [], controls: [], smart: false, status: 'neu', note: '' }); });
    expect(ids(high)).toContain('VORWAND.HOEHE:fehler');
    const up = produce(base, (d) => { d.rooms[0].outlets.push({ id: 'a', label: 'A1', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 100, z: 30, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'up_tief', inserts: [], controls: [], smart: false, status: 'neu', note: '' }); });
    expect(ids(up)).toContain('VORWAND.HOEHE:warnung');
  });

  it('Kaminwange → Fehler', () => {
    const p = produce(add(miniProject(), { s: 320, z: 30 }), (d) => { d.rooms[0].walls[0].zones.push({ id: 'k', kind: 'kaminwange', from: 300, to: 350, zFrom: 0, depth: 0, note: '' }); });
    expect(ids(p)).toContain('WAND.TABUZONE:fehler');
  });

  it('Bodenschlitz tiefer als Folie minus Sicherheit → Fehler', () => {
    const p = produce(miniProject(), (d) => { Object.assign(d.rooms[0].floor, { slotsAllowed: true, protectedLayerDepth: 3, maxSlotDepth: 2.5 }); });
    expect(ids(p)).toContain('BODEN.SCHLITZTIEFE:fehler');
  });

  it('Steckdosenstromkreis ohne RCD → Fehler; zu wenig freie LS → Fehler', () => {
    const p = produce(add(miniProject(), { circuitId: 'c' }), (d) => {
      d.distributions.push({ id: 'hv', name: 'HV', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'TN-C-S', meter: '', freeModules: 0, breakers: [{ id: 'b', characteristic: 'B', ratedCurrent: 16, poles: 1, count: 1, free: 0, note: '' }], rcds: [], hasSpd: false, photos: [], note: '' });
      d.circuits.push({ id: 'c', label: 'F1', name: 'Test', distributionId: 'hv', breakerGroupId: 'b', characteristic: 'B', ratedCurrent: 16, poles: 1, cable: 'NYM-J 3×2,5', afdd: false, reason: '', note: '' });
    });
    expect(ids(p)).toContain('VDE0100-410.RCD:fehler');
    expect(ids(p)).toContain('VERTEILUNG.PLAETZE:fehler');
  });

  it('Rauchwarnmelder im Schlafraum fehlt → Warnung', () => {
    const p = produce(miniProject(), (d) => { d.rooms[0].usage = 'Schlafen'; });
    expect(ids(p)).toContain('LBO.RAUCHWARNMELDER:warnung');
  });

  it('Smart Home (Shelly): Hinweis auf tiefe Dose und Neutralleiter', () => {
    const p = produce(add(miniProject(), { s: 205, z: 105, kind: 'schalter', boxType: 'up' }), (d) => { d.smartHome.enabled = true; d.smartHome.system = 'shelly'; });
    const msgs = runRules(p).findings.filter((f) => f.ruleId === 'SMART.DOSENTIEFE').map((f) => f.message).join(' ');
    expect(msgs).toContain('tiefe Dose');
    expect(msgs).toContain('Neutralleiter');
  });

  it('deaktivierte Regel meldet nichts', () => {
    const p = produce(add(miniProject(), { s: 140 }), (d) => { d.settings.disabledRules['TUER.OEFFNUNG'] = 'Test'; });
    expect(ids(p).some((x) => x.startsWith('TUER.OEFFNUNG'))).toBe(false);
  });
});
