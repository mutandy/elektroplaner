import { useMemo, useState } from 'react';
import type { Project } from '../../core/model/schema';
import { computeLengths } from '../../core/planning/circuits';
import { computeMaterial, euro } from '../../core/planning/bom';
import { estimateCosts } from '../../core/planning/costs';
import { buildTasks, PHASES } from '../../core/planning/tasks';
import { GROUP_ORDER } from '../../core/planning/prices';
import { materialCsv, materialXlsx } from '../../core/export/material';
import { newId } from '../../core/model/factory';
import { fmt } from '../../core/geometry/room';
import { store, downloadFile } from '../store';
import { Field, NumberInput, Section, Select, TextInput } from '../components/ui';

type Tab = 'material' | 'kosten' | 'aufgaben';

function fileBase(p: Project) {
  return p.name.replace(/[^\wäöüÄÖÜß -]/g, '').trim() || 'projekt';
}

export function MaterialView({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('material');
  const lengths = useMemo(() => computeLengths(project), [project]);
  const list = useMemo(() => computeMaterial(project, lengths), [project, lengths]);
  const costs = useMemo(() => estimateCosts(project, lengths, list), [project, lengths, list]);
  const tasks = useMemo(() => buildTasks(project, lengths.routes), [project, lengths]);
  const [busy, setBusy] = useState(false);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const buf = await materialXlsx(project, list, costs, tasks);
      downloadFile(`${fileBase(project)} - Material, Kosten, Aufgaben.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } finally { setBusy(false); }
  };

  return (
    <div className="page-view">
      <div className="inline">
        <div className="tabs">
          <button className={tab === 'material' ? 'active' : ''} onClick={() => setTab('material')}>Material- und Bestellliste</button>
          <button className={tab === 'kosten' ? 'active' : ''} onClick={() => setTab('kosten')}>Kostenschätzung</button>
          <button className={tab === 'aufgaben' ? 'active' : ''} onClick={() => setTab('aufgaben')}>Aufgaben- und Prüfliste</button>
        </div>
        <span className="spacer" />
        <button onClick={() => downloadFile(`${fileBase(project)} - Materialliste.csv`, materialCsv(list), 'text/csv;charset=utf-8')}>CSV</button>
        <button disabled={busy} onClick={exportXlsx}>{busy ? 'Erzeuge …' : 'Excel (XLSX)'}</button>
        <button onClick={() => store.setUi({ view: 'ausgaben' })}>PDF über „Ausgaben“</button>
      </div>
      {tab === 'material' && <MaterialTab project={project} list={list} />}
      {tab === 'kosten' && <CostTab project={project} costs={costs} />}
      {tab === 'aufgaben' && <TaskTab tasks={tasks} />}
    </div>
  );
}

function MaterialTab({ project, list }: { project: Project; list: ReturnType<typeof computeMaterial> }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const m = project.material;
  const setQty = (id: string, v: number | null) => store.update(`Material: Menge ${id}`, (p) => { if (v == null) delete p.material.qtyOverrides[id]; else p.material.qtyOverrides[id] = v; });
  const setPrice = (id: string, v: number | null) => store.update(`Material: Preis ${id}`, (p) => { if (v == null) delete p.material.priceOverrides[id]; else p.material.priceOverrides[id] = v; });
  const toggle = (id: string, v: boolean) => store.update(`Material ${v ? 'abgehakt' : 'offen'}: ${id}`, (p) => { if (v) p.material.checked[id] = true; else delete p.material.checked[id]; });
  return (
    <>
      <div className="inline">
        <b>Summe: {euro(list.total)}</b><span className="muted">· noch offen: {euro(list.openTotal)}</span>
        <span className="spacer" />
        <label className="check small"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />nur offene Positionen</label>
      </div>
      {list.groups.map((g) => {
        const lines = g.lines.filter((l) => !onlyOpen || !l.checked);
        if (!lines.length) return null;
        return (
          <Section key={g.group} title={g.group} right={<span className="muted small">{euro(g.total)}</span>}>
            <div className="tablewrap">
              <table className="edit">
                <thead><tr><th>✓</th><th>Position</th><th>Bedarf</th><th>Bestellung</th><th>Menge</th><th>Einzelpreis €</th><th>Summe</th>{g.group === 'Eigene Positionen' && <th />}</tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className={l.checked ? 'done' : undefined}>
                      <td><input type="checkbox" checked={l.checked} onChange={(e) => toggle(l.id, e.target.checked)} /></td>
                      <td>{l.label}{l.note && <div className="muted small">{l.note}</div>}</td>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmt(l.need)} {l.unit}</td>
                      <td className="small">{l.orderText}</td>
                      <td>{l.source === 'manuell'
                        ? <NumberInput value={l.order} onChange={(v) => v != null && store.update('Eigene Position Menge', (p) => { const e = p.material.extras.find((x) => x.id === l.id); if (e) e.qty = v; })} />
                        : <NumberInput value={m.qtyOverrides[l.id] ?? null} nullable placeholder={fmt(l.order)} onChange={(v) => setQty(l.id, v)} />}</td>
                      <td>{l.source === 'manuell'
                        ? <NumberInput value={l.unitPrice} onChange={(v) => v != null && store.update('Eigene Position Preis', (p) => { const e = p.material.extras.find((x) => x.id === l.id); if (e) e.price = v; })} />
                        : <NumberInput value={m.priceOverrides[l.id] ?? null} nullable placeholder={fmt(l.unitPrice, 2)} onChange={(v) => setPrice(l.id, v)} />}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{euro(l.total)}</td>
                      {g.group === 'Eigene Positionen' && <td><button className="icon danger" onClick={() => store.update('Eigene Position entfernt', (p) => { p.material.extras = p.material.extras.filter((x) => x.id !== l.id); })}>✕</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
      <Section title="Eigene Position hinzufügen" open={false}><ExtraForm /></Section>
      <p className="muted small">Mengen werden aus Plan, Leitungswegen und Leitungslängen berechnet (inkl. Reserven) und auf Gebinde aufgerundet. Leeres Mengen-/Preisfeld = berechneter Wert; eine Eingabe überschreibt ihn. Preise sind Richtwerte ohne Gewähr.</p>
    </>
  );
}

function ExtraForm() {
  const [label, setLabel] = useState('');
  const [group, setGroup] = useState<string>('Eigene Positionen');
  const [qty, setQty] = useState<number | null>(1);
  const [price, setPrice] = useState<number | null>(0);
  const [unit, setUnit] = useState('Stk');
  return (
    <div className="grid3">
      <Field label="Bezeichnung"><TextInput value={label} onChange={setLabel} /></Field>
      <Field label="Gruppe"><Select value={group} options={GROUP_ORDER.map((g) => ({ value: g, label: g }))} onChange={(v) => v && setGroup(v)} /></Field>
      <Field label="Einheit"><TextInput value={unit} onChange={setUnit} /></Field>
      <Field label="Menge"><NumberInput value={qty} onChange={setQty} /></Field>
      <Field label="Einzelpreis €"><NumberInput value={price} onChange={setPrice} /></Field>
      <Field label=" "><button disabled={!label.trim()} onClick={() => { store.update(`Eigene Position: ${label}`, (p) => { p.material.extras.push({ id: newId('pos'), group, label, unit, qty: qty ?? 1, price: price ?? 0, note: '' }); }); setLabel(''); }}>＋ Hinzufügen</button></Field>
    </div>
  );
}

function CostTab({ project, costs }: { project: Project; costs: ReturnType<typeof estimateCosts> }) {
  const c = project.costs;
  const set = (k: keyof Project['costs'], v: any) => store.update(`Kosten: ${String(k)}`, (p) => { (p.costs as any)[k] = v; });
  return (
    <>
      <Section title="Annahmen">
        <div className="cards" style={{ marginBottom: 8 }}>
          <button className={`card ${c.mode === 'eigenleistung' ? 'active' : ''}`} onClick={() => set('mode', 'eigenleistung')}><b>Vorarbeiten in Eigenleistung</b><span>Schlitzen, Dosen setzen, Kabel einziehen, Schließen selbst; Fachkraft schließt an und prüft</span></button>
          <button className={`card ${c.mode === 'handwerker' ? 'active' : ''}`} onClick={() => set('mode', 'handwerker')}><b>Alles durch Handwerker</b><span>Vorarbeiten werden mit Stundensätzen bewertet</span></button>
        </div>
        <div className="grid3">
          <Field label="Handwerker €/h von"><NumberInput value={c.rateHelperMin} onChange={(v) => v != null && set('rateHelperMin', v)} /></Field>
          <Field label="bis"><NumberInput value={c.rateHelperMax} onChange={(v) => v != null && set('rateHelperMax', v)} /></Field>
          <span />
          <Field label="Elektrofachkraft €/h von"><NumberInput value={c.rateElectricianMin} onChange={(v) => v != null && set('rateElectricianMin', v)} /></Field>
          <Field label="bis"><NumberInput value={c.rateElectricianMax} onChange={(v) => v != null && set('rateElectricianMax', v)} /></Field>
          <span />
          <Field label="Unvorhergesehenes % von"><NumberInput value={c.contingencyMin} onChange={(v) => v != null && set('contingencyMin', v)} /></Field>
          <Field label="bis"><NumberInput value={c.contingencyMax} onChange={(v) => v != null && set('contingencyMax', v)} /></Field>
        </div>
      </Section>
      <Section title={`Kosten: ${euro(costs.min)} – ${euro(costs.max)} (Richtwert)`}>
        <table className="findings">
          <thead><tr><th>Gewerk</th><th>Umfang</th><th>Wer</th><th className="num">Stunden</th><th className="num">von</th><th className="num">bis</th></tr></thead>
          <tbody>
            {costs.rows.map((r) => <tr key={r.id}><td><b>{r.title}</b></td><td className="small">{r.detail}</td><td>{r.who}</td><td>{r.hours ? fmt(r.hours) : '–'}</td><td>{euro(r.min)}</td><td>{euro(r.max)}</td></tr>)}
            <tr><td colSpan={4}><b>Summe</b></td><td><b>{euro(costs.min)}</b></td><td><b>{euro(costs.max)}</b></td></tr>
          </tbody>
        </table>
        <p>Eigene Arbeitszeit ca. <b>{fmt(costs.hoursOwn)} h</b> · Fachkraft/Handwerker ca. <b>{fmt(costs.hoursPro)} h</b></p>
        <p className="muted small">Grobe Schätzung mit Spanne aus Erfahrungswerten (Schlitzmeter nach Wandmaterial, Dosen, Kabelmeter, Verteilerarbeiten, Erstprüfung). Ersetzt kein Angebot. Anschluss, Prüfung und Abnahme sind immer Sache der Elektrofachkraft.</p>
      </Section>
    </>
  );
}

function TaskTab({ tasks }: { tasks: ReturnType<typeof buildTasks> }) {
  const done = tasks.filter((t) => t.done).length;
  return (
    <>
      <div className="inline"><b>{done} von {tasks.length} erledigt</b><span className="muted small">· ⛔ = Haltepunkt: erst erledigen, dann weiter</span></div>
      {PHASES.map((ph) => {
        const ts = tasks.filter((t) => t.phase === ph);
        if (!ts.length) return null;
        const d = ts.filter((t) => t.done).length;
        return (
          <Section key={ph} title={ph} right={<span className="muted small">{d}/{ts.length}</span>} open={d < ts.length}>
            <ul className="tasklist">
              {ts.map((t) => (
                <li key={t.id} className={t.done ? 'done' : undefined}>
                  <label className="check"><input type="checkbox" checked={t.done} onChange={(e) => store.update(`Aufgabe ${e.target.checked ? 'erledigt' : 'offen'}`, (p) => { p.tasks[t.id] = { done: e.target.checked, note: p.tasks[t.id]?.note ?? '' }; })} />
                    <span>{t.hold ? '⛔ ' : ''}{t.text}</span></label>
                  <span className={`who who-${t.who === 'Elektrofachkraft' ? 'pro' : t.who === 'Fachbetrieb' ? 'fb' : 'own'}`}>{t.who}</span>
                  <TextInput value={t.note} placeholder="Notiz / Datum" onChange={(v) => store.update('Aufgabe Notiz', (p) => { p.tasks[t.id] = { done: p.tasks[t.id]?.done ?? false, note: v }; })} />
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
