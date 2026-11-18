import { useMemo, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { Project } from '../../core/model/schema';
import { newId } from '../../core/model/factory';
import { runRules } from '../../core/rules/rules';
import { RULES } from '../../core/rules/rules';
import { buildDocument, documentLabel, type DocumentKind } from '../../core/docs/documents';
import { circuitTable } from '../../core/docs/tables';
import { store, downloadFile } from '../store';
import { EditTable, Field, Section, TextInput, opts, type Col } from '../components/ui';
import { FindingsList } from './RoomView';
import { CircuitProposalPanel } from '../components/Planning';

const up = (text: string, fn: (p: Draft<Project>) => void) => store.update(text, fn);

export function DistributionView({ project }: { project: Project }) {
  const distOpts = project.distributions.map((d) => ({ value: d.id, label: d.name }));
  const groupOpts = project.distributions.flatMap((d) => d.breakers.map((b) => ({ value: b.id, label: `${d.name}: ${b.characteristic}${b.ratedCurrent} (${b.free} frei)` })));
  const rcdOpts = project.distributions.flatMap((d) => d.rcds.map((r) => ({ value: r.id, label: `${d.name}: ${r.label}` })));
  const ct = circuitTable(project);
  return (
    <div className="page-view">
      <Section title="Verteilungen">
        <EditTable rows={project.distributions} rowKey={(r) => r.id}
          cols={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'kind', label: 'Art', type: 'select', options: opts({ HV: 'Hauptverteilung', UV: 'Unterverteilung', Zaehlerschrank: 'Zählerschrank' }) },
            { key: 'roomId', label: 'Raum', type: 'select', allowEmpty: '–', options: project.rooms.map((r) => ({ value: r.id, label: r.name })) },
            { key: 'feedFromId', label: 'versorgt aus', type: 'select', allowEmpty: '–', options: distOpts },
            { key: 'feedCable', label: 'Zuleitung', type: 'text' },
            { key: 'feedFuse', label: 'Absicherung Zuleitung', type: 'text' },
            { key: 'netForm', label: 'Netz', type: 'select', options: opts({ 'TN-C-S': 'TN-C-S', 'TN-S': 'TN-S', TT: 'TT', unbekannt: 'unbekannt' }) },
            { key: 'freeModules', label: 'freie TE', type: 'number' },
            { key: 'hasSpd', label: 'SPD', type: 'check' },
          ] as Col<any>[]}
          onChange={(i, k, v) => up(`Verteilung ${k}`, (p) => { (p.distributions[i] as any)[k] = v; })}
          onRemove={(i) => up('Verteilung entfernt', (p) => { p.distributions.splice(i, 1); })}
          onAdd={() => up('Verteilung ergänzt', (p) => { p.distributions.push({ id: newId('uv'), name: 'Neue UV', kind: 'UV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'unbekannt', meter: '', freeModules: 12, breakers: [], rcds: [], hasSpd: false, photos: [], note: '' }); })} addLabel="Verteilung" />
        {project.distributions.map((d, di) => (
          <div key={d.id} className="subblock">
            <h4>{d.name}: vorhandene/freie Leitungsschutzschalter</h4>
            <EditTable rows={d.breakers} rowKey={(r) => r.id}
              cols={[
                { key: 'characteristic', label: 'Char.', type: 'select', options: opts({ B: 'B', C: 'C', D: 'D' }) },
                { key: 'ratedCurrent', label: 'In (A)', type: 'number' },
                { key: 'poles', label: 'Pole', type: 'select', options: opts({ 1: '1', 3: '3' }) },
                { key: 'count', label: 'vorhanden', type: 'number' },
                { key: 'free', label: 'davon frei', type: 'number' },
                { key: 'note', label: 'Notiz', type: 'text' },
              ] as Col<any>[]}
              onChange={(i, k, v) => up(`${d.name}: LS ${k}`, (p) => { (p.distributions[di].breakers[i] as any)[k] = k === 'poles' ? Number(v) : v; })}
              onRemove={(i) => up(`${d.name}: LS entfernt`, (p) => { p.distributions[di].breakers.splice(i, 1); })}
              onAdd={() => up(`${d.name}: LS ergänzt`, (p) => { p.distributions[di].breakers.push({ id: newId('ls'), characteristic: 'B', ratedCurrent: 16, poles: 1, count: 1, free: 1, note: '' }); })} addLabel="LS-Gruppe" />
            <h4>{d.name}: Fehlerstrom-Schutzschalter</h4>
            <EditTable rows={d.rcds} rowKey={(r) => r.id}
              cols={[
                { key: 'label', label: 'Bezeichnung', type: 'text' },
                { key: 'ratedCurrent', label: 'In (A)', type: 'number' },
                { key: 'residualCurrent', label: 'IΔn (mA)', type: 'number' },
                { key: 'type', label: 'Typ', type: 'select', options: opts({ A: 'A', F: 'F', B: 'B', EV: 'EV' }) },
                { key: 'existing', label: 'vorhanden', type: 'check' },
              ] as Col<any>[]}
              onChange={(i, k, v) => up(`${d.name}: RCD ${k}`, (p) => { (p.distributions[di].rcds[i] as any)[k] = v; })}
              onRemove={(i) => up(`${d.name}: RCD entfernt`, (p) => { p.distributions[di].rcds.splice(i, 1); })}
              onAdd={() => up(`${d.name}: RCD ergänzt`, (p) => { p.distributions[di].rcds.push({ id: newId('fi'), label: 'FI 40 A / 30 mA Typ A', ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: false }); })} addLabel="RCD" />
          </div>
        ))}
      </Section>
      <Section title="Stromkreisvorschlag, Längen und Spannungsfall"><CircuitProposalPanel project={project} /></Section>
      <Section title={`Stromkreise (${project.circuits.length})`}>
        <EditTable rows={project.circuits} rowKey={(r) => r.id}
          cols={[
            { key: 'label', label: 'SK', type: 'text', width: '4em' },
            { key: 'name', label: 'Bezeichnung', type: 'text' },
            { key: 'distributionId', label: 'Verteilung', type: 'select', options: distOpts },
            { key: 'breakerGroupId', label: 'vorhandener LS', type: 'select', allowEmpty: 'neu', options: groupOpts },
            { key: 'characteristic', label: 'Char.', type: 'select', options: opts({ B: 'B', C: 'C', D: 'D' }) },
            { key: 'ratedCurrent', label: 'A', type: 'number' },
            { key: 'poles', label: 'Pole', type: 'select', options: opts({ 1: '1', 3: '3' }) },
            { key: 'rcdId', label: 'RCD', type: 'select', allowEmpty: '–', options: rcdOpts },
            { key: 'cable', label: 'Leitung', type: 'text' },
            { key: 'afdd', label: 'AFDD', type: 'check' },
            { key: 'reason', label: 'Begründung', type: 'text' },
          ] as Col<any>[]}
          onChange={(i, k, v) => up(`Stromkreis ${project.circuits[i].label}: ${k}`, (p) => { (p.circuits[i] as any)[k] = k === 'poles' ? Number(v) : v; })}
          onRemove={(i) => up(`Stromkreis ${project.circuits[i].label} entfernt`, (p) => { const id = p.circuits[i].id; p.circuits.splice(i, 1); p.rooms.forEach((r) => r.outlets.forEach((o) => { if (o.circuitId === id) o.circuitId = undefined; })); })}
          onAdd={() => up('Stromkreis ergänzt', (p) => { p.circuits.push({ id: newId('sk'), label: `F${p.circuits.length + 1}`, name: 'Neuer Stromkreis', distributionId: p.distributions[0]?.id ?? '', characteristic: 'B', ratedCurrent: 16, poles: 1, cable: 'NYM-J 3×2,5', afdd: false, reason: '', note: '' }); })} addLabel="Stromkreis" />
        <h4>Belegung</h4>
        <table className="findings">
          <thead><tr><th>SK</th><th>Bezeichnung</th><th>LS</th><th>RCD</th><th>Räume</th><th>Auslässe</th></tr></thead>
          <tbody>{ct.map((c) => <tr key={c.id}><td><b>{c.label}</b></td><td>{c.name}</td><td>{c.breaker} ({c.existingBreaker})</td><td>{c.rcd}</td><td>{c.rooms}</td><td className="small">{c.outlets}</td></tr>)}</tbody>
        </table>
      </Section>
    </div>
  );
}

export function RulesView({ project }: { project: Project }) {
  const report = useMemo(() => runRules(project), [project]);
  const [filter, setFilter] = useState<'alle' | 'fehler' | 'warnung' | 'hinweis'>('alle');
  const items = report.findings.filter((f) => filter === 'alle' || f.severity === filter);
  return (
    <div className="page-view">
      <Section title="Prüfprotokoll">
        <div className="inline">
          {(['alle', 'fehler', 'warnung', 'hinweis'] as const).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'alle' ? `Alle (${report.findings.length})` : `${f[0].toUpperCase() + f.slice(1)} (${report.counts[f]})`}
            </button>
          ))}
        </div>
        <FindingsList findings={items} project={project} />
      </Section>
      <Section title={`Regelbasis (${RULES.length} Regeln)`} open={false}>
        <table className="findings">
          <thead><tr><th>Regel</th><th>Beschreibung</th><th>Quelle</th><th>aktiv</th></tr></thead>
          <tbody>{RULES.map((r) => (
            <tr key={r.id}><td className="small">{r.id}</td><td>{r.title}</td><td className="small">{r.source}{r.confirm ? ' ⚠' : ''}</td>
              <td><input type="checkbox" checked={!project.settings.disabledRules[r.id]} onChange={(e) => {
                const reason = e.target.checked ? '' : prompt('Warum wird die Regel deaktiviert?') ?? '';
                if (!e.target.checked && !reason) return;
                up(`Regel ${r.id} ${e.target.checked ? 'aktiviert' : 'deaktiviert'}`, (p) => { if (e.target.checked) delete p.settings.disabledRules[r.id]; else p.settings.disabledRules[r.id] = reason; });
              }} /></td></tr>
          ))}</tbody>
        </table>
      </Section>
    </div>
  );
}

export function OutputView({ project }: { project: Project }) {
  const [kind, setKind] = useState<DocumentKind>('raumlayout');
  const html = useMemo(() => buildDocument(project, kind), [project, kind]);
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <div className="page-view output">
      <div className="inline">
        {(Object.keys(documentLabel) as DocumentKind[]).map((k) => <button key={k} className={k === kind ? 'active' : ''} onClick={() => setKind(k)}>{documentLabel[k]}</button>)}
        <span className="spacer" />
        <button className="primary" onClick={() => frame.current?.contentWindow?.print()}>Drucken / als PDF speichern</button>
        <button onClick={() => downloadFile(`${project.name} – ${documentLabel[kind]}.html`, html, 'text/html')}>HTML herunterladen</button>
      </div>
      <p className="muted small">Im Druckdialog „A4 quer“, Ränder „keine“ und „Hintergrundgrafiken“ wählen. Serverseitiges PDF: <code>npm run pdf -- projekt.json</code>. Material-/Bestellliste, Kostenschätzung und Aufgabenliste folgen in Etappe 3.</p>
      <iframe ref={frame} title="Druckvorschau" className="preview" srcDoc={html} />
    </div>
  );
}

export function VersionsView({ project }: { project: Project }) {
  const [name, setName] = useState(`Stand ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`);
  return (
    <div className="page-view">
      <Section title="Versionsstände">
        <div className="inline">
          <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
          <button className="primary" onClick={() => store.saveVersion(name)}>Aktuellen Stand sichern</button>
        </div>
        <EditTable rows={project.versions.map((v) => ({ ...v, date: new Date(v.at).toLocaleString('de-DE') }))} rowKey={(r) => r.at}
          cols={[{ key: 'name', label: 'Name', type: 'readonly' }, { key: 'date', label: 'gesichert', type: 'readonly' },
            { key: 'at', label: '', type: 'readonly', render: (r: any) => <button onClick={() => { if (confirm(`Stand „${r.name}“ wiederherstellen? Der aktuelle Stand bleibt über „Rückgängig“ erreichbar.`)) store.restoreVersion(project.versions.findIndex((v) => v.at === r.at)); }}>Wiederherstellen</button> }] as Col<any>[]}
          onChange={() => {}} onRemove={(i) => up('Versionsstand gelöscht', (p) => { p.versions.splice(i, 1); })} empty="Noch kein Versionsstand gesichert." />
      </Section>
      <Section title={`Änderungsprotokoll (${project.changeLog.length})`}>
        <ul className="log">{[...project.changeLog].reverse().slice(0, 300).map((c, i) => <li key={i}><span className="muted small">{new Date(c.at).toLocaleString('de-DE')}</span> {c.text}</li>)}</ul>
      </Section>
    </div>
  );
}
