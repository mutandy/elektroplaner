import type { Draft } from 'immer';
import type { Project, SmartHomeSystem } from '../../core/model/schema';
import { newId } from '../../core/model/factory';
import { projectTypeLabel, smartHomeLabel } from '../../core/model/labels';
import { SWITCH_PROGRAMS } from '../../core/model/catalog';
import { NORM_VALUES } from '../../core/rules/normValues';
import { createRectRoom } from '../../core/model/factory';
import { roomArea, fmt } from '../../core/geometry/room';
import { renderFloorOverview } from '../../core/render/plan';
import { store } from '../store';
import { Check, EditTable, Field, NumberInput, Section, Select, TextInput, opts, type Col } from '../components/ui';

const up = (text: string, fn: (p: Draft<Project>) => void) => store.update(text, fn);

/** Was die Wahl des Smart-Home-Systems für die Elektroplanung bedeutet. */
export const SMART_HOME_IMPACT: Record<SmartHomeSystem, string[]> = {
  keines: ['Konventionelle Installation. Empfehlung trotzdem: Neutralleiter in jede Schalterdose und tiefe Dosen – dann lässt sich später nachrüsten.'],
  knx: [
    'Busleitung (z. B. J-Y(St)Y 2×2×0,8, grün) zu jeder Schaltstelle, jedem Präsenzmelder und jeder Wetterstation – in Linien-/Baumstruktur.',
    'Lasten (Licht, Steckdosen, Rollläden) sternförmig zur Verteilung, dort Schalt-/Dimm-/Jalousieaktoren auf der Hutschiene → deutlich mehr Platz in der Verteilung (TE einplanen!).',
    'Spannungsversorgung, Linienkoppler, IP-Schnittstelle; Programmierung mit ETS durch Fachbetrieb/Integrator.',
    'Sehr zuverlässig, unabhängig von WLAN/Cloud, höchste Kosten.',
  ],
  home_assistant: [
    'Zentrale (Mini-PC/Raspberry Pi/HA Green) im Netzwerkschrank, Funk-Koordinator für Zigbee/Thread nahe zentral platzieren.',
    'Geräte nach Wahl: Shelly (WLAN), Zigbee, Matter/Thread, Homematic IP, auch KNX-Anbindung möglich.',
    'Für UP-Aktoren: Neutralleiter in die Schalterdose, tiefe Dosen (Elektronikdosen).',
    'LAN-Dose/PoE am Standort der Zentrale; WLAN-Abdeckung (Access Points) planen.',
  ],
  shelly: [
    'UP-Aktor (z. B. Shelly Plus 1/2PM, Dimmer) hinter dem vorhandenen Schalter → Schalter wird zum Eingang.',
    'Voraussetzung: Neutralleiter in der Schalterdose, tiefe Dose, gute WLAN-Abdeckung.',
    'Aktoren nicht in Dosen mit vielen Klemmen quetschen – Wärme beachten; ggf. Aktor in Abzweigdose/Verteilung (Hutschienen-Shelly).',
  ],
  zigbee: [
    'Funk-Mesh: netzbetriebene Aktoren wirken als Repeater. Koordinator zentral.',
    'UP-Aktoren mit Neutralleiter bevorzugen; tiefe Dosen.',
  ],
  matter_thread: [
    'Herstellerübergreifender Standard; Thread-Border-Router nötig (z. B. HA, Apple TV, HomePod).',
    'Neutralleiter in Schalterdosen, tiefe Dosen.',
  ],
  homematic_ip: [
    'Funk (868 MHz) mit Access Point oder Zentrale (CCU3); Wired-Variante mit Busleitung möglich.',
    'UP-Aktoren mit Neutralleiter, tiefe Dosen; für Wired: Busleitung wie bei KNX vorsehen.',
  ],
  gemischt: ['Pro Raum festlegen. Grundsätze: N in jede Schalterdose, tiefe Dosen, LAN zum Standort der Zentrale; in KNX-Räumen Busleitung.'],
};

export function ProjectView({ project }: { project: Project }) {
  const sh = project.smartHome;
  const set = <K extends keyof Project>(k: K, v: Project[K], label: string) => up(`Projekt: ${label}`, (p) => { (p as any)[k] = v; });
  const sp = project.settings.switchProgram;
  return (
    <div className="page-view">
      <Section title="1 · Projekt und Rahmenbedingungen">
        <div className="grid3">
          <Field label="Projektname"><TextInput value={project.name} onChange={(v) => set('name', v, 'Name')} /></Field>
          <Field label="Projektart"><Select value={project.projectType} options={opts(projectTypeLabel)} onChange={(v) => v && set('projectType', v as any, 'Projektart')} /></Field>
          <Field label="Gebäudeart"><Select value={project.buildingType} options={opts({ efh: 'Einfamilienhaus', dhh: 'Doppelhaushälfte', rh: 'Reihenhaus', mfh: 'Mehrfamilienhaus', einliegerwohnung: 'Einliegerwohnung', sonstiges: 'Sonstiges' })} onChange={(v) => v && set('buildingType', v as any, 'Gebäudeart')} /></Field>
          <Field label="Bundesland" hint="für Rauchwarnmelder-Pflicht (LBO)"><Select value={project.bundesland} allowEmpty="–" options={opts({ BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' })} onChange={(v) => set('bundesland', v as any, 'Bundesland')} /></Field>
          <Field label="Adresse"><TextInput value={project.address} onChange={(v) => set('address', v, 'Adresse')} /></Field>
          <Field label="Ausstattungswert (DIN 18015-2 / RAL-RG 678)"><Select value={String(project.equipmentLevel)} options={[{ value: '1', label: '1 – Mindestausstattung' }, { value: '2', label: '2 – Standard' }, { value: '3', label: '3 – Komfort' }]} onChange={(v) => set('equipmentLevel', Number(v) as any, 'Ausstattungswert')} /></Field>
        </div>
        <Field label="Beschreibung"><TextInput wide value={project.description} onChange={(v) => set('description', v, 'Beschreibung')} /></Field>
        <Field label="Bleibt unverändert (eine Angabe pro Zeile)" hint="z. B. Heizung, Wallbox, Treppenhaus">
          <textarea defaultValue={project.keepAsIs.join('\n')} onBlur={(e) => set('keepAsIs', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean), 'Bestand bleibt')} rows={3} />
        </Field>
      </Section>

      <Section title="Höhen und Dosen">
        <div className="grid3">
          <Field label="Höhenbezug (Bezeichnung)"><TextInput value={project.settings.heightReference.label} onChange={(v) => up('Höhenbezug', (p) => { p.settings.heightReference.label = v; })} /></Field>
          <Field label="Beschreibung Höhenbezug"><TextInput value={project.settings.heightReference.description} onChange={(v) => up('Höhenbezug', (p) => { p.settings.heightReference.description = v; })} /></Field>
          <Field label="Mehrfachdosen: Position bezieht sich auf"><Select value={project.settings.boxConvention} options={opts({ erste_an_position: 'erste Dose (unter dem Schalter), weitere weg von der Tür', mittig: 'Mitte der Kombination' })} onChange={(v) => v && up('Konvention Mehrfachdosen', (p) => { p.settings.boxConvention = v as any; })} /></Field>
        </div>
        <p className="muted small">Standardhöhen = Dosenmitte über Fertigfußboden. Der Bodenaufbau je Raum wird automatisch addiert. Je Raum änderbar.</p>
        <div className="grid3">
          {([['steckdose', 'Steckdose'], ['schalter', 'Schalter'], ['kuecheArbeitsflaeche', 'Küche über Arbeitsfläche'], ['nachttisch', 'Nachttisch'], ['aufputzKeller', 'Aufputz Keller/Garage'], ['lan', 'LAN']] as const).map(([k, l]) => (
            <Field key={k} label={`${l} (cm ü. FFB)`}><NumberInput value={project.settings.defaultHeights[k]} onChange={(v) => v != null && up(`Standardhöhe ${l}`, (p) => { p.settings.defaultHeights[k] = v; })} /></Field>
          ))}
        </div>
      </Section>

      <Section title="Schalterprogramm">
        <datalist id="switchprograms">{SWITCH_PROGRAMS.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="grid2">
          <Field label="Hersteller"><TextInput value={sp.manufacturer} list="switchprograms" onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.manufacturer = v; })} /></Field>
          <Field label="Serie"><TextInput value={sp.series} onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.series = v; })} /></Field>
          <Field label="Farbe"><TextInput value={sp.color} onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.color = v; })} /></Field>
          <Field label="Feuchtraum-/Aufputzprogramm"><TextInput value={sp.wetRoomSeries} onChange={(v) => up('Feuchtraumprogramm', (p) => { p.settings.switchProgram.wetRoomSeries = v; })} /></Field>
        </div>
      </Section>

      <Section title="Smart Home">
        <Check checked={sh.enabled} onChange={(v) => up('Smart Home ein/aus', (p) => { p.smartHome.enabled = v; if (v && p.smartHome.system === 'keines') p.smartHome.system = 'home_assistant'; })} label={<b>Smart-Home-Funktionen einbinden</b>} />
        {sh.enabled && (
          <>
            <div className="grid2">
              <Field label="System (Projektvorgabe, je Raum änderbar)"><Select value={sh.system} options={opts(smartHomeLabel).filter((o) => o.value !== 'keines')} onChange={(v) => v && up('Smart-Home-System', (p) => { p.smartHome.system = v as any; p.smartHome.busCableToSwitches = v === 'knx'; })} /></Field>
              <Field label="Zentrale / Server"><TextInput value={sh.central} placeholder="z. B. Home Assistant auf Mini-PC im Netzwerkschrank" onChange={(v) => up('Smart-Home-Zentrale', (p) => { p.smartHome.central = v; })} /></Field>
            </div>
            <div className="checks">
              <Check checked={sh.neutralInSwitchBoxes} onChange={(v) => up('Smart Home: N in Schalterdose', (p) => { p.smartHome.neutralInSwitchBoxes = v; })} label="Neutralleiter in jede Schalterdose" />
              <Check checked={sh.deepBoxesForActuators} onChange={(v) => up('Smart Home: tiefe Dosen', (p) => { p.smartHome.deepBoxesForActuators = v; })} label="tiefe Dosen für UP-Aktoren" />
              <Check checked={sh.busCableToSwitches} onChange={(v) => up('Smart Home: Busleitung', (p) => { p.smartHome.busCableToSwitches = v; })} label="Busleitung zu den Schaltstellen" />
              <Check checked={sh.dimInLuminaire} onChange={(v) => up('Smart Home: Dimmen in Leuchte', (p) => { p.smartHome.dimInLuminaire = v; })} label="Dimmen in der Leuchte (Dauerstrom statt Wanddimmer)" />
            </div>
            <div className="impact">
              <b>Was das für die Planung bedeutet ({smartHomeLabel[sh.system]}):</b>
              <ul>{SMART_HOME_IMPACT[sh.system].map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
            <Field label="Notizen"><TextInput wide value={sh.notes} onChange={(v) => up('Smart-Home-Notizen', (p) => { p.smartHome.notes = v; })} /></Field>
          </>
        )}
        {!sh.enabled && <p className="muted small">{SMART_HOME_IMPACT.keines[0]}</p>}
      </Section>

      <Section title="Netzwerk" open={false}>
        <div className="grid3">
          <Field label="Standort Netzwerkschrank"><TextInput value={project.network.rackLocation} onChange={(v) => up('Netzwerkschrank', (p) => { p.network.rackLocation = v; })} /></Field>
          <Field label="Access Points (PoE)"><NumberInput step={1} value={project.network.poeAccessPoints} onChange={(v) => v != null && up('Access Points', (p) => { p.network.poeAccessPoints = Math.round(v); })} /></Field>
          <Field label="Notiz"><TextInput value={project.network.note} onChange={(v) => up('Netzwerk', (p) => { p.network.note = v; })} /></Field>
        </div>
      </Section>

      <Section title={`Geschosse und Räume (${project.rooms.length})`}>
        <EditTable rows={project.floors} rowKey={(r) => r.id}
          cols={[{ key: 'name', label: 'Geschoss', type: 'text' }, { key: 'level', label: 'Ebene', type: 'number' }]}
          onChange={(i, k, v) => up('Geschoss', (p) => { (p.floors[i] as any)[k] = v; })}
          onRemove={project.floors.length > 1 ? (i) => up('Geschoss entfernt', (p) => { const id = p.floors[i].id; if (p.rooms.some((r) => r.floorId === id)) { alert('Geschoss enthält noch Räume.'); return; } p.floors.splice(i, 1); }) : undefined}
          onAdd={() => up('Geschoss ergänzt', (p) => { p.floors.push({ id: newId('geschoss'), name: 'Neues Geschoss', level: p.floors.length }); })} addLabel="Geschoss" />
        <EditTable rows={project.rooms.map((r) => ({ ...r, area: fmt(roomArea(r), 2) }))} rowKey={(r) => r.id}
          onSelect={(r) => store.setUi({ view: 'raum', roomId: r.id })}
          cols={[
            { key: 'name', label: 'Neue Bezeichnung', type: 'text' },
            { key: 'formerName', label: 'Bestandsplan', type: 'text' },
            { key: 'floorId', label: 'Geschoss', type: 'select', options: project.floors.map((f) => ({ value: f.id, label: f.name })) },
            { key: 'area', label: 'm²', type: 'readonly' },
            { key: 'inScope', label: 'geplant', type: 'check' },
            { key: 'confirmed', label: 'bestätigt', type: 'check' },
          ] as Col<any>[]}
          onChange={(i, k, v) => up(`Raum ${k}`, (p) => { (p.rooms[i] as any)[k] = v; })}
          onRemove={(i) => up(`Raum ${project.rooms[i].name} entfernt`, (p) => { p.rooms.splice(i, 1); })}
          onAdd={() => {
            const room = createRectRoom({ id: newId('raum'), floorId: project.floors[0].id, name: `Raum ${project.rooms.length + 1}`, width: 400, depth: 300, height: 250 });
            up('Raum ergänzt', (p) => { p.rooms.push(room as any); });
            store.setUi({ view: 'raum', roomId: room.id });
          }} addLabel="Raum" />
        {project.floors.map((f) => (
          <div key={f.id}>
            <h4>{f.name}</h4>
            <div className="canvas overview" onClick={(e) => { const id = (e.target as Element).closest('[data-room]')?.getAttribute('data-room'); if (id) store.setUi({ view: 'raum', roomId: id }); }} dangerouslySetInnerHTML={{ __html: renderFloorOverview(project, f.id, { screen: true }) }} />
          </div>
        ))}
      </Section>

      <Section title="Norm- und Praxiswerte" open={false}>
        <p className="muted small">Werte mit ⚠ sind aus allgemein zugänglichen Darstellungen der Normen übernommen und vom Elektriker zu bestätigen. Ein abweichender Wert gilt für dieses Projekt.</p>
        <EditTable rows={NORM_VALUES.map((v) => ({ ...v, override: project.settings.normOverrides[v.key] ?? null }))} rowKey={(r) => r.key}
          cols={[
            { key: 'label', label: 'Bedeutung', type: 'readonly' },
            { key: 'value', label: 'Standard', type: 'readonly', render: (r: any) => <span>{fmt(r.value)} {r.unit}</span> },
            { key: 'override', label: 'Projektwert', type: 'nullnumber' },
            { key: 'source', label: 'Quelle', type: 'readonly', render: (r: any) => <span className="small">{r.source}{r.confirm ? ' ⚠' : ''}</span> },
          ] as Col<any>[]}
          onChange={(i, _k, v) => up(`Normwert ${NORM_VALUES[i].key}`, (p) => { if (v == null) delete p.settings.normOverrides[NORM_VALUES[i].key]; else p.settings.normOverrides[NORM_VALUES[i].key] = v; })} />
      </Section>
    </div>
  );
}
