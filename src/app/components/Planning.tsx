/** Planungs-Bausteine der Oberfläche: Vorschläge, Leitungswege, Stromkreisvorschlag. */
import { useMemo, useState } from 'react';
import type { Project, Room } from '../../core/model/schema';
import { suggestOutlets, nextOutletLabel, type Suggestion } from '../../core/planning/suggest';
import { computeRoomRoutes, routeTotals, resolveStrategy, defaultEntry } from '../../core/planning/routes';
import { computeLengths, proposeCircuits, applyCircuitProposal, describeDrop } from '../../core/planning/circuits';
import { outletKindLabel, boxTypeLabel } from '../../core/model/labels';
import { fmt, wallName, zToFfb, wallGeoms } from '../../core/geometry/room';
import { store } from '../store';
import { Field, NumberInput, Select, opts } from './ui';

function acceptSuggestions(room: Room, list: Suggestion[]) {
  store.update(`${room.name}: ${list.length} Vorschlag/Vorschläge übernommen`, (p) => {
    const r = p.rooms.find((x) => x.id === room.id)!;
    const taken: string[] = [];
    for (const sg of list) {
      const label = nextOutletLabel(r as Room, taken);
      taken.push(label);
      r.outlets.push({ ...sg.outlet, label, note: sg.outlet.note || sg.reason.split(':')[0] } as any);
      r.dismissedSuggestions = r.dismissedSuggestions.filter((k) => k !== sg.key);
    }
  });
}

export function SuggestionsPanel({ project, room }: { project: Project; room: Room }) {
  const list = useMemo(() => suggestOutlets(project, room), [project, room]);
  if (!list.length) return <p className="muted small">Keine weiteren Vorschläge für diesen Raum.{room.dismissedSuggestions.length ? <> <button className="linklike" onClick={() => store.update(`${room.name}: abgelehnte Vorschläge zurückgeholt`, (p) => { p.rooms.find((r) => r.id === room.id)!.dismissedSuggestions = []; })}>Abgelehnte ({room.dismissedSuggestions.length}) wieder anzeigen</button></> : null}</p>;
  return (
    <div>
      <div className="inline"><b>{list.length} Vorschläge</b><span className="spacer" /><button className="primary" onClick={() => acceptSuggestions(room, list)}>Alle übernehmen</button></div>
      <table className="findings">
        <thead><tr><th>Was</th><th>Wo</th><th>Warum</th><th /></tr></thead>
        <tbody>
          {list.map((sg) => {
            const o = sg.outlet;
            return (
              <tr key={sg.key}>
                <td>{outletKindLabel[o.kind]}{o.gangs > 1 ? ` ${o.gangs}-fach` : ''}<div className="muted small">{boxTypeLabel[o.boxType]}</div></td>
                <td className="small">{o.mount === 'wand' ? `${wallName(room, o.wallIndex!)}, ${fmt(o.s)} cm, Höhe ${fmt(zToFfb(room, o.z!))} ü. FFB` : `Decke x ${fmt(o.x)} / y ${fmt(o.y)}`}</td>
                <td className="small">{sg.reason}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" onClick={() => acceptSuggestions(room, [sg])}>Übernehmen</button>{' '}
                  <button className="small" onClick={() => store.update(`${room.name}: Vorschlag abgelehnt`, (p) => { p.rooms.find((r) => r.id === room.id)!.dismissedSuggestions.push(sg.key); })}>Ablehnen</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Übernommene Auslässe lassen sich danach in Draufsicht und Abwicklung verschieben. Vorschläge beachten Türen, Türblatt, Fenster, Vorwände und Tabuzonen; Mengen nach Ausstattungswert {project.equipmentLevel}.</p>
    </div>
  );
}

export function RoutingPanel({ project, room }: { project: Project; room: Room }) {
  const rr = useMemo(() => computeRoomRoutes(project, room), [project, room]);
  const t = routeTotals(rr);
  const auto = resolveStrategy({ ...room, routing: { ...room.routing, strategy: 'auto' } });
  const entry = defaultEntry(room);
  const set = (text: string, fn: (r: Room['routing']) => void) => store.update(`${room.name}: ${text}`, (p) => fn(p.rooms.find((x) => x.id === room.id)!.routing as any));
  return (
    <div>
      <div className="grid3">
        <Field label="Leitungsweg" hint={room.routing.strategy === 'auto' ? `automatisch: ${auto.reason}` : undefined}>
          <Select value={room.routing.strategy} options={opts({ auto: `automatisch (${auto.strategy})`, boden: 'Bodenschlitz vor der Wand', decke: 'über Decke / Deckenhohlraum', wand_waagerecht: 'waagerechte Wandschlitze oben', aufputz: 'Aufputz unter der Decke' })} onChange={(v) => v && set('Leitungsweg', (r) => { r.strategy = v as any; })} />
        </Field>
        <Field label="Bodentrasse: Abstand vor der Wand (cm)"><NumberInput value={room.routing.floorOffset} onChange={(v) => v && set('Abstand Bodentrasse', (r) => { r.floorOffset = v; })} /></Field>
        <Field label="Aufputz: Abstand unter der Decke (cm)"><NumberInput value={room.routing.surfaceBelowCeiling} onChange={(v) => v && set('Abstand Aufputz', (r) => { r.surfaceBelowCeiling = v; })} /></Field>
        <Field label="Leitungen kommen herein an Wand"><Select value={String(entry.wallIndex)} options={wallGeoms(room).map((w) => ({ value: String(w.index), label: wallName(room, w.index) }))} onChange={(v) => set('Einspeisung', (r) => { r.entry = { wallIndex: Number(v), s: entry.s }; })} /></Field>
        <Field label="… bei (cm ab linker Ecke)" hint={room.routing.entry ? undefined : 'Standard: neben der Haupttür, Griffseite'}><NumberInput value={entry.s} onChange={(v) => v != null && set('Einspeisung', (r) => { r.entry = { wallIndex: entry.wallIndex, s: v }; })} /></Field>
        <Field label=" ">{room.routing.entry && <button onClick={() => set('Einspeisung zurückgesetzt', (r) => { r.entry = undefined; })}>Einspeisung zurücksetzen</button>}</Field>
      </div>
      <p className="small">{fmt(t.floorSlotM, 2)} m Bodenschlitz · {fmt(t.wallSlotM, 2)} m Wandschlitz{t.surfaceM ? ` · ${fmt(t.surfaceM, 1)} m Aufputz` : ''} · {t.drillUP} UP-Bohrungen · {t.drillHollow} Hohlwand · {t.surfaceBoxes} Aufputz · {t.penetrations} Durchbruch</p>
      {rr.issues.length > 0 && <ul className="small">{rr.issues.map((i, k) => <li key={k} className={`sev-${i.severity}`}>{i.message}</li>)}</ul>}
      <p className="muted small">Ebene „Leitungswege“ in Draufsicht und Abwicklung zeigt Schlitze, Stiche und Durchbrüche. Alle Leitungen eines Raums liegen auf einer gemeinsamen Trasse nebeneinander – kreuzungsfrei und einlagig.</p>
    </div>
  );
}

export function CircuitProposalPanel({ project }: { project: Project }) {
  const [mode, setMode] = useState<'offen' | 'alle'>(project.circuits.length ? 'offen' : 'alle');
  const prop = useMemo(() => proposeCircuits(project, mode), [project, mode]);
  const open = Object.keys(prop.assignment).length;
  const lengths = useMemo(() => computeLengths(project), [project]);
  return (
    <div>
      <div className="inline">
        <Select value={mode} options={opts({ offen: 'nur Auslässe ohne Stromkreis', alle: 'alles neu vorschlagen (ersetzt Zuordnung)' })} onChange={(v) => v && setMode(v as any)} />
        <span className="muted small">{open} Auslässe werden zugeordnet, {prop.circuits.length - (mode === 'offen' ? project.circuits.length : 0)} neue Stromkreise.</span>
        <span className="spacer" />
        <button className="primary" disabled={!open} onClick={() => { if (mode === 'offen' || confirm('Alle Stromkreise neu vorschlagen? Eigene Zuordnungen gehen verloren (Rückgängig möglich).')) { store.update(`Stromkreisvorschlag übernommen (${mode})`, (p) => applyCircuitProposal(p as Project, prop, mode)); setMode('offen'); } }}>Vorschlag übernehmen</button>
      </div>
      {prop.notes.length > 0 && <ul className="small">{prop.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <table className="findings">
        <thead><tr><th>SK</th><th>Bezeichnung</th><th>LS</th><th>Leitung</th><th>RCD</th><th>LS vorhanden?</th><th>Auslässe</th><th>Begründung</th></tr></thead>
        <tbody>
          {prop.circuits.filter((c) => mode === 'alle' || !project.circuits.includes(c)).map((c) => {
            const outs = project.rooms.flatMap((r) => r.outlets.filter((o) => prop.assignment[o.id] === c.id).map((o) => o.label));
            const rcd = project.distributions.flatMap((d) => d.rcds).find((r) => r.id === c.rcdId)?.label ?? prop.newRcds.find((r) => r.id === c.rcdId)?.label ?? '–';
            return <tr key={c.id}><td><b>{c.label}</b></td><td>{c.name}</td><td>{c.poles === 3 ? '3× ' : ''}{c.characteristic}{c.ratedCurrent}</td><td>{c.cable}</td><td className="small">{rcd}</td><td>{c.breakerGroupId ? 'ja' : 'neu'}</td><td className="small">{outs.join(', ')}</td><td className="small">{c.reason}</td></tr>;
          })}
        </tbody>
      </table>
      <h4>Aktuelle Stromkreise: Länge und Spannungsfall</h4>
      <table className="findings">
        <thead><tr><th>SK</th><th>Bezeichnung</th><th className="num">Leitung gesamt</th><th className="num">bis letzter Auslass</th><th className="num">ΔU</th></tr></thead>
        <tbody>{project.circuits.map((c) => { const x = lengths.circuits.find((k) => k.circuitId === c.id); return <tr key={c.id}><td><b>{c.label}</b></td><td>{c.name}</td><td>{x?.lengthM ? `${fmt(x.lengthM)} m` : '–'}</td><td>{x?.farthestM ? `${fmt(x.farthestM)} m` : '–'}</td><td className={x?.ok === false ? 'sev-warnung' : ''}>{describeDrop(x)}</td></tr>; })}</tbody>
      </table>
      <p className="muted small">Gruppierung nach DIN 18015-2/Praxis: Großgeräte und Drehstrom eigener Kreis, Küche aufgeteilt, Bad und AV/Technik getrennt, Steckdosen je Raum (max. {fmt(8, 0)} Plätze), Licht getrennt (bis 3 Räume), max. 4 Kreise je RCD. Absicherung und Querschnitt legt die Elektrofachkraft fest.</p>
    </div>
  );
}

export { acceptSuggestions };
