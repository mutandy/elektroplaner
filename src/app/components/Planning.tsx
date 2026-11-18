/** Planungs-Bausteine der Oberfläche: Vorschläge, Leitungswege, Stromkreisvorschlag. */
import { useMemo, useState } from 'react';
import type { Project, Room } from '../../core/model/schema';
import { suggestOutlets, nextOutletLabel, type Suggestion } from '../../core/planning/suggest';
import { computeRoomRoutes, routeTotals, resolveStrategy, defaultEntry } from '../../core/planning/routes';
import { computeLengths, proposeCircuits, applyCircuitProposal, describeDrop } from '../../core/planning/circuits';
import { outletKindLabel, boxTypeLabel } from '../../core/model/labels';
import { fmt, wallName, zToFfb, wallGeoms } from '../../core/geometry/room';
import { store } from '../store';
import { Field, NumberInput, Select, opts, EditTable, type Col } from './ui';
import { ROOM_TYPES, ROOM_TYPE_INFO, type RoomTypeId } from '../../core/model/roomTypes';
import { loadsForType, roomPower, projectDemand, kw, circuitPower, circuitCapacity } from '../../core/planning/loads';
import { newId } from '../../core/model/factory';
import { routingFeasibility, routeOptionLabel, type Verdict, type RouteOption } from '../../core/planning/feasibility';

function acceptSuggestions(room: Room, list: Suggestion[]) {
  store.update(`${room.name}: ${list.length} Vorschlag/Vorschläge übernommen`, (p) => {
    const r = p.rooms.find((x) => x.id === room.id)!;
    const taken: string[] = [];
    for (const sg of list) {
      const label = nextOutletLabel(r as Room, taken);
      taken.push(label);
      r.outlets.push({ ...sg.outlet, label, note: sg.outlet.note || sg.reason.split(':')[0] } as any);
      if (sg.loadId) { const l = r.loads.find((x) => x.id === sg.loadId); if (l) l.outletId = sg.outlet.id; }
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
  const auto = resolveStrategy({ ...room, routing: { ...room.routing, strategy: 'auto' } }, project);
  const entry = defaultEntry(room);
  const set = (text: string, fn: (r: Room['routing']) => void) => store.update(`${room.name}: ${text}`, (p) => fn(p.rooms.find((x) => x.id === room.id)!.routing as any));
  return (
    <div>
      <FeasibilityPanel project={project} room={room} compact />
      <h4>Feineinstellung</h4>
      <div className="grid3">
        <Field label="Leitungsweg" hint={room.routing.strategy === 'auto' ? `automatisch: ${auto.reason}` : undefined}>
          <Select value={room.routing.strategy} options={opts({ auto: `automatisch (${auto.strategy})`, boden: 'Bodenschlitz vor der Wand', decke: 'über Decke / Deckenhohlraum', sockelleiste: 'Sockelleisten-Kabelkanal', wand_waagerecht: 'waagerechte Wandschlitze oben', aufputz: 'Aufputz unter der Decke' })} onChange={(v) => v && set('Leitungsweg', (r) => { r.strategy = v as any; })} />
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
      <h4>Leistungsbedarf</h4>
      <DemandSummary project={project} />
      <h4>Aktuelle Stromkreise: Last, Länge und Spannungsfall</h4>
      <table className="findings">
        <thead><tr><th>SK</th><th>Bezeichnung</th><th className="num">Verbraucher</th><th className="num">Leitung gesamt</th><th className="num">bis letzter Auslass</th><th className="num">ΔU</th></tr></thead>
        <tbody>{project.circuits.map((c) => { const x = lengths.circuits.find((k) => k.circuitId === c.id); const pw = circuitPower(project, c); return <tr key={c.id}><td><b>{c.label}</b></td><td>{c.name}</td><td className={pw > circuitCapacity(c) ? 'sev-warnung' : ''}>{pw ? kw(pw) : '–'}</td><td>{x?.lengthM ? `${fmt(x.lengthM)} m` : '–'}</td><td>{x?.farthestM ? `${fmt(x.farthestM)} m` : '–'}</td><td className={x?.ok === false ? 'sev-warnung' : ''}>{describeDrop(x)}</td></tr>; })}</tbody>
      </table>
      <p className="muted small">Gruppierung nach DIN 18015-2/Praxis: Großgeräte und Drehstrom eigener Kreis, Küche aufgeteilt, Bad und AV/Technik getrennt, Steckdosen je Raum (max. {fmt(8, 0)} Plätze), Licht getrennt (bis 3 Räume), max. 4 Kreise je RCD. Absicherung und Querschnitt legt die Elektrofachkraft fest.</p>
    </div>
  );
}

export { acceptSuggestions };

// ---------------------------------------------------------------------------
// Raumtyp und Verbraucher
// ---------------------------------------------------------------------------

/** Raumtyp setzen: Verbraucher, Feuchtraum, Installationsart werden passend vorbelegt. */
export function setRoomType(project: Project, room: Room, type: RoomTypeId) {
  const info = ROOM_TYPE_INFO[type];
  store.update(`${room.name}: Nutzung ${info.label}`, (p) => {
    const r = p.rooms.find((x) => x.id === room.id)!;
    const changed = r.roomType !== type;
    r.roomType = type;
    if (changed && (!r.loads.length || r.loads.every((l) => !l.outletId))) r.loads = loadsForType(type) as any;
    if (info.wetRoom) r.wetRoom = true;
    if (!r.outlets.length) r.installationType = info.installation ?? project.settings.defaultInstallationType;
    if (!r.usage.trim()) r.usage = info.label;
  });
}

export function RoomTypeCards({ project, room }: { project: Project; room: Room }) {
  return (
    <div className="cards">
      {ROOM_TYPES.map((t) => (
        <button key={t} className={`card ${room.roomType === t ? 'active' : ''}`} onClick={() => setRoomType(project, room, t)}>
          <b>{ROOM_TYPE_INFO[t].label}</b><span>{ROOM_TYPE_INFO[t].hint}</span>
        </button>
      ))}
    </div>
  );
}

export function LoadsEditor({ room }: { room: Room }) {
  const up = (text: string, fn: (r: Room) => void) => store.update(`${room.name}: ${text}`, (p) => fn(p.rooms.find((x) => x.id === room.id) as Room));
  const templates = room.roomType ? ROOM_TYPE_INFO[room.roomType].loads.filter((t) => !room.loads.some((l) => l.label === t.label)) : [];
  const outletOpts = room.outlets.map((o) => ({ value: o.id, label: `${o.label} ${outletKindLabel[o.kind]}${o.note ? ` – ${o.note.slice(0, 25)}` : ''}` }));
  return (
    <div>
      <EditTable rows={room.loads} rowKey={(r) => r.id} empty="Noch keine Verbraucher. Raumtyp wählen oder unten ergänzen."
        cols={[
          { key: 'label', label: 'Verbraucher', type: 'text' },
          { key: 'power', label: 'Leistung W', type: 'number' },
          { key: 'phases', label: 'Phasen', type: 'select', options: [{ value: '1', label: '230 V' }, { value: '3', label: '400 V (3~)' }] },
          { key: 'dedicated', label: 'eigener Kreis', type: 'check' },
          { key: 'connection', label: 'Anschluss', type: 'select', options: opts({ steckdose: 'Steckdose', anschlussdose: 'Geräteanschlussdose', herd: 'Herdanschluss', starkstrom: 'CEE/Drehstrom' }) },
          { key: 'outletId', label: 'an Auslass', type: 'select', allowEmpty: '– noch keiner –', options: outletOpts },
        ] as Col<any>[]}
        onChange={(i, k, v) => up(`Verbraucher ${k}`, (r) => { (r.loads[i] as any)[k] = k === 'phases' ? Number(v) : v; })}
        onRemove={(i) => up('Verbraucher entfernt', (r) => { r.loads.splice(i, 1); })}
        onAdd={() => up('Verbraucher ergänzt', (r) => { r.loads.push({ id: newId('last'), label: 'Gerät', power: 1000, phases: 1, dedicated: false, connection: 'steckdose' } as any); })} addLabel="eigener Verbraucher" />
      {templates.length > 0 && (
        <div className="inline">
          <span className="muted small">Typisch für {ROOM_TYPE_INFO[room.roomType!].label}:</span>
          {templates.map((t) => <button key={t.label} className="small" onClick={() => up(`${t.label} ergänzt`, (r) => { r.loads.push({ id: newId('last'), label: t.label, power: t.power, phases: t.phases, dedicated: t.dedicated, connection: t.connection, height: t.height } as any); })}>＋ {t.label} ({kw(t.power)})</button>)}
        </div>
      )}
      <p className="small">Summe im Raum: <b>{kw(roomPower(room))}</b>{room.loads.some((l) => l.dedicated) ? ` · eigene Stromkreise: ${room.loads.filter((l) => l.dedicated).map((l) => l.label.split(' (')[0]).join(', ')}` : ''}</p>
      <p className="muted small">Großverbraucher bekommen einen eigenen Stromkreis und einen Anschlussvorschlag (unter „Auslässe“). Leistungen sind Richtwerte – Typenschild/Datenblatt gilt.</p>
    </div>
  );
}

export function DemandSummary({ project }: { project: Project }) {
  const d = projectDemand(project);
  if (!d.installed) return <p className="muted small">Noch keine Verbraucher erfasst (je Raum unter „Nutzung“).</p>;
  return (
    <div className="small">
      <p>Installiert: <b>{kw(d.installed)}</b> · gleichzeitig geschätzt: <b>{kw(d.simultaneous)}</b>{d.mainFuse ? <> · Hauptsicherung {d.mainFuse.phases}× {d.mainFuse.amps} A ≈ {kw(d.mainFuse.watts)} → <b className={d.ratio! > 0.8 ? 'sev-warnung' : ''}>{fmt(d.ratio! * 100, 0)} %</b></> : ' · Hauptsicherung nicht erfasst'}</p>
      <p className="muted">Größte Verbraucher: {d.biggest.map((b) => `${b.label} (${b.room}, ${kw(b.power)})`).join(' · ')}</p>
      <p className="muted">Schätzung (größter Verbraucher voll, weitere anteilig) – die Bemessung nach DIN 18015-1 macht die Elektrofachkraft.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leitungswege: was ist möglich?
// ---------------------------------------------------------------------------

const verdictIcon: Record<Verdict, string> = { ja: '✔', bedingt: '?', nein: '✖' };
const optionStrategy: Record<RouteOption, Room['routing']['strategy']> = { boden: 'boden', decke: 'decke', decke_abhaengen: 'decke', sockelleiste: 'sockelleiste', wand_waagerecht: 'wand_waagerecht', aufputz: 'aufputz' };

export function FeasibilityPanel({ project, room, compact }: { project: Project; room: Room; compact?: boolean }) {
  const f = routingFeasibility(project, room);
  const o = room.routingOptions;
  const set = (text: string, fn: (r: Room) => void) => store.update(`${room.name}: ${text}`, (p) => fn(p.rooms.find((x) => x.id === room.id) as Room));
  const tri = (v: 'ja' | 'nein' | 'unbekannt', onChange: (v: 'ja' | 'nein' | 'unbekannt') => void) => (
    <span className="seg">{(['ja', 'nein', 'unbekannt'] as const).map((x) => <button key={x} className={v === x ? 'active' : ''} onClick={() => onChange(x)}>{x === 'unbekannt' ? 'weiß nicht' : x}</button>)}</span>
  );
  const chosen: string = room.routing.strategy === 'auto' ? 'auto' : room.routing.strategy === 'decke' && o.ceilingSuspend === 'ja' && !(room.ceiling.cavityDepth > 0 || room.ceiling.slotsAllowed) ? 'decke_abhaengen' : room.routing.strategy;
  return (
    <div className="feas">
      {!compact && <p className="muted small">Lichte Höhe heute (über künftigem Fertigfußboden): <b>{fmt(f.clearHeight)} cm</b> · Mindesthöhe {room.roomType ? 'für diesen Raum' : ''}: {fmt(f.minHeight)} cm (Landesbauordnung ⚠). Boden und Decke stammen aus den Schritten davor.</p>}
      <div className="qgrid">
        <span>Darf/soll die Decke abgehängt werden?</span>
        <span>{tri(o.ceilingSuspend, (v) => set('Decke abhängen', (r) => { r.routingOptions.ceilingSuspend = v; }))} <span className="muted small">Aufbau</span> <NumberInput width="4.5em" value={o.suspendDepth} onChange={(v) => v && set('Abhängehöhe', (r) => { r.routingOptions.suspendDepth = v; })} /> <span className="muted small">cm → lichte Höhe {fmt(f.clearHeight - o.suspendDepth)} cm</span></span>
        <span>Sind sichtbare Leitungen (Aufputz-Rohr/Kanal) in Ordnung?</span>
        <span>{tri(o.surfaceAccepted, (v) => set('Aufputz akzeptiert', (r) => { r.routingOptions.surfaceAccepted = v; }))}</span>
        <span>Ist ein Sockelleisten-Kabelkanal in Ordnung?</span>
        <span>{tri(o.skirtingAccepted, (v) => set('Sockelleistenkanal', (r) => { r.routingOptions.skirtingAccepted = v; }))}</span>
        <span>Dürfen Wände waagerecht geschlitzt werden? <span className="muted small">(Statik – meist nein)</span></span>
        <span className="checks">{room.walls.map((w) => <label key={w.index} className="check small"><input type="checkbox" checked={w.horizontalSlotsAllowed} onChange={(e) => set(`W${w.index + 1} waagerecht`, (r) => { r.walls[w.index].horizontalSlotsAllowed = e.target.checked; })} />W{w.index + 1}</label>)}</span>
      </div>
      <table className="findings">
        <thead><tr><th /><th>Leitungsweg</th><th>Bewertung</th><th>Wahl</th></tr></thead>
        <tbody>
          <tr className={chosen === 'auto' ? 'selected' : ''}><td /><td><b>Automatisch</b></td><td className="small">Empfehlung: {f.recommended ? `${routeOptionLabel[f.recommended.option]}${f.recommended.verdict === 'bedingt' ? ' (bedingt)' : ''}` : 'keiner möglich'}</td>
            <td><input type="radio" checked={chosen === 'auto'} onChange={() => set('Leitungsweg automatisch', (r) => { r.routing.strategy = 'auto'; })} /></td></tr>
          {f.options.map((x) => (
            <tr key={x.option} className={chosen === x.option ? 'selected' : ''}>
              <td className={`verdict v-${x.verdict}`}>{verdictIcon[x.verdict]}</td>
              <td><b>{routeOptionLabel[x.option]}</b></td>
              <td className="small">{x.reasons.join(' ')}</td>
              <td><input type="radio" disabled={x.verdict === 'nein'} checked={chosen === x.option} onChange={() => set(`Leitungsweg ${routeOptionLabel[x.option]}`, (r) => { r.routing.strategy = optionStrategy[x.option]; if (x.option === 'decke_abhaengen') r.routingOptions.ceilingSuspend = 'ja'; })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline">
        {!o.answered
          ? <button className="primary" onClick={() => set('Leitungswege bestätigt', (r) => { r.routingOptions.answered = true; })}>✔ So passt es</button>
          : <span className="ok small">✔ bestätigt</span>}
        <button className="small" onClick={() => store.update(`Leitungsweg-Antworten von ${room.name} auf das Geschoss übertragen`, (p) => { for (const r of p.rooms.filter((x) => x.floorId === room.floorId && x.id !== room.id && x.inScope)) r.routingOptions = { ...room.routingOptions, answered: false }; })}>Antworten für alle Räume im Geschoss übernehmen</button>
      </div>
    </div>
  );
}
