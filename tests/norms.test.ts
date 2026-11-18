import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { runRules } from '../src/core/rules/rules';
import { bathZone, capacityChecks, iz, groupFactor } from '../src/core/rules/norms';
import { loadsForType, projectDemand, parseMainFuse, circuitForLoad, circuitPower } from '../src/core/planning/loads';
import { suggestOutlets } from '../src/core/planning/suggest';
import { proposeCircuits } from '../src/core/planning/circuits';
import { floorElevation } from '../src/core/planning/circuits';
import { guessRoomType, ROOM_TYPE_INFO } from '../src/core/model/roomTypes';
import { allSteps } from '../src/core/wizard/steps';
import { buildDocument } from '../src/core/docs/documents';
import { loadProject } from '../src/core/model/factory';
import { SCHEMA_VERSION, type Outlet, type Project } from '../src/core/model/schema';
import { example, miniProject } from './helpers';

const ids = (p: Project) => runRules(p).findings.map((f) => `${f.ruleId}:${f.severity}`);
const outlet = (o: Partial<Outlet>): Outlet => ({ id: o.label ?? 'x', label: 'X1', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 50, z: 105, gangs: 1, orientation: 'waagerecht', growth: 'rechts', boxType: 'up_tief', inserts: ['steckdose'], controls: [], smart: false, status: 'neu', note: '', ...o } as Outlet);

describe('Raumtypen und Leistungsbedarf', () => {
  it('Raumtyp aus Name erraten (Name vor Nutzung)', () => {
    expect(guessRoomType('Flur')).toBe('flur');
    expect(guessRoomType('Küche')).toBe('kueche');
    expect(guessRoomType('Gäste-WC')).toBe('wc');
  });

  it('typische Verbraucher je Raumtyp: Küche mit Kochfeld 11 kW (Drehstrom, eigener Kreis)', () => {
    const l = loadsForType('kueche');
    const herd = l.find((x) => /Kochfeld/.test(x.label))!;
    expect(herd).toMatchObject({ power: 11000, phases: 3, dedicated: true, connection: 'herd' });
    expect(circuitForLoad(herd)).toMatchObject({ poles: 3, ratedCurrent: 16, cable: 'NYM-J 5×2,5' });
    expect(circuitForLoad({ ...herd, label: 'Durchlauferhitzer', power: 21000 })).toMatchObject({ ratedCurrent: 32, cable: 'NYM-J 5×6' });
  });

  it('Hauptsicherung lesen und gleichzeitigen Bedarf schätzen', () => {
    expect(parseMainFuse('3× 63 A NH')!.amps).toBe(63);
    expect(Math.round(parseMainFuse('3x50A')!.watts)).toBe(34641);
    const d = projectDemand(example());
    expect(d.installed).toBeGreaterThan(30000);
    expect(d.simultaneous).toBeLessThan(d.installed);
    expect(d.ratio).toBeGreaterThan(0.3);
  });

  it('Verbraucher ohne Anschluss → Vorschlag; beim Stromkreisvorschlag eigener Kreis mit passender Leitung', () => {
    const p = produce(miniProject({ name: 'HWR' }), (d) => { d.rooms[0].roomType = 'hwr'; d.rooms[0].loads = loadsForType('hwr') as any; });
    const s = suggestOutlets(p, p.rooms[0]).filter((x) => x.source === 'verbraucher');
    expect(s.map((x) => x.outlet.note)).toEqual(expect.arrayContaining(['Waschmaschine', 'Trockner (Wärmepumpe)']));
    // übernehmen + verknüpfen, dann Vorschlag
    const q = produce(p, (d) => { s.forEach((x, i) => { d.rooms[0].outlets.push({ ...x.outlet, label: `W${i + 1}` } as any); d.rooms[0].loads.find((l) => l.id === x.loadId)!.outletId = x.outlet.id; }); });
    const pr = proposeCircuits(produce(q, (d) => { d.distributions.push({ id: 'hv', name: 'HV', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '3× 35 A', netForm: 'TN-C-S', meter: '', freeModules: 10, breakers: [], rcds: [{ id: 'fi', label: 'FI', ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: true }], hasSpd: true, photos: [], note: '' }); }), 'alle');
    expect(pr.circuits.filter((c) => /Waschmaschine|Trockner/.test(c.name))).toHaveLength(2);
  });

  it('Last je Stromkreis aus zugeordneten Verbrauchern; Überlast wird gemeldet', () => {
    const p = example();
    const k = p.circuits.find((c) => c.id === 'c6')!; // Herd
    expect(circuitPower(p, k)).toBe(11000);
    const over = produce(p, (d) => { d.rooms.find((r) => r.id === 'kueche')!.loads.find((l) => /Kochfeld/.test(l.label))!.power = 15000; });
    expect(ids(over)).toContain('LEISTUNG.STROMKREIS:warnung');
  });

  it('Mindestausstattung nach Raumtyp', () => {
    const p = produce(miniProject(), (d) => { d.rooms[0].roomType = 'schlafen'; d.rooms[0].outlets.push(outlet({ label: 'S1', s: 300, z: 30 }) as any); });
    expect(ids(p)).toContain('DIN18015-2.AUSSTATTUNG:warnung');
    expect(ROOM_TYPE_INFO.schlafen.minSockets(12)).toBe(3);
  });
});

describe('Normmodule', () => {
  const bad = () => produce(miniProject({ name: 'Bad' }), (d) => {
    const r = d.rooms[0];
    r.roomType = 'bad'; r.wetRoom = true;
    r.furniture.push({ id: 'du', kind: 'dusche', label: 'Dusche', x: 300, y: 0, w: 100, d: 100, height: 200, wallIndex: 1, note: '' } as any);
  });

  it('Bad: Steckdose in Bereich 1 und 2 → Fehler, außerhalb ok, über 225 cm ok', () => {
    const p = bad();
    const r = p.rooms[0];
    expect(bathZone(p, r, outlet({ wallIndex: 0, s: 350, z: 105 }))?.zone).toBe(1);
    expect(bathZone(p, r, outlet({ wallIndex: 0, s: 260, z: 105 }))?.zone).toBe(2);
    expect(bathZone(p, r, outlet({ wallIndex: 0, s: 200, z: 105 }))).toBeNull();
    expect(bathZone(p, r, outlet({ wallIndex: 0, s: 260, z: 230 }))).toBeNull();
    const withSd = produce(p, (d) => { d.rooms[0].outlets.push(outlet({ label: 'B1', wallIndex: 0, s: 260 }) as any); });
    expect(ids(withSd)).toContain('VDE0100-701.SCHUTZBEREICHE:fehler');
    const fan = produce(p, (d) => { d.rooms[0].outlets.push(outlet({ label: 'L1', kind: 'anschlussdose', wallIndex: 0, s: 260, z: 200, note: 'Lüfter', inserts: ['geraeteanschluss'] }) as any); });
    expect(ids(fan)).toContain('VDE0100-701.SCHUTZBEREICHE:hinweis');
  });

  it('Beispiel-Bad: Dusch-WC als fester Anschluss in Bereich 2 ist zulässig (nur Hinweis)', () => {
    const f = runRules(example()).findings.filter((x) => x.ruleId === 'VDE0100-701.SCHUTZBEREICHE');
    expect(f.every((x) => x.severity !== 'fehler')).toBe(true);
  });

  it('Strombelastbarkeit: Tabellenwerte und Häufung', () => {
    expect(iz('C', 1.5, false)).toBe(19.5);
    expect(iz('B2', 2.5, false)).toBe(23);
    expect(groupFactor(3, false)).toBe(0.79);
    expect(groupFactor(3, true)).toBe(0.7);
    // 1,5 mm² an B16 mit 3 Kreisen gebündelt im Rohr: 16,5 × 0,7 = 11,6 A < 16 A → Fehler
    const p = produce(example(), (d) => { d.circuits.find((c) => c.id === 'g2')!.ratedCurrent = 16; });
    const k = capacityChecks(p).find((x) => x.circuit.id === 'g2')!;
    expect(k.method).toBe('B2');
    expect(ids(p)).toContain('VDE0100-520.BELASTBARKEIT:fehler');
  });

  it('SPD fehlt → Warnung bei Neubau, Hinweis bei Teilsanierung', () => {
    const p = produce(example(), (d) => { d.distributions.forEach((x) => (x.hasSpd = false)); });
    expect(ids(p)).toContain('VDE0100-443.SPD:hinweis');
    expect(ids(produce(p, (d) => { d.projectType = 'neubau'; }))).toContain('VDE0100-443.SPD:warnung');
  });

  it('Wallbox: eigener Kreis, RCD-Typ-Hinweis, Anmeldung', () => {
    const msgs = runRules(example()).findings.filter((f) => f.ruleId === 'VDE0100-722.EMOBILITAET').map((f) => f.message).join(' ');
    expect(msgs).toContain('Anmeldung beim Netzbetreiber');
    const shared = produce(example(), (d) => { d.rooms.find((r) => r.id === 'garage')!.outlets.find((o) => o.id === 'ga5')!.circuitId = 'g1'; });
    expect(ids(shared)).toContain('VDE0100-722.EMOBILITAET:fehler');
  });

  it('Erdverlegung: NYM in den Garten → Fehler', () => {
    const p = produce(example(), (d) => { d.circuits.find((c) => c.id === 'k2')!.cable = 'NYM-J 5×4'; });
    expect(ids(p)).toContain('ERDVERLEGUNG:fehler');
  });

  it('AFDD-Hinweis für Schlafräume', () => {
    expect(runRules(example()).findings.some((f) => f.ruleId === 'VDE0100-420.AFDD' && /Büro \/ Gäste/.test(f.message))).toBe(true);
  });

  it('Prüfprotokoll enthält Regelübersicht, Dimensionierung und Messprotokoll', () => {
    const html = buildDocument(example(), 'pruefprotokoll');
    expect(html).toContain('Planungsprüfung');
    expect(html).toContain('Leitungsdimensionierung');
    expect(html).toContain('DIN VDE 0100-600');
    expect(html).toContain('Elektrofachkraft (Errichter)');
  });
});

describe('Geschosse und Assistent', () => {
  it('Höhenlage der Geschosse aus den Geschosshöhen', () => {
    const p = produce(example(), (d) => {
      d.floors.push({ id: 'eg', name: 'EG', level: 0, height: 280, backgroundOpacity: 0.6 }, { id: 'og', name: 'OG', level: 1, height: 270, backgroundOpacity: 0.6 });
      d.floors.find((f) => f.id === 'geschoss_kg')!.height = 250;
    });
    expect(floorElevation(p, 'geschoss_kg')).toBe(-250);
    expect(floorElevation(p, 'eg')).toBe(0);
    expect(floorElevation(p, 'og')).toBe(280);
  });

  it('Raumschritte beginnen mit der Nutzung; Möbel kommen nach Boden/Decke', () => {
    const subs = allSteps(example()).filter((s) => s.roomId === 'bad').map((s) => s.sub);
    expect(subs[0]).toBe('nutzung');
    expect(subs.indexOf('einrichtung')).toBeGreaterThan(subs.indexOf('decke'));
  });

  it('Projektdatei v4 → aktuelle Version, Raumtyp wird erraten', () => {
    const v4 = JSON.parse(readFileSync(new URL('./fixtures/projekt-v4.json', import.meta.url), 'utf8'));
    const p = loadProject(v4);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.rooms.find((r) => r.id === 'flur')!.roomType).toBe('flur');
    expect(p.rooms.find((r) => r.id === 'kueche')!.roomType).toBe('kueche');
    expect(p.floors[0].height).toBe(275);
  });
});
