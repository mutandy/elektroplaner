/**
 * Geführter Assistent: fängt bei Null an und sammelt Schritt für Schritt alle
 * Angaben, bevor das Programm Empfehlungen macht. Schreibt direkt in das
 * Projekt (eine Datenquelle); die Expertenansicht zeigt dieselben Daten.
 */
import { useState, type ReactNode } from 'react';
import type { Draft } from 'immer';
import type { Door, Project, Room } from '../../core/model/schema';
import { createRectRoom, newId } from '../../core/model/factory';
import { allSteps, missingFor, progress, roomSubstepLabel, wallSideLabel, type Step } from '../../core/wizard/steps';
import { notchRectCorner, cornerLabel, type RectCorner } from '../../core/geometry/edit';
import { fmt, futureBuildup, isRectRoom, roomArea, wallGeoms, wallName, bbox } from '../../core/geometry/room';
import { ceilingLabel, installationTypeLabel, projectTypeLabel, smartHomeLabel, wallMaterialLabel } from '../../core/model/labels';
import { SWITCH_PROGRAMS } from '../../core/model/catalog';
import { store } from '../store';
import { Check, EditTable, Field, NumberInput, Select, TextInput, opts, type Col } from '../components/ui';
import { RoomPlan } from '../components/PlanCanvas';
import { PlanTracer, loadImage, type TracerMode } from '../components/PlanTracer';
import { MeasureFlow } from './MeasureFlow';
import { SMART_HOME_IMPACT } from '../views/ProjectView';
import { EinrichtungTab, SummaryTab, upRoom } from '../views/RoomView';
import { runRules } from '../../core/rules/rules';
import { SuggestionsPanel, CircuitProposalPanel, RoutingPanel, acceptSuggestions, RoomTypeCards, LoadsEditor, DemandSummary, FeasibilityPanel, TheaterPanel } from '../components/Planning';
import { ROOM_TYPES, ROOM_TYPE_INFO, type RoomTypeId } from '../../core/model/roomTypes';
import { setRoomType } from '../components/Planning';
import { AiKeySettings, FloorPlanAi, DistributionPhotoAi, RoomTextAi, RoomPhotos } from '../ai/AiPanels';
import { suggestOutlets } from '../../core/planning/suggest';
import { computeAllRoutes, routeTotals } from '../../core/planning/routes';

const up = (text: string, fn: (p: Draft<Project>) => void) => store.update(text, fn);

function go(project: Project, id: string, markDone?: string) {
  store.silent((p) => {
    p.wizard.step = id;
    if (markDone && !p.wizard.done.includes(markDone)) p.wizard.done.push(markDone);
    if (markDone) p.wizard.skipped = p.wizard.skipped.filter((x) => x !== markDone);
  });
  document.querySelector('.content')?.scrollTo({ top: 0 });
  void project;
}

function skip(id: string, next: string) {
  store.silent((p) => {
    if (!p.wizard.skipped.includes(id)) p.wizard.skipped.push(id);
    p.wizard.step = next;
  });
}

/** Auswahl als große Karten (für Laien verständlicher als ein Dropdown). */
function Cards<T extends string>({ value, options, onChange }: { value: T | undefined; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="cards">
      {options.map((o) => (
        <button key={o.value} className={`card ${value === o.value ? 'active' : ''}`} onClick={() => onChange(o.value)}>
          <b>{o.label}</b>{o.hint && <span>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function Why({ children }: { children: ReactNode }) {
  return <details className="why"><summary>Warum wird das gefragt?</summary><div>{children}</div></details>;
}

// ===========================================================================

export function Wizard({ project }: { project: Project }) {
  const steps = allSteps(project);
  const idx = Math.max(0, steps.findIndex((s) => s.id === project.wizard.step));
  const step = steps[idx];
  const prev = steps[idx - 1];
  const next = steps[idx + 1];
  const missing = missingFor(project, step);
  const pr = progress(project);
  const room = step.roomId ? project.rooms.find((r) => r.id === step.roomId) : undefined;

  return (
    <div className="wizard">
      <aside className="wiz-steps">
        <div className="wiz-progress"><div style={{ width: `${(pr.done / pr.total) * 100}%` }} /></div>
        <div className="muted small">{pr.done} von {pr.total} Schritten erledigt</div>
        <StepList project={project} steps={steps} current={step.id} />
      </aside>
      <section className="wiz-main">
        <div className="wiz-card">
          <div className="wiz-head">
            <span className="muted small">{step.group}{room ? ` · ${room.name}${room.formerName && room.formerName !== room.name ? ` (Bestandsplan: ${room.formerName})` : ''}` : ''} · Schritt {idx + 1} / {steps.length}</span>
            <h2>{step.title}</h2>
          </div>
          <div className="wiz-body">
            {room && step.sub && !['zusammenfassung', 'nutzung', 'einrichtung', 'leitungsweg'].includes(step.sub) ? (
              <div className="wiz-split">
                <div><RoomStep project={project} room={room} step={step} /></div>
                <div className="wiz-preview"><RoomPlan project={project} room={room} layers={['moebel', '230v', 'daten', 'licht', 'beschriftung', 'masse']} /></div>
              </div>
            ) : room && step.sub ? <RoomStep project={project} room={room} step={step} /> : <ProjectStep project={project} step={step} />}
          </div>
          {missing.length > 0 && (
            <div className="wiz-missing">Noch offen: {missing.join(' · ')}</div>
          )}
          <div className="wiz-foot">
            <button disabled={!prev} onClick={() => prev && go(project, prev.id)}>← Zurück</button>
            <span className="spacer" />
            {next && missing.length > 0 && <button onClick={() => skip(step.id, next.id)} title="Der Punkt bleibt als offen markiert">Weiß ich noch nicht – später</button>}
            {next && <button className="primary" onClick={() => go(project, next.id, step.id)}>Weiter →</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function StepList({ project, steps, current }: { project: Project; steps: Step[]; current: string }) {
  const groups: { key: string; label: string; items: Step[] }[] = [];
  for (const s of steps) {
    const key = s.roomId ? `raum:${s.roomId}` : s.group;
    let gr = groups.find((x) => x.key === key);
    if (!gr) {
      const r = s.roomId ? project.rooms.find((x) => x.id === s.roomId) : undefined;
      const fl = r && project.floors.length > 1 ? project.floors.find((f) => f.id === r.floorId) : undefined;
      const short = (n: string) => ({ kellergeschoss: 'KG', erdgeschoss: 'EG', obergeschoss: 'OG', dachgeschoss: 'DG', spitzboden: 'SB' } as Record<string, string>)[n.toLowerCase()] ?? n;
      gr = { key, label: r ? `${fl ? short(fl.name) + ' · ' : ''}${r.name}` : s.group, items: [] };
      groups.push(gr);
    }
    gr.items.push(s);
  }
  return (
    <div className="steplist">
      {groups.map((gr) => {
        const open = gr.items.some((s) => s.id === current) || !gr.key.startsWith('raum:');
        const allDone = gr.items.every((s) => project.wizard.done.includes(s.id));
        return (
          <div key={gr.key}>
            <button className="stepgroup" onClick={() => go(project, gr.items[0].id)}>{allDone ? '✔ ' : ''}{gr.label}</button>
            {open && gr.items.map((s) => {
              const done = project.wizard.done.includes(s.id);
              const skipped = project.wizard.skipped.includes(s.id);
              return (
                <button key={s.id} className={`stepitem ${s.id === current ? 'active' : ''}`} onClick={() => go(project, s.id)}>
                  <span className="dot">{done ? '✔' : skipped ? '…' : '○'}</span>{s.sub ? roomSubstepLabel[s.sub] : s.title}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Projektschritte
// ===========================================================================

function ProjectStep({ project, step }: { project: Project; step: Step }) {
  switch (step.id) {
    case 'projekt.start': return <StartStep project={project} />;
    case 'projekt.gebaeude': return <BuildingStep project={project} />;
    case 'projekt.bezug': return <ReferenceStep project={project} />;
    case 'projekt.installation': return <InstallationStep project={project} />;
    case 'projekt.verteilung': return <DistributionStep project={project} />;
    case 'projekt.bestand': return <KeepStep project={project} />;
    case 'projekt.smarthome': return <SmartStep project={project} />;
    case 'projekt.netzwerk': return <NetworkStep project={project} />;
    case 'grundriss': return <PlanStep project={project} />;
    case 'raeume': return <RoomsStep project={project} />;
    case 'empfehlungen.auslaesse': return <SuggestStep project={project} />;
    case 'empfehlungen.stromkreise': return <CircuitsStep project={project} />;
    case 'abschluss': return <FinishStep project={project} />;
  }
  return null;
}

function StartStep({ project }: { project: Project }) {
  return (
    <>
      <Field label="Wie soll das Projekt heißen?"><TextInput wide value={project.name === 'Neues Projekt' ? '' : project.name} placeholder="z. B. Kellerwohnung Musterstraße" onChange={(v) => up('Projektname', (p) => { p.name = v || 'Neues Projekt'; })} /></Field>
      <h3>Was für ein Vorhaben ist es?</h3>
      <Cards value={project.projectType} onChange={(v) => up('Projektart', (p) => { p.projectType = v; })} options={[
        { value: 'neubau', label: projectTypeLabel.neubau, hint: 'Rohbau, alles frei planbar' },
        { value: 'bestand_komplett', label: projectTypeLabel.bestand_komplett, hint: 'Bestehendes Haus, Elektrik wird komplett neu' },
        { value: 'teilsanierung', label: projectTypeLabel.teilsanierung, hint: 'Einzelne Räume, Keller, Einliegerwohnung, Garage/Garten' },
      ]} />
      <Field label="Kurzbeschreibung (optional)"><TextInput wide value={project.description} placeholder="z. B. Keller wird zur Wohnung ausgebaut, Garage mit Wallbox" onChange={(v) => up('Beschreibung', (p) => { p.description = v; })} /></Field>
      <Why>Im Bestand fragt das Programm zusätzlich nach vorhandenen Leitungen, Dosen und der bestehenden Verteilung. Im Neubau entfällt das.</Why>
      <details className="why"><summary>Optional: KI-Unterstützung einschalten (Grundriss, Fotos, Beschreibungen auswerten)</summary><AiKeySettings /></details>
    </>
  );
}

export function BuildingStep({ project }: { project: Project }) {
  return (
    <>
      <div className="grid2">
        <Field label="Gebäudeart"><Select value={project.buildingType} options={opts({ efh: 'Einfamilienhaus', dhh: 'Doppelhaushälfte', rh: 'Reihenhaus', mfh: 'Mehrfamilienhaus', einliegerwohnung: 'Einliegerwohnung', sonstiges: 'Sonstiges' })} onChange={(v) => v && up('Gebäudeart', (p) => { p.buildingType = v as any; })} /></Field>
        <Field label="Bundesland"><Select value={project.bundesland} allowEmpty="– bitte wählen –" options={opts({ BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen' })} onChange={(v) => up('Bundesland', (p) => { p.bundesland = v as any; })} /></Field>
      </div>
      <h3>Welche Geschosse hat das Gebäude, und welche betrifft die Planung?</h3>
      <p className="muted small">Lege alle Geschosse an, durch die Leitungen laufen (auch das mit der Verteilung). Die Geschosshöhe (Rohboden bis Rohboden darüber) braucht das Programm für Leitungen zwischen den Geschossen.</p>
      <div className="inline">
        {([['Kellergeschoss', -1], ['Erdgeschoss', 0], ['Obergeschoss', 1], ['Dachgeschoss', 2], ['Spitzboden', 3]] as [string, number][]).filter(([, lv]) => !project.floors.some((f) => f.level === lv)).map(([name, lv]) => (
          <button key={name} className="small" onClick={() => up(`${name} angelegt`, (p) => { p.floors.push({ id: newId('geschoss'), name, level: lv, backgroundOpacity: 0.6, height: lv < 0 ? 250 : 275 }); p.floors.sort((a, b) => a.level - b.level); })}>＋ {name}</button>
        ))}
      </div>
      <EditTable rows={project.floors} rowKey={(r) => r.id}
        cols={[{ key: 'name', label: 'Geschoss', type: 'text' }, { key: 'level', label: 'Ebene (0 = EG, −1 = Keller)', type: 'number' }, { key: 'height', label: 'Geschosshöhe cm', type: 'number' }, { key: 'id', label: 'Räume', type: 'readonly', render: (f: any) => <span>{project.rooms.filter((r) => r.floorId === f.id).length}</span> }] as Col<any>[]}
        onChange={(i, k, v) => up('Geschoss', (p) => { (p.floors[i] as any)[k] = v; })}
        onRemove={project.floors.length > 1 ? (i) => up('Geschoss entfernt', (p) => { if (p.rooms.some((r) => r.floorId === p.floors[i].id)) { alert('Das Geschoss enthält noch Räume.'); return; } p.floors.splice(i, 1); }) : undefined}
        onAdd={() => up('Geschoss ergänzt', (p) => { p.floors.push({ id: newId('geschoss'), name: 'Neues Geschoss', level: Math.max(...p.floors.map((f) => f.level)) + 1, backgroundOpacity: 0.6, height: 275 }); })} addLabel="anderes Geschoss" />
      <Why>Das Bundesland bestimmt die Landesbauordnung, und die regelt z. B., in welchen Räumen Rauchwarnmelder Pflicht sind.</Why>
    </>
  );
}

export function ReferenceStep({ project }: { project: Project }) {
  const ref = project.settings.heightReference;
  return (
    <>
      <p>Alle Höhen im Plan (Dosen, Fenster, Vorwände) brauchen einen festen Bezug. Am sichersten ist eine Fläche, die es <b>heute schon gibt</b> und die beim Messen nicht wackelt.</p>
      <Cards value={ref.label} onChange={(v) => up('Höhenbezug', (p) => { p.settings.heightReference.label = v; p.settings.heightReference.description = v === 'OK Fertigfußboden' ? 'Alle Höhen ab fertigem Boden.' : `Alle Höhen ab heutiger ${v.replace('OK ', 'Oberkante ')}. Der künftige Bodenaufbau wird je Raum eingerechnet.`; })} options={[
        { value: 'OK Rohboden', label: 'Rohboden heute', hint: 'Neubau/Rohbau: Betondecke oder Bodenplatte' },
        { value: 'OK Estrich (Bestand)', label: 'Estrich heute', hint: 'Bestand: vorhandener Estrich, Belag kommt noch' },
        { value: 'OK Fertigfußboden', label: 'Fertigfußboden', hint: 'nur wenn der Boden fertig ist und bleibt' },
      ]} />
      <Field label="Kommt auf diesen Bezug in den meisten Räumen noch etwas drauf? (cm)" hint="z. B. Ausgleich 0,5 + Vinyl 1,0 = 1,5; Neubau mit Estrich + Dämmung oft 12–15. Je Raum änderbar.">
        <NumberInput value={project.settings.defaultFutureBuildup} onChange={(v) => v != null && up('Standard-Bodenaufbau', (p) => { p.settings.defaultFutureBuildup = v; })} />
      </Field>
      <h3>Standardhöhen (Dosenmitte über fertigem Boden)</h3>
      <div className="grid3">
        {([['steckdose', 'Steckdose'], ['schalter', 'Schalter'], ['kuecheArbeitsflaeche', 'Küche über Arbeitsfläche'], ['nachttisch', 'Nachttisch'], ['aufputzKeller', 'Aufputz Keller/Garage'], ['lan', 'LAN']] as const).map(([k, l]) => (
          <Field key={k} label={`${l} (cm)`}><NumberInput value={project.settings.defaultHeights[k]} onChange={(v) => v != null && up(`Standardhöhe ${l}`, (p) => { p.settings.defaultHeights[k] = v; })} /></Field>
        ))}
      </div>
      <Why>Wird der Bodenaufbau vergessen, sitzen später alle Dosen um diesen Betrag zu tief. Das Programm rechnet ihn bei jeder Höhe automatisch ein und zeigt beide Werte: über Bezug (zum Messen jetzt) und über Fertigfußboden.</Why>
    </>
  );
}

export function InstallationStep({ project }: { project: Project }) {
  const sp = project.settings.switchProgram;
  return (
    <>
      <h3>Wie wird überwiegend verlegt?</h3>
      <Cards value={project.settings.defaultInstallationType} onChange={(v) => up('Standard-Installationsart', (p) => { p.settings.defaultInstallationType = v; })} options={[
        { value: 'unterputz', label: 'Unterputz', hint: 'Wohnräume: Schlitze, UP-Dosen' },
        { value: 'aufputz_rohr', label: 'Aufputz im Rohr', hint: 'Keller, Garage, Werkstatt' },
        { value: 'aufputz_nym_schellen', label: 'Aufputz NYM auf Schellen', hint: 'Technikräume' },
        { value: 'hohlwand', label: 'Hohlwand / Trockenbau', hint: 'Ständerwerk, Vorsatzschalen' },
      ]} />
      <p className="muted small">Gilt als Vorgabe für neue Räume und lässt sich je Raum ändern (Mischformen sind normal).</p>
      <h3>Schalterprogramm</h3>
      <datalist id="wiz-switchprograms">{SWITCH_PROGRAMS.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="grid2">
        <Field label="Hersteller"><TextInput value={sp.manufacturer} list="wiz-switchprograms" onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.manufacturer = v; })} /></Field>
        <Field label="Serie"><TextInput value={sp.series} onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.series = v; })} /></Field>
        <Field label="Farbe"><TextInput value={sp.color} onChange={(v) => up('Schalterprogramm', (p) => { p.settings.switchProgram.color = v; })} /></Field>
        <Field label="Feuchtraum-/Aufputzprogramm"><TextInput value={sp.wetRoomSeries} onChange={(v) => up('Feuchtraumprogramm', (p) => { p.settings.switchProgram.wetRoomSeries = v; })} /></Field>
      </div>
      <Why>Die Installationsart entscheidet über Dosenart, Leitungswege und Material. Das Schalterprogramm bestimmt Rahmen und Einsätze in der Einkaufsliste.</Why>
    </>
  );
}

export function DistributionStep({ project }: { project: Project }) {
  const hvIdx = project.distributions.findIndex((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank');
  const hv = project.distributions[hvIdx];
  if (!hv) {
    return (
      <>
        <p>Woher kommt der Strom für die geplanten Räume? Fangen wir mit der Verteilung an, in der die Sicherungen sitzen.</p>
        <button className="primary" onClick={() => up('Hauptverteilung angelegt', (p) => { p.distributions.push({ id: newId('hv'), name: 'Hauptverteilung (HV)', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'unbekannt', meter: '', freeModules: 0, breakers: [], rcds: [], hasSpd: false, photos: [], note: '' }); })}>Hauptverteilung erfassen</button>
      </>
    );
  }
  const setHv = (text: string, fn: (d: Draft<Project>['distributions'][number]) => void) => up(text, (p) => fn(p.distributions[hvIdx]));
  const group = (ch: string, a: number) => hv.breakers.find((b) => b.characteristic === ch && b.ratedCurrent === a);
  const setFree = (ch: 'B' | 'C', a: number, n: number | null) => setHv(`Freie ${ch}${a}`, (d) => {
    const g = d.breakers.find((b) => b.characteristic === ch && b.ratedCurrent === a);
    if (!n) { d.breakers = d.breakers.filter((b) => b !== g); return; }
    if (g) { g.free = n; g.count = Math.max(g.count, n); } else d.breakers.push({ id: newId('ls'), characteristic: ch, ratedCurrent: a, poles: 1, count: n, free: n, note: '' });
  });
  const others = project.distributions.filter((d) => d.kind === 'UV');
  return (
    <>
      <div className="grid2">
        <Field label="Wo hängt die Verteilung?"><TextInput value={hv.note} placeholder="z. B. Treppenhaus Keller, Hausanschlussraum" onChange={(v) => setHv('HV-Standort', (d) => { d.note = v; })} /></Field>
        <Field label="Zähler: wer bezahlt den Strom der geplanten Räume?"><TextInput value={hv.meter} placeholder="z. B. eigener Zähler Wohnung / Allgemeinstrom" onChange={(v) => setHv('Zähler', (d) => { d.meter = v; })} /></Field>
        <Field label="Netzform" hint="steht oft im Hausanschlusskasten; sonst Netzbetreiber fragen"><Select value={hv.netForm} options={opts({ 'TN-C-S': 'TN-C-S (häufig)', 'TN-S': 'TN-S', TT: 'TT', unbekannt: 'weiß ich nicht' })} onChange={(v) => v && setHv('Netzform', (d) => { d.netForm = v as any; })} /></Field>
        <Field label="Hauptsicherung (falls bekannt)"><TextInput value={hv.mainFuse} placeholder="z. B. 3× 63 A" onChange={(v) => setHv('Hauptsicherung', (d) => { d.mainFuse = v; })} /></Field>
      </div>
      <DistributionPhotoAi project={project} distributionId={hv.id} />
      <h3>Was ist frei?</h3>
      <div className="grid3">
        <Field label="Freie Leitungsschutzschalter B16"><NumberInput step={1} value={group('B', 16)?.free ?? 0} onChange={(v) => setFree('B', 16, v)} /></Field>
        <Field label="Freie B10"><NumberInput step={1} value={group('B', 10)?.free ?? 0} onChange={(v) => setFree('B', 10, v)} /></Field>
        <Field label="Freie Plätze ohne Gerät (Teilungseinheiten)"><NumberInput step={1} value={hv.freeModules} onChange={(v) => v != null && setHv('freie TE', (d) => { d.freeModules = Math.round(v); })} /></Field>
      </div>
      <h3>Vorhandene FI-/RCD-Schalter</h3>
      <EditTable rows={hv.rcds} rowKey={(r) => r.id}
        cols={[{ key: 'label', label: 'Bezeichnung', type: 'text' }, { key: 'ratedCurrent', label: 'A', type: 'number' }, { key: 'residualCurrent', label: 'mA', type: 'number' }, { key: 'type', label: 'Typ', type: 'select', options: opts({ A: 'A', F: 'F', B: 'B', EV: 'EV' }) }, { key: 'existing', label: 'vorhanden', type: 'check' }] as Col<any>[]}
        onChange={(i, k, v) => setHv('RCD', (d) => { (d.rcds[i] as any)[k] = v; })}
        onRemove={(i) => setHv('RCD entfernt', (d) => { d.rcds.splice(i, 1); })}
        onAdd={() => setHv('RCD ergänzt', (d) => { d.rcds.push({ id: newId('fi'), label: `FI ${d.rcds.length + 1} (40 A / 30 mA, Typ A)`, ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: true }); })} addLabel="FI/RCD" empty="Keine erfasst – bei sehr alten Anlagen gibt es oft keinen." />
      <h3>Braucht es Unterverteilungen?</h3>
      <p className="muted small">Sinnvoll z. B. für Garage/Wallbox, Garten, Einliegerwohnung oder weit entfernte Bereiche.</p>
      <EditTable rows={others} rowKey={(r) => r.id}
        cols={[{ key: 'name', label: 'Name', type: 'text' }, { key: 'note', label: 'wofür / wo', type: 'text' }] as Col<any>[]}
        onChange={(i, k, v) => up('Unterverteilung', (p) => { (p.distributions.filter((d) => d.kind === 'UV')[i] as any)[k] = v; })}
        onRemove={(i) => up('Unterverteilung entfernt', (p) => { const id = others[i].id; p.distributions = p.distributions.filter((d) => d.id !== id); })}
        onAdd={() => up('Unterverteilung ergänzt', (p) => { p.distributions.push({ id: newId('uv'), name: 'UV Garage', kind: 'UV', feedFromId: hv.id, feedCable: '', feedFuse: '', mainFuse: '', netForm: hv.netForm, meter: '', freeModules: 12, breakers: [], rcds: [], hasSpd: false, photos: [], note: '' }); })} addLabel="Unterverteilung" empty="Keine." />
      <Why>Neue Stromkreise müssen in der Verteilung Platz finden. Das Programm vergleicht später seinen Stromkreisvorschlag mit den freien Plätzen und zeigt, was fehlt. Ein Foto der Verteilung kann in Etappe 5 hochgeladen und ausgewertet werden.</Why>
    </>
  );
}

function KeepStep({ project }: { project: Project }) {
  return (
    <>
      <p>Gibt es Teile, die bereits erledigt sind oder unverändert bleiben? (Heizung, Wallbox, Treppenhauslicht, Klingel …)</p>
      <textarea rows={5} defaultValue={project.keepAsIs.join('\n')} placeholder={'Eine Angabe pro Zeile, z. B.\nHeizung (eigener Stromkreis, bleibt)'} onBlur={(e) => up('Bleibt unverändert', (p) => { p.keepAsIs = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); })} />
      <Why>Diese Teile tauchen in Stromkreisliste und Aufgaben als „bleibt“ auf und werden nicht neu geplant.</Why>
    </>
  );
}

function SmartStep({ project }: { project: Project }) {
  const sh = project.smartHome;
  return (
    <>
      <h3>Sollen Smart-Home-Funktionen eingebunden werden?</h3>
      <Cards value={sh.enabled ? 'ja' : 'nein'} onChange={(v) => up('Smart Home ein/aus', (p) => { p.smartHome.enabled = v === 'ja'; if (v === 'ja' && p.smartHome.system === 'keines') p.smartHome.system = 'home_assistant'; })} options={[
        { value: 'nein', label: 'Nein / später', hint: 'konventionell, aber vorbereitet' },
        { value: 'ja', label: 'Ja', hint: 'System wählen' },
      ]} />
      {sh.enabled && (
        <>
          <h3>Welches System?</h3>
          <Cards value={sh.system} onChange={(v) => up('Smart-Home-System', (p) => { p.smartHome.system = v; p.smartHome.busCableToSwitches = v === 'knx'; })} options={(['knx', 'home_assistant', 'shelly', 'zigbee', 'matter_thread', 'homematic_ip', 'gemischt'] as const).map((k) => ({ value: k, label: smartHomeLabel[k] }))} />
          <Field label="Zentrale / Server (falls schon klar)"><TextInput wide value={sh.central} placeholder="z. B. Home Assistant auf Mini-PC im Netzwerkschrank" onChange={(v) => up('Smart-Home-Zentrale', (p) => { p.smartHome.central = v; })} /></Field>
        </>
      )}
      <div className="impact">
        <b>Was das für die Leitungen bedeutet:</b>
        <ul>{SMART_HOME_IMPACT[sh.enabled ? sh.system : 'keines'].map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
      <p className="muted small">Je Raum lässt sich das System später abweichend festlegen (z. B. nur Heimkino smart).</p>
    </>
  );
}

export function NetworkStep({ project }: { project: Project }) {
  return (
    <>
      <div className="grid2">
        <Field label="Wo steht/soll der Netzwerkschrank (Router, Switch) hin?"><TextInput value={project.network.rackLocation} placeholder="z. B. Technikraum, Flur-Abstellraum" onChange={(v) => up('Netzwerkschrank', (p) => { p.network.rackLocation = v; })} /></Field>
        <Field label="WLAN-Access-Points mit PoE (Anzahl)"><NumberInput step={1} value={project.network.poeAccessPoints} onChange={(v) => v != null && up('Access Points', (p) => { p.network.poeAccessPoints = Math.round(v); })} /></Field>
      </div>
      <Why>Jede LAN-Dose bekommt ein eigenes Kabel sternförmig zum Netzwerkschrank. Der Standort bestimmt die Kabellängen.</Why>
    </>
  );
}

// ---------------------------------------------------------------------------

export function FloorPlanCard({ project, fi }: { project: Project; fi: number }) {
  const floor = project.floors[fi];
  const [mode, setMode] = useState<TracerMode>(floor.backgroundPlan && !floor.backgroundScale ? 'kalibrieren' : 'ansehen');
  const [open, setOpen] = useState(!floor.backgroundPlan || !floor.backgroundScale);
  return (
    <div className="floorcard">
      <div className="inline">
        <b>{floor.name}</b>
        <span className={floor.backgroundScale ? 'ok small' : 'muted small'}>{!floor.backgroundPlan ? 'kein Grundriss' : floor.backgroundScale ? `✔ Grundriss, Maßstab 1 px = ${fmt(floor.backgroundScale, 2)} cm` : 'Grundriss ohne Maßstab'}</span>
        <span className="spacer" />
        <label className="filebtn small">{floor.backgroundPlan ? 'Anderen Grundriss laden' : 'Grundriss hochladen (JPG/PNG)'}
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const img = await loadImage(f);
              up(`Grundriss für ${floor.name} hochgeladen`, (p) => { const fl = p.floors[fi]; fl.backgroundPlan = img.dataUrl; fl.backgroundSize = { w: img.w, h: img.h }; fl.backgroundScale = undefined; });
              setMode('kalibrieren'); setOpen(true);
            } catch (err) { alert((err as Error).message); }
          }} />
        </label>
        {floor.backgroundPlan && <>
          <button className="small" onClick={() => setOpen(!open)}>{open ? 'Zuklappen' : 'Anzeigen'}</button>
          <button className={`small ${mode === 'kalibrieren' ? 'active' : ''}`} onClick={() => { setMode('kalibrieren'); setOpen(true); }}>Maßstab festlegen</button>
          <input type="range" title="Deckkraft" min={0.15} max={1} step={0.05} value={floor.backgroundOpacity} onChange={(e) => store.silent((p) => { p.floors[fi].backgroundOpacity = Number(e.target.value); })} />
          <button className="small danger" onClick={() => confirm('Grundriss entfernen?') && up('Grundriss entfernt', (p) => { const fl = p.floors[fi]; fl.backgroundPlan = undefined; fl.backgroundSize = undefined; fl.backgroundScale = undefined; })}>Entfernen</button>
        </>}
      </div>
      {floor.backgroundPlan && open && (
        <PlanTracer floor={floor} rooms={project.rooms.filter((r) => r.floorId === floor.id)} mode={mode}
          onCalibrate={(sc) => { up(`Maßstab ${floor.name}`, (p) => { p.floors[fi].backgroundScale = sc; }); setMode('ansehen'); }} />
      )}
      {floor.backgroundPlan && <FloorPlanAi project={project} floorId={floor.id} />}
    </div>
  );
}

function PlanStep({ project }: { project: Project }) {
  return (
    <>
      <p>Hast du Grundrisse (Bauplan, Skizze, Foto)? Lade je Geschoss einen hoch und lege den Maßstab über ein bekanntes Maß fest. Danach ziehst du die Räume darauf auf. Ohne Plan geht es auch: Dann fragt das Programm die Maße einzeln ab.</p>
      {project.floors.map((f, fi) => <FloorPlanCard key={f.id} project={project} fi={fi} />)}
      <Why>Pläne sind oft verzerrt (Foto schräg) oder enthalten alte Raumnamen. Das Programm nutzt den Plan nur als Vorlage: Lage und ungefähre Größe. Verbindlich sind die Maße, die du vor Ort misst. Die alten Bezeichnungen bleiben als „Bestandsplan“ erhalten.</Why>
    </>
  );
}

function RoomsStep({ project }: { project: Project }) {
  const [tracing, setTracing] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const addRoom = (floorId: string) => {
    const fb = project.settings.defaultFutureBuildup;
    const fl = project.floors.find((f) => f.id === floorId);
    const room = createRectRoom({
      id: newId('raum'), floorId, name: `Raum ${project.rooms.length + 1}`, width: 400, depth: 300, height: Math.max(200, (fl?.height ?? 275) - 25), provenance: 'annahme',
      installationType: project.settings.defaultInstallationType,
      floor: fb ? { futureAboveRef: [{ name: 'Bodenaufbau (Vorgabe)', thickness: fb }] } : {},
    });
    up('Raum angelegt', (p) => { p.rooms.push(room as any); });
  };
  const typeOpts = ROOM_TYPES.map((t) => ({ value: t, label: ROOM_TYPE_INFO[t].label }));
  return (
    <>
      <p>Lege je Geschoss alle Räume an. Steht im Plan ein alter Name (z. B. „HEIZUNG“), trag ihn als <b>Bezeichnung im Bestandsplan</b> ein und den künftigen Namen daneben. Die <b>Nutzung</b> bestimmt Verbraucher, Leistungsbedarf und Mindestausstattung.</p>
      {project.floors.map((floor) => {
        const rooms = project.rooms.filter((r) => r.floorId === floor.id);
        const tracingRoom = rooms.find((r) => r.id === tracing);
        return (
          <div key={floor.id} className="floorcard">
            <div className="inline"><b>{floor.name}</b><span className="muted small">{rooms.length} Räume · Geschosshöhe {fmt(floor.height)} cm</span><span className="spacer" /><button className="small primary" onClick={() => setMeasuring(floor.id)} title="Schritt für Schritt: Innenmaße, Höhe, Türen, Fenster – ideal am Handy vor Ort">Raum aufmessen</button><button className="small" onClick={() => addRoom(floor.id)}>＋ Raum (Maße später)</button></div>
            {measuring === floor.id && <MeasureFlow project={project} floorId={floor.id} onClose={() => setMeasuring(null)} />}
            <EditTable rows={rooms} rowKey={(r) => r.id} selectedKey={tracing ?? undefined}
              cols={[
                { key: 'formerName', label: 'Im Bestandsplan', type: 'text' },
                { key: 'name', label: 'Künftiger Name', type: 'text' },
                { key: 'roomType', label: 'Nutzung', type: 'readonly', render: (r: Room) => <Select value={r.roomType} allowEmpty="– wählen –" options={typeOpts} onChange={(v) => v && setRoomType(project, r, v as RoomTypeId)} /> },
                { key: 'inScope', label: 'wird geplant', type: 'check' },
                { key: 'id', label: 'Breite × Tiefe × Höhe (cm)', type: 'readonly', render: (r: Room) => <RoomSizeEditor room={r} /> },
                { key: 'id', label: '', type: 'readonly', render: (r: Room) => floor.backgroundScale ? <button className="small" onClick={(e) => { e.stopPropagation(); setTracing(tracing === r.id ? null : r.id); }}>{tracing === r.id ? 'Abbrechen' : 'Im Plan aufziehen'}</button> : null },
              ] as Col<any>[]}
              onChange={(i, k, v) => up(`Raum ${k}`, (p) => { const id = rooms[i].id; (p.rooms.find((x) => x.id === id) as any)[k] = v; })}
              onRemove={(i) => up(`Raum ${rooms[i].name} entfernt`, (p) => { p.rooms = p.rooms.filter((x) => x.id !== rooms[i].id); })}
              empty={`Noch keine Räume im ${floor.name}.`} />
            {rooms.length > 0 && <p className="muted small">Maße kannst du hier grob eintragen oder aus dem Plan übernehmen – sie lassen sich jederzeit ändern. Im nächsten Schritt fragt der Assistent je Raum die genauen, vor Ort gemessenen Maße ab und du kannst sie dort noch einmal anpassen, auch wenn du den Raum im Plan aufgezogen hast.</p>}
            {tracingRoom && floor.backgroundScale && (
              <>
                <p className="small"><b>„{tracingRoom.name}“ aufziehen:</b> zwei gegenüberliegende Ecken anklicken (zum genauen Treffen vorher hineinzoomen). Die Maße aus dem Plan sind ein Startwert – du kannst sie danach in der Tabelle und im Schritt „Maße“ anpassen.</p>
                <PlanTracer floor={floor} rooms={rooms} mode="raum" highlightRoomId={tracingRoom.id}
                  onRect={(rc) => {
                    upRoom(tracingRoom.id, `${tracingRoom.name}: Lage aus Grundriss`, (r) => {
                      r.originOnFloor = { x: rc.x, y: rc.y };
                      if (isRectRoom(r as Room)) r.polygon = [{ x: 0, y: 0 }, { x: rc.w, y: 0 }, { x: rc.w, y: rc.d }, { x: 0, y: rc.d }];
                      r.provenance = 'aus_plan';
                    });
                    setTracing(null);
                  }} />
              </>
            )}
            {!tracingRoom && floor.backgroundScale && rooms.length > 0 && <details className="why"><summary>Räume im Grundriss anzeigen</summary><PlanTracer floor={floor} rooms={rooms} mode="ansehen" /></details>}
          </div>
        );
      })}
      <Why>Für jeden Raum, der geplant wird, fragt der Assistent danach Nutzung, Maße, Wände, Türen, Fenster, Boden, Decke und Einrichtung ab – Geschoss für Geschoss.</Why>
    </>
  );
}

/** Maße direkt in der Raumliste: Rechteckräume Breite × Tiefe, alle Räume Höhe. */
function RoomSizeEditor({ room }: { room: Room }) {
  const rect = isRectRoom(room);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="sizeedit" onClick={stop}>
      {rect ? (
        <>
          <NumberInput width="5em" value={room.polygon[1].x} min={30} onChange={(v) => v && upRoom(room.id, `${room.name}: Breite ${v} cm`, (r) => { r.polygon[1].x = v; r.polygon[2].x = v; })} />
          <span>×</span>
          <NumberInput width="5em" value={room.polygon[2].y} min={30} onChange={(v) => v && upRoom(room.id, `${room.name}: Tiefe ${v} cm`, (r) => { r.polygon[2].y = v; r.polygon[3].y = v; })} />
        </>
      ) : <span className="small" title="Kein Rechteck – Ecken im Schritt „Maße“ bzw. in der Expertenansicht ändern">{fmt(roomArea(room), 1)} m²</span>}
      <span>×</span>
      <NumberInput width="4.5em" value={room.height} min={100} onChange={(v) => v && upRoom(room.id, `${room.name}: Höhe ${v} cm`, (r) => { r.height = v; })} />
      {room.provenance === 'annahme' && <span className="muted small">vorläufig</span>}
      {room.provenance === 'aus_plan' && <span className="muted small">aus Plan</span>}
    </div>
  );
}

export function SuggestStep({ project }: { project: Project }) {
  const rooms = project.rooms.filter((r) => r.inScope);
  const [roomId, setRoomId] = useState(rooms[0]?.id);
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const counts = rooms.map((r) => ({ r, n: suggestOutlets(project, r).length }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  if (!room) return <p>Noch keine Räume angelegt.</p>;
  return (
    <>
      <p>Jetzt, wo das Programm die Räume kennt, schlägt es Auslässe vor: Schalter an den Türen (Griffseite), Licht, Rauchwarnmelder, Steckdosen und Anschlüsse aus Möbeln und Geräten, fehlende Steckdosen nach Ausstattungswert {project.equipmentLevel}. Du übernimmst, lehnst ab oder verschiebst sie danach im Plan.</p>
      <div className="inline">
        {counts.map(({ r, n }) => <button key={r.id} className={r.id === room.id ? 'active' : ''} onClick={() => setRoomId(r.id)}>{r.name} ({n})</button>)}
        <span className="spacer" />
        <button disabled={!total} onClick={() => { for (const { r } of counts) { const cur = store.getState().project!.rooms.find((x) => x.id === r.id)!; const l = suggestOutlets(store.getState().project!, cur); if (l.length) acceptSuggestions(cur, l); } }}>Alle {total} Vorschläge in allen Räumen übernehmen</button>
      </div>
      <div className="wiz-split">
        <div><SuggestionsPanel project={project} room={room} /></div>
        <div className="wiz-preview"><RoomPlan project={project} room={room} layers={['moebel', '230v', 'daten', 'licht', 'beschriftung']} /></div>
      </div>
    </>
  );
}

export function CircuitsStep({ project }: { project: Project }) {
  const routes = computeAllRoutes(project);
  const rooms = project.rooms.filter((r) => r.inScope);
  return (
    <>
      <h3>Stromkreise</h3>
      <p>Das Programm teilt die Auslässe auf Stromkreise auf, ordnet sie den FI/RCD zu und prüft gegen die freien Plätze in der Verteilung.</p>
      <CircuitProposalPanel project={project} />
      <h3>Leitungswege je Raum</h3>
      <table className="findings">
        <thead><tr><th>Raum</th><th>Leitungsweg</th><th className="num">Bodenschlitz</th><th className="num">Wandschlitz</th><th className="num">Bohrungen</th><th>Hinweise</th></tr></thead>
        <tbody>{rooms.map((r) => { const rr = routes.get(r.id)!; const t = routeTotals(rr); return <tr key={r.id}><td>{r.name}</td><td>{rr.strategy}</td><td>{fmt(t.floorSlotM, 1)} m</td><td>{fmt(t.wallSlotM, 1)} m</td><td>{t.drillUP + t.drillHollow}</td><td className="small">{rr.issues.filter((i) => i.severity !== 'hinweis').length || ''}</td></tr>; })}</tbody>
      </table>
      <details className="why"><summary>Leitungsweg eines Raums ändern</summary>{rooms.map((r) => <div key={r.id}><h4>{r.name}</h4><RoutingPanel project={project} room={r} /></div>)}</details>
      <p className="muted small">Der vollständige Schlitzplan (Bodenschlitze, Wandschlitze, Bohrungen, Durchbrüche) steht unter „Ausgaben“.</p>
    </>
  );
}

function FinishStep({ project }: { project: Project }) {
  const pr = progress(project);
  const report = runRules(project);
  return (
    <>
      {pr.open.length === 0
        ? <p className="ok">✔ Alle Angaben sind vollständig.</p>
        : (<>
          <p>Diese Punkte sind noch offen. Du kannst sie jetzt nachtragen oder später – das Programm erinnert in der Prüfung daran.</p>
          <ul className="openlist">
            {pr.open.map(({ step, missing }) => (
              <li key={step.id}><button className="linklike" onClick={() => go(project, step.id)}>{step.title}</button>: {missing.join(', ')}</li>
            ))}
          </ul>
        </>)}
      <p>Regelprüfung der Erfassung: {report.counts.fehler} Fehler, {report.counts.warnung} Warnungen, {report.counts.hinweis} Hinweise.</p>
      <div className="impact">
        <b>Wie es weitergeht:</b> Unter „Ausgaben“ stehen Raumlayouts, Ausführungsplan (mit Stromkreis- und Leitungsliste) und Schlitzplan zum Drucken. Jede Änderung in der Expertenansicht zieht sich durch alle Pläne. Materialliste mit Bestellmengen, Kostenschätzung und Aufgabenliste für die Bauphase stehen unter „Material, Kosten, Aufgaben“.
      </div>
      <div className="inline">
        <button className="primary" onClick={() => { up('Assistent abgeschlossen', (p) => { p.wizard.finished = true; if (!p.wizard.done.includes('abschluss')) p.wizard.done.push('abschluss'); }); store.setUi({ view: 'projekt' }); }}>Assistent abschließen</button>
      </div>
    </>
  );
}

// ===========================================================================
// Raumschritte
// ===========================================================================

function RoomStep({ project, room, step }: { project: Project; room: Room; step: Step }) {
  switch (step.sub) {
    case 'masse': return <MassStep project={project} room={room} />;
    case 'waende': return <WallsStep room={room} />;
    case 'tueren': return <DoorsStep room={room} />;
    case 'fenster': return <WindowsStep room={room} />;
    case 'besonderheiten': return <SpecialsStep room={room} />;
    case 'boden': return <FloorStep project={project} room={room} />;
    case 'decke': return <CeilingStep room={room} />;
    case 'nutzung': return <UsageStep project={project} room={room} />;
    case 'einrichtung': return <FurnitureStep project={project} room={room} />;
    case 'leitungsweg': return (<>
      <p>Wie können in <b>{room.name}</b> Leitungen geführt werden? Das Programm bewertet jeden Weg mit Begründung – du bestätigst oder wählst einen anderen.</p>
      <FeasibilityPanel project={project} room={room} />
      <Why>Die Wahl entscheidet über Schlitzplan, Material und Aufwand. Beispiel Keller: Die Decke ist eine Hohlkörperdecke (nicht schlitzen) und zum Abhängen zu niedrig – dann bleibt der Bodenschlitz im Estrich, sofern Folie/Dämmung tief genug liegen.</Why>
    </>);
    case 'bestand': return <ExistingStep room={room} />;
    case 'zusammenfassung': return <SummaryTab project={project} room={room} findings={runRules(project, { roomId: room.id }).findings} />;
  }
  return null;
}

export function MassStep({ project, room }: { project: Project; room: Room }) {
  const rect = isRectRoom(room);
  const [measuring, setMeasuring] = useState(false);
  const [corner, setCorner] = useState<RectCorner>(3);
  const [dx, setDx] = useState<number | null>(null);
  const [dy, setDy] = useState<number | null>(null);
  const bb = bbox(room.polygon);
  void project;
  return (
    <>
      <p>Miss den Raum innen <b>von Wand zu Wand im Rohbau</b> (ohne Fliesen/Putz, die noch kommen).</p>
      {room.provenance === 'aus_plan' && <p className="muted small">Die Werte stammen aus dem aufgezogenen Grundriss. Trag hier die gemessenen Maße ein – die Lage im Plan bleibt erhalten.</p>}
      {rect && <p><button className="primary" onClick={() => setMeasuring(true)}>Schritt für Schritt aufmessen (Maße, Höhe, Türen, Fenster)</button> <span className="muted small">– ideal am Handy vor Ort</span></p>}
      {measuring && <MeasureFlow project={project} floorId={room.floorId} room={room} onClose={() => setMeasuring(false)} />}
      {rect ? (
        <div className="grid3">
          <Field label="Breite (waagerecht im Plan, cm)"><NumberInput value={room.polygon[1].x} onChange={(v) => v && upRoom(room.id, `${room.name}: Breite`, (r) => { r.polygon[1].x = v; r.polygon[2].x = v; r.provenance = 'gemessen'; })} /></Field>
          <Field label="Tiefe (senkrecht im Plan, cm)"><NumberInput value={room.polygon[2].y} onChange={(v) => v && upRoom(room.id, `${room.name}: Tiefe`, (r) => { r.polygon[2].y = v; r.polygon[3].y = v; r.provenance = 'gemessen'; })} /></Field>
          <Field label={`Raumhöhe (cm über ${project.settings.heightReference.label})`}><NumberInput value={room.height} onChange={(v) => v && upRoom(room.id, `${room.name}: Höhe`, (r) => { r.height = v; })} /></Field>
        </div>
      ) : (
        <>
          <p className="muted">Der Raum ist kein einfaches Rechteck ({room.polygon.length} Ecken, {fmt(bb.maxX - bb.minX)} × {fmt(bb.maxY - bb.minY)} cm). Einzelne Ecken bearbeitest du in der Expertenansicht.</p>
          <Field label="Raumhöhe (cm)"><NumberInput value={room.height} onChange={(v) => v && upRoom(room.id, `${room.name}: Höhe`, (r) => { r.height = v; })} /></Field>
        </>
      )}
      {room.provenance !== 'gemessen' && <Check checked={false} onChange={() => upRoom(room.id, `${room.name}: Maße bestätigt`, (r) => { r.provenance = 'gemessen'; })} label="Diese Maße habe ich vor Ort gemessen" />}
      {rect && (
        <>
          <h3>Gibt es einen Kamin, Schacht oder Vorsprung in einer Ecke?</h3>
          <div className="grid3">
            <Field label="Ecke"><Select value={String(corner)} options={([0, 1, 2, 3] as RectCorner[]).map((c) => ({ value: String(c), label: cornerLabel[c] }))} onChange={(v) => setCorner(Number(v) as RectCorner)} /></Field>
            <Field label="Breite waagerecht (cm)"><NumberInput value={dx} onChange={setDx} /></Field>
            <Field label="Tiefe senkrecht (cm)"><NumberInput value={dy} onChange={setDy} /></Field>
          </div>
          <button disabled={!dx || !dy} onClick={() => {
            try {
              const nr = notchRectCorner(room, corner, dx!, dy!);
              upRoom(room.id, `${room.name}: Kamin/Vorsprung ${cornerLabel[corner]} ${dx}×${dy}`, (r) => { Object.assign(r, nr); });
              setDx(null); setDy(null);
            } catch (e) { alert((e as Error).message); }
          }}>Kamin/Vorsprung eintragen</button>
          <p className="muted small">Die Flächen am Kamin werden automatisch als Tabuzone markiert: dort wird nicht gebohrt oder geschlitzt.</p>
        </>
      )}
      <Why>Nullpunkt ist immer die Ecke oben links im Plan (rot markiert). Von dort laufen die Wände im Uhrzeigersinn: W1, W2, … Alle späteren Maße beziehen sich darauf – das verhindert, dass linke und rechte Wand verwechselt werden.</Why>
    </>
  );
}

export function WallsStep({ room }: { room: Room }) {
  const materials = [...new Set(room.walls.map((w) => w.material))];
  return (
    <>
      <h3>Woraus sind die Wände überwiegend?</h3>
      <Cards value={materials.length === 1 ? materials[0] : undefined} onChange={(v) => upRoom(room.id, `${room.name}: Wandmaterial ${v}`, (r) => { r.walls.forEach((w) => { w.material = v; }); })}
        options={(['bims', 'kalksandstein', 'ziegel', 'porenbeton', 'beton', 'trockenbau', 'holz', 'unbekannt'] as const).map((k) => ({ value: k, label: wallMaterialLabel[k] }))} />
      <h3>Jede Wand einzeln</h3>
      <EditTable rows={room.walls.map((w) => ({ ...w, side: wallSideLabel(room, w.index), len: fmt(wallGeoms(room)[w.index].length) }))} rowKey={(r) => String(r.index)}
        cols={[
          { key: 'index', label: 'Wand', type: 'readonly', render: (r: any) => <b>W{r.index + 1}</b> },
          { key: 'side', label: 'Lage', type: 'readonly' },
          { key: 'len', label: 'Länge', type: 'readonly' },
          { key: 'label', label: 'grenzt an', type: 'text' },
          { key: 'material', label: 'Material', type: 'select', options: opts(wallMaterialLabel) },
          { key: 'exterior', label: 'Außenwand', type: 'check' },
          { key: 'loadBearing', label: 'tragend', type: 'check' },
          { key: 'horizontalSlotsAllowed', label: 'waagerecht schlitzen ok', type: 'check' },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: W${i + 1} ${k}`, (r) => { (r.walls[i] as any)[k] = v; })} />
      <h3>Fotos der Wände</h3>
      <RoomPhotos room={room} />
      <Why>Das Material entscheidet über Schlitztiefe, Dosenart und Werkzeug (Bims ist weich, Beton nur mit Diamant). Außenwände: Feuchte und Dämmung beachten. Waagerechte Schlitze schwächen tragende Wände – deshalb sind sie standardmäßig aus.</Why>
    </>
  );
}

export function DoorsStep({ room }: { room: Room }) {
  const wallOpts = room.walls.map((w) => ({ value: String(w.index), label: `W${w.index + 1} – ${wallSideLabel(room, w.index)}${w.label ? ` (${w.label})` : ''}` }));
  const set = (i: number, k: keyof Door, v: any, label: string) => upRoom(room.id, `${room.name}: Tür ${i + 1} ${label}`, (r) => { (r.doors[i] as any)[k] = v; });
  return (
    <>
      {room.doors.map((d, i) => (
        <div key={d.id} className="doorcard">
          <div className="inline"><b>Tür {i + 1}</b><span className="spacer" /><button className="icon danger" onClick={() => confirm('Tür entfernen?') && upRoom(room.id, `${room.name}: Tür entfernt`, (r) => { r.doors.splice(i, 1); })}>✕ entfernen</button></div>
          <div className="grid2">
            <Field label="In welcher Wand?"><Select value={String(d.wallIndex)} options={wallOpts} onChange={(v) => set(i, 'wallIndex', Number(v), 'Wand')} /></Field>
            <Field label="Führt zu"><TextInput value={d.leadsTo} placeholder="z. B. Flur" onChange={(v) => set(i, 'leadsTo', v, 'führt zu')} /></Field>
            <Field label="Abstand linke Ecke → Öffnung (cm)" hint="Stell dich in den Raum, schau auf diese Wand und miss von der linken Ecke bis zur Rohbauöffnung."><NumberInput value={d.s} onChange={(v) => v != null && set(i, 's', v, 'Abstand')} /></Field>
            <Field label="Breite der Rohbauöffnung (cm)"><NumberInput value={d.width} onChange={(v) => v && set(i, 'width', v, 'Breite')} /></Field>
            <Field label="Wo sind die Bänder (Scharniere)?" hint="Blick von innen auf die Tür"><Select value={d.hinge} options={opts({ links: 'links', rechts: 'rechts' })} onChange={(v) => set(i, 'hinge', v, 'Bänder')} /></Field>
            <Field label="Geht die Tür in den Raum auf?"><Select value={d.swing} options={opts({ innen: 'ja, nach innen', aussen: 'nein, nach außen' })} onChange={(v) => set(i, 'swing', v, 'Aufschlag')} /></Field>
            <Field label="Höhe der Öffnung (cm)"><NumberInput value={d.height} onChange={(v) => v && set(i, 'height', v, 'Höhe')} /></Field>
            <Field label="Brandschutztür?" hint="Aufkleber/Plakette an der Zarge, im Plan oft „FHT“ oder „T30“"><Select value={d.fireRating} options={opts({ keine: 'nein', T30: 'T30 / FHT', T60: 'T60', T90: 'T90', RS: 'Rauchschutz (RS)' })} onChange={(v) => set(i, 'fireRating', v, 'Brandschutz')} /></Field>
          </div>
          <div className="checks">
            <Check checked={d.hasFrame} onChange={(v) => set(i, 'hasFrame', v, 'Zarge')} label="Zarge vorhanden/geplant" />
            <Check checked={d.isMainEntrance} onChange={(v) => set(i, 'isMainEntrance', v, 'Haupteingang')} label="Haupteingang des Raums" />
          </div>
        </div>
      ))}
      <button className="add" onClick={() => upRoom(room.id, `${room.name}: Tür ergänzt`, (r) => { r.doors.push({ id: newId('t'), wallIndex: 0, s: 20, width: 88.5, height: 201, hinge: 'links', swing: 'innen', hasFrame: true, fireRating: 'keine', leadsTo: '', isMainEntrance: r.doors.length === 0, provenance: 'gemessen' }); })}>＋ Tür</button>
      <Why>Schalter gehören auf die Griffseite neben die Tür (ca. 15 cm neben der Zarge). Hinter einem offenen Türblatt hat keine Dose etwas zu suchen. Brandschutztüren zeigen Brandabschnitte: Jede Leitungsdurchführung braucht dann eine Abschottung.</Why>
    </>
  );
}

export function WindowsStep({ room }: { room: Room }) {
  const wallOpts = room.walls.map((w) => ({ value: String(w.index), label: `W${w.index + 1} – ${wallSideLabel(room, w.index)}` }));
  return (
    <>
      <EditTable rows={room.windows} rowKey={(r) => r.id} empty="Keine Fenster – dann einfach weiter."
        cols={[
          { key: 'wallIndex', label: 'Wand', type: 'select', options: wallOpts },
          { key: 's', label: 'ab linker Ecke', type: 'number' }, { key: 'width', label: 'Breite', type: 'number' },
          { key: 'sill', label: 'Brüstung (über Bezug)', type: 'number' }, { key: 'height', label: 'Höhe', type: 'number' },
          { key: 'status', label: 'künftig', type: 'select', options: opts({ bleibt: 'bleibt', wird_zugemauert: 'wird zugemauert', wird_ersetzt: 'wird ersetzt', neu: 'neu' }) },
          { key: 'lightWell', label: 'Lichtschacht', type: 'check' },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: Fenster ${k}`, (r) => { (r.windows[i] as any)[k] = k === 'wallIndex' ? Number(v) : v; })}
        onRemove={(i) => upRoom(room.id, `${room.name}: Fenster entfernt`, (r) => { r.windows.splice(i, 1); })}
        onAdd={() => upRoom(room.id, `${room.name}: Fenster ergänzt`, (r) => { r.windows.push({ id: newId('f'), wallIndex: 0, s: 50, width: 100, sill: 90, height: 120, status: 'bleibt', lightWell: false, provenance: 'gemessen' }); })}
        addLabel="Fenster" />
      <Why>Unter und neben Fenstern ist oft Platz für Dosen, aber nie in der Öffnung. Bei Fenstern, die zugemauert werden, wird die Fläche wieder nutzbar.</Why>
    </>
  );
}

export function SpecialsStep({ room }: { room: Room }) {
  const wallOpts = room.walls.map((w) => ({ value: String(w.index), label: `W${w.index + 1} – ${wallSideLabel(room, w.index)}` }));
  const pw = room.walls.flatMap((w) => w.preWall.map((p) => ({ ...p, wall: String(w.index), rh: p.height == null })));
  const zones = room.walls.flatMap((w) => w.zones.map((z) => ({ ...z, wall: String(w.index) })));
  const editPw = (i: number, k: string, v: any) => upRoom(room.id, `${room.name}: Vorwand`, (r) => {
    const row = pw[i];
    const list = r.walls[Number(row.wall)].preWall;
    const j = list.findIndex((x) => x.id === row.id);
    if (k === 'wall') { const [it] = list.splice(j, 1); r.walls[Number(v)].preWall.push(it); return; }
    if (k === 'rh') { list[j].height = v ? null : 120; return; }
    (list[j] as any)[k] = v;
  });
  return (
    <>
      <h3>Vorwände</h3>
      <p className="muted small">Eine Vorwand kann abschnittsweise unterschiedlich hoch sein (z. B. Dusche raumhoch, WC und Waschtisch 120 cm). Dosen müssen innerhalb der Vorwand liegen – darüber ist Mauerwerk.</p>
      <EditTable rows={pw} rowKey={(r) => r.id} empty="Keine Vorwand."
        cols={[
          { key: 'wall', label: 'Wand', type: 'select', options: wallOpts }, { key: 'label', label: 'Abschnitt', type: 'text' },
          { key: 'from', label: 'von (cm ab l. Ecke)', type: 'number' }, { key: 'to', label: 'bis', type: 'number' },
          { key: 'rh', label: 'raumhoch', type: 'check' }, { key: 'height', label: 'Höhe', type: 'nullnumber' }, { key: 'depth', label: 'Tiefe', type: 'number' },
          { key: 'construction', label: 'Bauart', type: 'select', options: opts({ trockenbau: 'Trockenbau', installationsregister: 'Installationsregister', holz: 'Holz (z. B. Baffle)', gemauert: 'gemauert' }) },
        ] as Col<any>[]}
        onChange={editPw}
        onRemove={(i) => upRoom(room.id, `${room.name}: Vorwand entfernt`, (r) => { const w = r.walls[Number(pw[i].wall)]; w.preWall = w.preWall.filter((x) => x.id !== pw[i].id); })}
        onAdd={() => upRoom(room.id, `${room.name}: Vorwand ergänzt`, (r) => { r.walls[0].preWall.push({ id: newId('vw'), from: 0, to: 100, height: 120, depth: 20, construction: 'trockenbau', label: '' }); })} addLabel="Vorwand-Abschnitt" />
      <h3>Bereiche ohne Schlitze und Bohrungen</h3>
      <p className="muted small">Kaminwange, Betonsturz, Brandwand oder Stellen mit Leitungen/Rohren in der Wand.</p>
      <EditTable rows={zones} rowKey={(r) => r.id} empty="Keine."
        cols={[
          { key: 'wall', label: 'Wand', type: 'select', options: wallOpts },
          { key: 'kind', label: 'Art', type: 'select', options: opts({ kaminwange: 'Kaminwange', sturz: 'Sturz', brandwand: 'Brandwand', tabu: 'Tabuzone' }) },
          { key: 'from', label: 'von', type: 'number' }, { key: 'to', label: 'bis', type: 'number' },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: Tabuzone`, (r) => {
          const row = zones[i]; const list = r.walls[Number(row.wall)].zones; const j = list.findIndex((x) => x.id === row.id);
          if (k === 'wall') { const [it] = list.splice(j, 1); r.walls[Number(v)].zones.push(it); return; }
          (list[j] as any)[k] = v;
        })}
        onRemove={(i) => upRoom(room.id, `${room.name}: Tabuzone entfernt`, (r) => { const w = r.walls[Number(zones[i].wall)]; w.zones = w.zones.filter((x) => x.id !== zones[i].id); })}
        onAdd={() => upRoom(room.id, `${room.name}: Tabuzone ergänzt`, (r) => { r.walls[0].zones.push({ id: newId('z'), kind: 'tabu', from: 0, to: 50, zFrom: 0, depth: 0, note: '' }); })} addLabel="Bereich" />
      <h3>Heizkörper, Rohre, Schächte, Tore</h3>
      <EditTable rows={room.obstacles} rowKey={(r) => r.id} empty="Keine."
        cols={[
          { key: 'kind', label: 'Art', type: 'select', options: opts({ heizkoerper: 'Heizkörper', rohr: 'Rohr', rohrkasten: 'Rohrkasten', schacht: 'Schacht', stuetze: 'Stütze', tor: 'Tor (geöffnet)', torlaufschiene: 'Torlaufschiene', sonstiges: 'Sonstiges' }) },
          { key: 'label', label: 'Bezeichnung', type: 'text' },
          { key: 'x', label: 'x', type: 'number' }, { key: 'y', label: 'y', type: 'number' }, { key: 'w', label: 'Breite', type: 'number' }, { key: 'd', label: 'Tiefe', type: 'number' },
          { key: 'zFrom', label: 'Höhe von', type: 'number' }, { key: 'zTo', label: 'bis', type: 'nullnumber' },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: Hindernis`, (r) => { (r.obstacles[i] as any)[k] = v; })}
        onRemove={(i) => upRoom(room.id, `${room.name}: Hindernis entfernt`, (r) => { r.obstacles.splice(i, 1); })}
        onAdd={() => upRoom(room.id, `${room.name}: Hindernis ergänzt`, (r) => { r.obstacles.push({ id: newId('h'), kind: 'heizkoerper', label: 'Heizkörper', x: 50, y: 0, w: 100, d: 10, zFrom: 15, zTo: 75, wallIndex: 0, note: '' }); })} addLabel="Hindernis" />
      <Why>Hier landen später keine Dosen und keine Leitungswege. Kaminwangen dürfen nie geschlitzt werden, Brandwände nur mit Abschottung.</Why>
    </>
  );
}

export function FloorStep({ project, room }: { project: Project; room: Room }) {
  const f = room.floor;
  const fb = futureBuildup(room);
  const setF = (text: string, fn: (x: Draft<Room>['floor']) => void) => upRoom(room.id, `${room.name}: ${text}`, (r) => fn(r.floor));
  return (
    <>
      <Field label={`Was kommt künftig noch auf den Boden? (über ${project.settings.heightReference.label})`} hint={`zusammen ${fmt(fb)} cm`}>
        <EditTable rows={f.futureAboveRef} rowKey={(_r, i) => String(i)} cols={[{ key: 'name', label: 'Schicht', type: 'text' }, { key: 'thickness', label: 'cm', type: 'number' }]} empty="Nichts – der Bezug ist schon fertiger Boden."
          onChange={(i, k, v) => setF('Bodenaufbau', (x) => { (x.futureAboveRef[i] as any)[k] = v; })}
          onRemove={(i) => setF('Bodenaufbau', (x) => { x.futureAboveRef.splice(i, 1); })}
          onAdd={() => setF('Bodenaufbau', (x) => { x.futureAboveRef.push({ name: 'Belag', thickness: 1 }); })} addLabel="Schicht" />
      </Field>
      <h3>Darf im Boden geschlitzt werden?</h3>
      <Cards value={f.underfloorHeating ? 'fbh' : f.slotsAllowed ? 'ja' : 'nein'} onChange={(v) => setF('Bodenschlitze', (x) => { x.slotsAllowed = v === 'ja'; x.underfloorHeating = v === 'fbh'; })} options={[
        { value: 'ja', label: 'Ja', hint: 'z. B. Bestands-Estrich, wenn Wände/Decke tabu sind' },
        { value: 'nein', label: 'Nein', hint: 'Leitungen über Wand/Decke' },
        { value: 'fbh', label: 'Fußbodenheizung', hint: 'Bodenschlitze ausgeschlossen' },
      ]} />
      <div className="grid2">
        <Field label="Wie dick ist der vorhandene Estrich? (cm)" hint="an einer Bodendose, Revisionsöffnung oder per Probebohrung messen">
          <NumberInput nullable value={f.existingBelowRef.find((l) => /estrich/i.test(l.name))?.thickness ?? null} onChange={(v) => setF('Estrichdicke', (x) => {
            const i = x.existingBelowRef.findIndex((l) => /estrich/i.test(l.name));
            if (v == null) { if (i >= 0) x.existingBelowRef.splice(i, 1); return; }
            if (i >= 0) x.existingBelowRef[i].thickness = v; else x.existingBelowRef.unshift({ name: 'Estrich (Bestand)', thickness: v });
            if (x.protectedLayerDepth == null) x.protectedLayerDepth = v;
          })} />
        </Field>
      </div>
      {f.slotsAllowed && (
        <div className="grid2">
          <Field label="In welcher Tiefe liegen Folie / Dämmung? (cm ab Bezug)" hint="Probebohrung an unauffälliger Stelle"><NumberInput nullable value={f.protectedLayerDepth} onChange={(v) => setF('Tiefe Folie', (x) => { x.protectedLayerDepth = v; if (v != null && (x.maxSlotDepth === 0 || x.maxSlotDepth > v - 1)) x.maxSlotDepth = Math.max(0, Math.min(2.5, v - 1)); })} /></Field>
          <Field label="Maximale Schlitztiefe (cm)" hint="mind. 1 cm Abstand zur Folie"><NumberInput value={f.maxSlotDepth} onChange={(v) => v != null && setF('Schlitztiefe', (x) => { x.maxSlotDepth = v; })} /></Field>
        </div>
      )}
      <Why>Alle Höhen werden ab dem Bezug gemessen; der Aufbau wird eingerechnet. Bodenschlitze sind eine gute Lösung, wenn Wände nicht waagerecht geschlitzt werden sollen und die Decke tabu ist – aber Folie, Dämmung und Fußbodenheizung dürfen nie angeschnitten werden.</Why>
    </>
  );
}

export function CeilingStep({ room }: { room: Room }) {
  const c = room.ceiling;
  const setC = (text: string, fn: (x: Draft<Room>['ceiling']) => void) => upRoom(room.id, `${room.name}: ${text}`, (r) => fn(r.ceiling));
  return (
    <>
      <h3>Was für eine Decke hat der Raum?</h3>
      <Cards value={c.construction} onChange={(v) => setC('Deckenbauart', (x) => {
        x.construction = v;
        if (v === 'hourdis') { x.slotsAllowed = false; x.drillingAllowed = false; }
        if (v === 'stahlbeton' || v === 'filigran') { x.slotsAllowed = false; x.drillingAllowed = true; }
        if (v === 'abgehaengt' || v === 'holzbalken') { x.slotsAllowed = false; x.drillingAllowed = true; }
      })} options={[
        { value: 'stahlbeton', label: ceilingLabel.stahlbeton, hint: 'massiv, Bohren ja, Schlitzen nein' },
        { value: 'hourdis', label: ceilingLabel.hourdis, hint: 'Hohlsteine – nicht schlitzen, nicht bohren' },
        { value: 'filigran', label: ceilingLabel.filigran, hint: 'Neubau, oft mit Leerrohren' },
        { value: 'holzbalken', label: ceilingLabel.holzbalken, hint: 'Kabel zwischen den Balken' },
        { value: 'abgehaengt', label: ceilingLabel.abgehaengt, hint: 'Hohlraum als Kabelweg' },
        { value: 'unbekannt', label: 'weiß ich nicht', hint: 'wird als offen markiert' },
      ] as { value: Room['ceiling']['construction']; label: string; hint: string }[]} />
      <div className="checks">
        <Check checked={c.slotsAllowed} onChange={(v) => setC('Deckenschlitze', (x) => { x.slotsAllowed = v; })} label="Decke darf geschlitzt werden" />
        <Check checked={c.drillingAllowed} onChange={(v) => setC('Deckenbohrung', (x) => { x.drillingAllowed = v; })} label="Decke darf gebohrt werden" />
      </div>
      <Field label="Hohlraum unter der Decke (Paneele, Abhängung) in cm"><NumberInput value={c.cavityDepth} onChange={(v) => v != null && setC('Deckenhohlraum', (x) => { x.cavityDepth = v; })} /></Field>
      <Why>Die Decke entscheidet, ob Leitungen von oben kommen können. Ist sie tabu (z. B. Hourdis), plant das Programm Wege über Boden, Vorwände oder Aufputz und nutzt vorhandene Deckenauslässe weiter.</Why>
    </>
  );
}

function UsageStep({ project, room }: { project: Project; room: Room }) {
  return (
    <>
      <h3>Wofür wird „{room.name}“ genutzt?</h3>
      <p className="muted small">Die Nutzung bestimmt typische Verbraucher (Leistungsbedarf), eigene Stromkreise, Mindestausstattung, Rauchwarnmelder und Schutzbereiche.</p>
      <RoomTextAi room={room} />
      <RoomTypeCards project={project} room={room} />
      {room.roomType && (
        <>
          <h3>Welche Geräte kommen hier hin?</h3>
          <LoadsEditor room={room} />
        </>
      )}
      <div className="grid2">
        <Field label="Nutzung (frei)"><TextInput value={room.usage} placeholder="z. B. Schlafen, Home-Office" onChange={(v) => upRoom(room.id, `${room.name}: Nutzung`, (r) => { r.usage = v; })} /></Field>
        <Field label="Und vielleicht später einmal?"><TextInput value={room.futureUsage} placeholder="z. B. Kinderzimmer, Fitnessraum" onChange={(v) => upRoom(room.id, `${room.name}: künftige Nutzung`, (r) => { r.futureUsage = v; })} /></Field>
        <Field label="Installationsart in diesem Raum"><Select value={room.installationType} options={opts(installationTypeLabel)} onChange={(v) => v && upRoom(room.id, `${room.name}: Installationsart`, (r) => { r.installationType = v as any; })} /></Field>
        <Field label="Smart Home in diesem Raum"><Select value={room.smartHome} allowEmpty={`wie Projekt (${smartHomeLabel[project.smartHome.enabled ? project.smartHome.system : 'keines']})`} options={opts(smartHomeLabel)} onChange={(v) => upRoom(room.id, `${room.name}: Smart Home`, (r) => { r.smartHome = v as any; })} /></Field>
      </div>
      <Check checked={room.wetRoom} onChange={(v) => upRoom(room.id, `${room.name}: Feuchtraum`, (r) => { r.wetRoom = v; })} label="Bad / Feuchtraum (Schutzbereiche, Feuchtraum-Programm)" />
      {room.futureUsage && <p className="muted small">Tipp: Für die künftige Nutzung lieber jetzt Leerdosen/Leerrohre und eine Reserve-Steckdose mehr vorsehen.</p>}
    </>
  );
}

function FurnitureStep({ project, room }: { project: Project; room: Room }) {
  return (
    <>
      <p className="muted small">Aus Möbeln und Geräten leitet das Programm Auslässe ab (Nachttisch → Steckdose 70 cm, Schreibtisch → Steckdosen + LAN, Kühlschrank → eigene Dose …). Lage x/y ab Nullpunkt.</p>
      {(room.roomType === 'heimkino' || room.theater) && <><h3>Heimkino</h3><TheaterPanel project={project} room={room} /></>}
      <div className="wiz-split">
        <div><EinrichtungTab room={room} wallOpts={room.walls.map((w) => ({ value: String(w.index), label: wallName(room, w.index) }))} /></div>
        <div className="wiz-preview"><RoomPlan project={project} room={room} layers={['moebel', 'beschriftung', 'masse']} /></div>
      </div>
    </>
  );
}

export function ExistingStep({ room }: { room: Room }) {
  return (
    <>
      <p>Gibt es vorhandene Leitungen oder Dosen, die bleiben oder weiterverwendet werden könnten (z. B. Deckenauslass in einer nicht schlitzbaren Decke)?</p>
      <EditTable rows={room.existingCables} rowKey={(r) => r.id} empty="Keine – dann weiter."
        cols={[
          { key: 'label', label: 'Wo?', type: 'text' }, { key: 'cableType', label: 'Leitungstyp', type: 'text' }, { key: 'goesTo', label: 'geht nach', type: 'text' },
          { key: 'condition', label: 'Zustand', type: 'select', options: opts({ unbekannt: 'unbekannt', gut: 'gut', fraglich: 'fraglich', defekt: 'defekt' }) },
          { key: 'reuse', label: 'weiterverwenden?', type: 'select', options: opts({ pruefen: 'prüfen', ja: 'ja', nein: 'nein' }) },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: Bestandsleitung`, (r) => { (r.existingCables[i] as any)[k] = v; })}
        onRemove={(i) => upRoom(room.id, `${room.name}: Bestandsleitung entfernt`, (r) => { r.existingCables.splice(i, 1); })}
        onAdd={() => upRoom(room.id, `${room.name}: Bestandsleitung ergänzt`, (r) => { r.existingCables.push({ id: newId('bl'), label: 'Deckenauslass Mitte', description: '', cableType: 'unbekannt', goesTo: '', condition: 'unbekannt', reuse: 'pruefen', note: '' }); })} addLabel="Bestandsleitung" />
      <Why>Für jede Bestandsleitung entstehen Prüfaufgaben: Zugtest (lose → neue Leitung mit einziehen; fest → messen lassen), Adernzahl und Schutzleiter prüfen, Isolationsmessung durch die Elektrofachkraft.</Why>
    </>
  );
}

