/**
 * Assistent: eine einfache Frage pro Bildschirm, große Kacheln, unten Zurück
 * und Weiter. Statt einer langen Schrittliste gibt es eine Übersicht.
 * Fachdetails bleiben in der Expertenansicht und hinter „Genauer angeben“.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { produce, type Draft } from 'immer';
import {
  Armchair, Bath, BedDouble, BedSingle, Baby, Box, Briefcase, Building, Building2, Car, Check, ChevronLeft, CookingPot, Cpu, DoorOpen, Dumbbell,
  Film, Footprints, Gamepad2, Hammer, Home, House, Layers, LayoutGrid, Lightbulb, Package, Plus, Ruler, Square, Toilet, Trash2, Trees, Upload,
  Utensils, WashingMachine, Wifi, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import type { Project, Room } from '../../core/model/schema';
import { createRectRoom, newId } from '../../core/model/factory';
import { assistantProgress, isDone, questionList, sectionLabel, type Question } from '../../core/wizard/questions';
import { ROOM_TYPES, ROOM_TYPE_INFO, type RoomTypeId } from '../../core/model/roomTypes';
import { loadsForType, kw } from '../../core/planning/loads';
import { routingFeasibility, type RouteOption } from '../../core/planning/feasibility';
import { suggestOutlets } from '../../core/planning/suggest';
import { proposeCircuits, applyCircuitProposal } from '../../core/planning/circuits';
import { runRules } from '../../core/rules/rules';
import { fmt, isRectRoom, roomArea } from '../../core/geometry/room';
import { SWITCH_PROGRAMS } from '../../core/model/catalog';
import { outletKindLabel } from '../../core/model/labels';
import type { Outlet } from '../../core/model/schema';
import { store } from '../store';
import { upRoom } from '../views/RoomView';
import { RoomPlan } from '../components/PlanCanvas';
import { PlanTracer, loadImage } from '../components/PlanTracer';
import { FeasibilityPanel, TheaterPanel, acceptSuggestions } from '../components/Planning';
import { FloorPlanAi, DistributionPhotoAi, AiKeySettings } from '../ai/AiPanels';
import { MeasureFlow } from '../wizard/MeasureFlow';
import { WallKey } from '../components/WallKey';
import { applyLayout, layoutFloor } from '../../core/geometry/layout';
import { renderFloorOverview } from '../../core/render/plan';
import { convexCorners, notchCorner, projectWall } from '../../core/geometry/edit';
import { wallGeoms } from '../../core/geometry/room';
import { BuildingStep, ReferenceStep, InstallationStep, DistributionStep, NetworkStep, WallsStep, CeilingStep, FloorStep, ExistingStep } from '../wizard/Wizard';
import { Chip, Chips, More, Note, NumField, TextField, Tile, Tiles } from './kit';

const up = (text: string, fn: (p: Draft<Project>) => void) => store.update(text, fn);
const OVERVIEW = 'uebersicht';

function setStep(id: string, markDone?: string) {
  store.silent((p) => {
    p.wizard.step = id;
    if (markDone && !p.wizard.done.includes(markDone)) p.wizard.done.push(markDone);
  });
  document.querySelector('.content')?.scrollTo({ top: 0 });
}

export const ROOM_ICON: Record<RoomTypeId, LucideIcon> = {
  wohnen: Armchair, schlafen: BedDouble, kind: Baby, gaeste: BedSingle, kueche: CookingPot, essen: Utensils, bad: Bath, wc: Toilet, flur: Footprints,
  buero: Briefcase, hwr: WashingMachine, heimkino: Film, hobby: Gamepad2, fitness: Dumbbell, keller: Package, technik: Cpu, werkstatt: Wrench, garage: Car,
  abstell: Box, aussen: Trees, sonstiges: Square,
};

/** Kurze Namen für Kacheln und neue Räume. */
export const ROOM_SHORT: Record<RoomTypeId, string> = {
  wohnen: 'Wohnzimmer', schlafen: 'Schlafzimmer', kind: 'Kinderzimmer', gaeste: 'Gästezimmer', kueche: 'Küche', essen: 'Esszimmer', bad: 'Bad', wc: 'WC', flur: 'Flur',
  buero: 'Büro', hwr: 'Waschraum', heimkino: 'Heimkino', hobby: 'Partyraum', fitness: 'Fitness', keller: 'Kellerraum', technik: 'Technik', werkstatt: 'Werkstatt',
  garage: 'Garage', abstell: 'Abstellraum', aussen: 'Garten', sonstiges: 'Anderer Raum',
};

// ===========================================================================

export function Assistant({ project }: { project: Project }) {
  const list = useMemo(() => questionList(project), [project]);
  const pr = assistantProgress(project);
  const atOverview = project.wizard.step === OVERVIEW || !list.some((q) => q.id === project.wizard.step);
  const idx = list.findIndex((q) => q.id === project.wizard.step);
  const q = atOverview ? null : list[idx];

  if (!q) return <Overview project={project} list={list} />;

  const room = q.roomId ? project.rooms.find((r) => r.id === q.roomId) : undefined;
  const sectionQs = list.filter((x) => (q.roomId ? x.roomId === q.roomId : x.section === q.section));
  const posInSection = sectionQs.findIndex((x) => x.id === q.id) + 1;
  const next = () => { const n = list[idx + 1]; setStep(n ? n.id : OVERVIEW, q.id); };
  const back = () => { const b = list[idx - 1]; setStep(b ? b.id : OVERVIEW); };
  const ctxLabel = room ? `${room.name}` : sectionLabel[q.section];

  return (
    <div className="asst">
      <div className="asst-top">
        <button className="small" onClick={() => setStep(OVERVIEW)}><LayoutGrid size={18} aria-hidden /> Übersicht</button>
        <span className="asst-ctx">{ctxLabel}, Frage {posInSection} von {sectionQs.length}</span>
      </div>
      <div className="asst-bar" aria-hidden><span style={{ transform: `scaleX(${pr.done / Math.max(1, pr.total)})` }} /></div>
      <QuestionView key={q.id} project={project} q={q} room={room} next={next} />
      <div className="asst-foot">
        <button onClick={back} aria-label="Zurück"><ChevronLeft size={20} aria-hidden /> Zurück</button>
        <span className="grow" />
        <button className="primary" onClick={next}>{isDone(project, q) ? 'Weiter' : 'Weiter'}</button>
      </div>
    </div>
  );
}

/** Rahmen einer Frage: Titel, ein Satz Hilfe, Antwort, optional Details. */
function Q({ title, hint, children, more, room }: { title: string; hint?: ReactNode; children: ReactNode; more?: ReactNode; room?: Room }) {
  const Icon = room?.roomType ? ROOM_ICON[room.roomType] : undefined;
  return (
    <section className="asst-card" aria-labelledby="frage">
      {room && <div className="asst-room">{Icon && <Icon size={18} aria-hidden />} {room.name}</div>}
      <h1 id="frage">{title}</h1>
      {hint && <p className="asst-hint">{hint}</p>}
      {children}
      {more && <More>{more}</More>}
    </section>
  );
}

// ===========================================================================
// Übersicht
// ===========================================================================

function Overview({ project, list }: { project: Project; list: Question[] }) {
  const pr = assistantProgress(project);
  const first = pr.firstOpen;
  const go = (id: string) => setStep(id);
  const sec = (s: Question['section']) => pr.sections.find((x) => x.section === s)!;
  const firstOf = (s: Question['section']) => (list.find((q) => q.section === s && !isDone(project, q)) ?? list.find((q) => q.section === s))?.id;
  return (
    <div className="asst hub">
      <div className="hub-head">
        <h1>{project.name === 'Neues Projekt' ? 'Dein Projekt' : project.name}</h1>
        <p>{pr.done === 0 ? 'Ein paar einfache Fragen, dann plant das Programm Dosen, Leitungen und Stromkreise.' : `${pr.done} von ${pr.total} Fragen beantwortet.`}</p>
      </div>
      {first && <button className="primary a-big" onClick={() => go(first.id)}>{pr.done === 0 ? 'Los geht’s' : 'Weitermachen'}</button>}

      {(['projekt', 'grundriss'] as const).map((s) => (
        <div key={s} className="hub-section">
          <div className="hub-h"><h2>{sectionLabel[s]}</h2><span className="count">{sec(s).done}/{sec(s).total}</span></div>
          <Tiles cols={1}>
            <Tile icon={s === 'projekt' ? House : Layers} label={s === 'projekt' ? 'Haus, Sicherungskasten, Wünsche' : 'Pläne je Geschoss (optional)'}
              hint={sec(s).done === sec(s).total ? 'Erledigt' : s === 'grundriss' ? 'Ein Foto vom Plan hilft, ist aber kein Muss' : undefined}
              selected={sec(s).done === sec(s).total} onClick={() => { const id = firstOf(s); if (id) go(id); }} />
          </Tiles>
        </div>
      ))}

      <div className="hub-section">
        <div className="hub-h"><h2>Räume</h2><span className="count">{sec('raeume').done}/{sec('raeume').total}</span></div>
        {project.floors.map((f) => {
          const rooms = project.rooms.filter((r) => r.floorId === f.id && r.inScope);
          return (
            <div key={f.id} className="hub-section">
              {project.floors.length > 1 && <span className="a-note">{f.name}</span>}
              <div className="hub-rooms">
                {rooms.map((r) => {
                  const rp = pr.rooms.find((x) => x.roomId === r.id)!;
                  const Icon = r.roomType ? ROOM_ICON[r.roomType] : Square;
                  const open = list.find((q) => q.roomId === r.id && !isDone(project, q)) ?? list.find((q) => q.roomId === r.id);
                  return (
                    <button key={r.id} className={`hub-room ${rp.done === rp.total ? 'is-done' : ''}`} onClick={() => open && go(open.id)}>
                      <Icon size={24} aria-hidden />
                      <span className="name">{r.name}</span>
                      <span className="a-note">{rp.done === rp.total ? 'Fertig' : `${rp.done} von ${rp.total}`}</span>
                      <span className="meter" aria-hidden><span style={{ transform: `scaleX(${rp.done / Math.max(1, rp.total)})` }} /></span>
                    </button>
                  );
                })}
                <button className="hub-room" onClick={() => go(`r.raeume:${f.id}`)}>
                  <Plus size={24} aria-hidden />
                  <span className="name">Räume {rooms.length ? 'ergänzen' : 'anlegen'}</span>
                  <span className="a-note">{f.name}</span>
                </button>
              </div>
              {rooms.length >= 2 && <FloorSketch project={project} floorId={f.id} />}
            </div>
          );
        })}
      </div>

      <div className="hub-section">
        <div className="hub-h"><h2>Vorschläge</h2><span className="count">{sec('vorschlaege').done}/{sec('vorschlaege').total}</span></div>
        <Tiles cols={1}>
          <Tile icon={Zap} label="Dosen, Licht und Stromkreise" hint="Das Programm schlägt vor, du entscheidest" selected={sec('vorschlaege').done === sec('vorschlaege').total} onClick={() => go('v.dosen')} />
          <Tile icon={Check} label="Abschluss" hint="Was noch offen ist, Pläne und Material" selected={sec('fertig').done === sec('fertig').total} onClick={() => go('fertig')} />
        </Tiles>
      </div>
    </div>
  );
}

/** Grundriss des Geschosses aus den angelegten Räumen und ihren Türverbindungen. */
function FloorSketch({ project, floorId }: { project: Project; floorId: string }) {
  const res = useMemo(() => layoutFloor(project, floorId), [project, floorId]);
  const name = (id: string) => project.rooms.find((r) => r.id === id)?.name ?? id;
  const linked = project.rooms.some((r) => r.floorId === floorId && r.doors.some((d) => d.pairDoorId));
  const svg = useMemo(() => renderFloorOverview(project, floorId, { screen: true }), [project, floorId]);
  return (
    <div className="hub-section">
      <div className="a-preview canvas overview" onClick={(e) => { const id = (e.target as Element).closest('[data-room]')?.getAttribute('data-room'); if (id) store.setUi({ view: 'raum', roomId: id }); }} dangerouslySetInnerHTML={{ __html: svg }} />
      {!linked && <Note>Gibst du bei den Türen an, in welchen Raum sie führen, setzt das Programm daraus den Grundriss zusammen.</Note>}
      {linked && res.unconnected.length > 0 && <Note>Noch ohne Türverbindung: {res.unconnected.map(name).join(', ')}.</Note>}
      {res.problems.map((m) => <p key={m} className="mq-issues">{m}</p>)}
      {linked && <button className="small" onClick={() => up('Grundriss aus Türen zusammengesetzt', (p) => { applyLayout(p as Project, floorId); })}>Grundriss aus Türen neu zusammensetzen</button>}
    </div>
  );
}

// ===========================================================================
// Fragen
// ===========================================================================

function QuestionView({ project, q, room, next }: { project: Project; q: Question; room?: Room; next: () => void }) {
  const floor = q.floorId ? project.floors.find((f) => f.id === q.floorId) : undefined;
  /** Vorgabewerte gibt es immer – als gewählt markiert wird erst nach einer Antwort. */
  const answered = isDone(project, q);
  const hv = project.distributions.find((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank');
  /** Antwort speichern und weiter (Einfachauswahl). */
  const pick = (text: string, fn: (p: Draft<Project>) => void) => { up(text, fn); setTimeout(next, 180); };
  const ensureHv = (p: Draft<Project>) => {
    let d = p.distributions.find((x) => x.kind === 'HV' || x.kind === 'Zaehlerschrank');
    if (!d) { p.distributions.push({ id: newId('hv'), name: 'Hauptverteilung (HV)', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'unbekannt', meter: '', freeModules: 0, breakers: [], rcds: [], hasSpd: false, photos: [], note: '' }); d = p.distributions[p.distributions.length - 1]; }
    return d;
  };

  switch (q.key) {
    // --- Projekt -------------------------------------------------------------
    case 'p.art':
      return <Q title="Was hast du vor?">
        <Tiles cols={1}>
          <Tile icon={Building2} label="Neubau" hint="Rohbau, alles frei planbar" selected={answered && project.projectType === 'neubau'} onClick={() => pick('Projektart Neubau', (p) => { p.projectType = 'neubau'; })} />
          <Tile icon={Hammer} label="Alles neu im Bestand" hint="Bestehendes Haus, Elektrik wird komplett erneuert" selected={answered && project.projectType === 'bestand_komplett'} onClick={() => pick('Projektart Bestand', (p) => { p.projectType = 'bestand_komplett'; })} />
          <Tile icon={DoorOpen} label="Einzelne Räume" hint="Keller, Anbau, Einliegerwohnung, Garage" selected={answered && project.projectType === 'teilsanierung'} onClick={() => pick('Projektart Teilsanierung', (p) => { p.projectType = 'teilsanierung'; })} />
        </Tiles>
      </Q>;
    case 'p.name':
      return <Q title="Wie soll das Projekt heißen?" hint="Damit du es später in der Liste wiederfindest.">
        <TextField autoFocus value={project.name === 'Neues Projekt' ? '' : project.name} placeholder="z. B. Keller Musterstraße" onChange={(v) => up('Projektname', (p) => { p.name = v.trim() || 'Neues Projekt'; })} />
        <More label="Optional: KI-Unterstützung"><AiKeySettings /></More>
      </Q>;
    case 'p.gebaeude':
      return <Q title="Was für ein Gebäude ist es?">
        <Tiles cols={2}>
          {([['efh', 'Einfamilienhaus', House], ['dhh', 'Doppelhaushälfte', Home], ['rh', 'Reihenhaus', Building], ['mfh', 'Mehrfamilienhaus', Building2], ['einliegerwohnung', 'Einliegerwohnung', DoorOpen], ['sonstiges', 'Etwas anderes', Square]] as const).map(([v, l, I]) =>
            <Tile key={v} icon={I} label={l} selected={answered && project.buildingType === v} onClick={() => pick(`Gebäudeart ${l}`, (p) => { p.buildingType = v; })} />)}
        </Tiles>
      </Q>;
    case 'p.bundesland':
      return <Q title="In welchem Bundesland?" hint="Davon hängt ab, wo Rauchmelder Pflicht sind.">
        <Chips>
          {([['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']] as const).map(([v, l]) =>
            <Chip key={v} label={l} selected={project.bundesland === v} onClick={() => pick(`Bundesland ${l}`, (p) => { p.bundesland = v; })} />)}
        </Chips>
      </Q>;
    case 'p.geschosse': {
      const FLOORS: [string, number][] = [['Kellergeschoss', -1], ['Erdgeschoss', 0], ['Obergeschoss', 1], ['Dachgeschoss', 2], ['Spitzboden', 3]];
      return <Q title="Welche Geschosse gehören dazu?" hint="Alle, durch die Leitungen laufen, auch das mit dem Sicherungskasten." more={<BuildingStep project={project} />}>
        <Tiles cols={1}>
          {FLOORS.map(([name, lv]) => {
            const f = project.floors.find((x) => x.level === lv);
            const used = f ? project.rooms.some((r) => r.floorId === f.id) : false;
            return <Tile key={name} icon={Layers} label={name} hint={used ? 'Enthält Räume' : undefined} selected={!!f} disabled={!!f && (used || project.floors.length === 1)}
              onClick={() => up(f ? `${name} entfernt` : `${name} angelegt`, (p) => {
                if (f) { p.floors = p.floors.filter((x) => x.id !== f.id); return; }
                p.floors.push({ id: newId('geschoss'), name, level: lv, backgroundOpacity: 0.6, height: lv < 0 ? 250 : 275 });
                p.floors.sort((a, b) => a.level - b.level);
              })} />;
          })}
        </Tiles>
      </Q>;
    }
    case 'p.verlegung':
      return <Q title="Wie sollen die Leitungen meistens liegen?" hint="Gilt als Vorgabe, je Raum änderbar." more={<InstallationStep project={project} />}>
        <Tiles cols={1}>
          <Tile icon={Home} label="Unsichtbar in der Wand" hint="Unterputz, für Wohnräume" selected={answered && project.settings.defaultInstallationType === 'unterputz'} onClick={() => pick('Verlegung Unterputz', (p) => { p.settings.defaultInstallationType = 'unterputz'; })} />
          <Tile icon={Wrench} label="Sichtbar auf der Wand" hint="Im Rohr, für Keller, Garage, Werkstatt" selected={answered && project.settings.defaultInstallationType.startsWith('aufputz')} onClick={() => pick('Verlegung Aufputz', (p) => { p.settings.defaultInstallationType = 'aufputz_rohr'; })} />
          <Tile icon={Layers} label="In Trockenbauwänden" hint="Ständerwerk, Vorsatzschalen" selected={answered && project.settings.defaultInstallationType === 'hohlwand'} onClick={() => pick('Verlegung Hohlwand', (p) => { p.settings.defaultInstallationType = 'hohlwand'; })} />
        </Tiles>
      </Q>;
    case 'p.boden': {
      const ref = project.settings.heightReference.label;
      const set = (label: string, desc: string, buildup: number, text: string) => pick(text, (p) => { p.settings.heightReference.label = label; p.settings.heightReference.description = desc; p.settings.defaultFutureBuildup = buildup; });
      return <Q title="Kommt auf den Fußboden noch etwas drauf?" hint="Damit die Dosen später auf der richtigen Höhe sitzen." more={<ReferenceStep project={project} />}>
        <Tiles cols={1}>
          <Tile icon={Check} label="Nein, der Boden ist fertig" selected={answered && ref === 'OK Fertigfußboden'} onClick={() => set('OK Fertigfußboden', 'Alle Höhen ab fertigem Boden.', 0, 'Boden fertig')} />
          <Tile icon={Layers} label="Nur ein neuer Belag" hint="Vinyl, Parkett, Fliesen: etwa 1 bis 2 cm" selected={answered && ref === 'OK Estrich (Bestand)' && project.settings.defaultFutureBuildup <= 3} onClick={() => set('OK Estrich (Bestand)', 'Alle Höhen ab heutiger Oberkante Estrich. Der künftige Belag wird je Raum eingerechnet.', 1.5, 'Neuer Belag')} />
          <Tile icon={Building2} label="Estrich kommt noch" hint="Neubau: Dämmung, Estrich, Belag, etwa 12 bis 15 cm" selected={answered && ref === 'OK Rohboden'} onClick={() => set('OK Rohboden', 'Alle Höhen ab heutiger Oberkante Rohboden. Der künftige Bodenaufbau wird je Raum eingerechnet.', 13, 'Estrich kommt noch')} />
        </Tiles>
      </Q>;
    }
    case 'p.schalter': {
      const cur = project.settings.switchProgram.manufacturer;
      const BRANDS: [string, string][] = [['Merten', SWITCH_PROGRAMS[0]], ['Gira', SWITCH_PROGRAMS[2]], ['Jung', SWITCH_PROGRAMS[3]], ['Busch-Jaeger', SWITCH_PROGRAMS[4]], ['Berker', SWITCH_PROGRAMS[5]], ['Siemens', SWITCH_PROGRAMS[6]], ['Hager', SWITCH_PROGRAMS[7]]];
      return <Q title="Welche Schalter und Steckdosen?" hint="Bestimmt Rahmen und Einsätze in der Einkaufsliste. Merten ist voreingestellt." more={<InstallationStep project={project} />}>
        <Chips>
          {BRANDS.map(([l, v]) => <Chip key={l} label={l} selected={answered && cur.startsWith(l)} onClick={() => pick(`Schalterprogramm ${l}`, (p) => { p.settings.switchProgram.manufacturer = v; })} />)}
          <Chip label="Später entscheiden" selected={false} onClick={next} />
        </Chips>
      </Q>;
    }
    case 'p.verteilung':
      return <Q title="Wo hängt der Sicherungskasten?" hint="Dort enden alle neuen Leitungen." more={<DistributionStep project={project} />}>
        <Chips>
          {['Keller', 'Flur', 'Hausanschlussraum', 'Garage', 'Treppenhaus', 'Abstellraum'].map((l) => <Chip key={l} label={l} selected={hv?.note === l} onClick={() => pick(`Sicherungskasten: ${l}`, (p) => { ensureHv(p).note = l; })} />)}
        </Chips>
        <TextField label="oder selbst beschreiben" value={hv && !['Keller', 'Flur', 'Hausanschlussraum', 'Garage', 'Treppenhaus', 'Abstellraum'].includes(hv.note) ? hv.note : ''} placeholder="z. B. Keller unter der Treppe" onChange={(v) => up('Sicherungskasten Ort', (p) => { ensureHv(p).note = v; })} />
        {hv && <DistributionPhotoAi project={project} distributionId={hv.id} />}
      </Q>;
    case 'p.platz': {
      const m = hv?.freeModules ?? -1;
      const set = (n: number, l: string) => pick(`Platz im Sicherungskasten: ${l}`, (p) => { ensureHv(p).freeModules = n; });
      return <Q title="Ist im Sicherungskasten noch Platz?" hint="Ein Platz ist so breit wie ein Sicherungsschalter.">
        <Tiles cols={1}>
          <Tile icon={Square} label="Viel Platz" hint="Mindestens eine Reihe frei" selected={answered && m >= 12} onClick={() => set(12, 'viel')} />
          <Tile icon={Square} label="Ein paar Plätze" hint="Etwa 2 bis 6" selected={answered && m > 0 && m < 12} onClick={() => set(4, 'ein paar')} />
          <Tile icon={Square} label="Voll oder weiß ich nicht" hint="Dann plant das Programm mit neuen Plätzen" selected={answered && m === 0} onClick={() => set(0, 'voll/unbekannt')} />
        </Tiles>
      </Q>;
    }
    case 'p.fi': {
      const n = hv?.rcds.filter((r) => r.existing).length ?? -1;
      const set = (count: number) => pick(`Vorhandene FI-Schalter: ${count}`, (p) => {
        const d = ensureHv(p);
        d.rcds = d.rcds.filter((r) => !r.existing);
        for (let i = 0; i < count; i++) d.rcds.push({ id: newId('fi'), label: `FI ${i + 1} (40 A / 30 mA, Typ A)`, ratedCurrent: 40, residualCurrent: 30, type: 'A', poles: 4, existing: true });
      });
      return <Q title="Gibt es schon FI-Schalter?" hint="Breite Schalter mit einer Prüftaste „T“. Ältere Anlagen haben oft keinen.">
        <Tiles cols={2}>
          {[0, 1, 2, 3].map((c) => <Tile key={c} label={c === 0 ? 'Keinen' : c === 3 ? '3 oder mehr' : String(c)} selected={answered && n === c} onClick={() => set(c)} />)}
        </Tiles>
      </Q>;
    }
    case 'p.smart':
      return <Q title="Soll Smart Home mit rein?" hint="Licht, Rollläden und Heizung per App oder Automatik.">
        <Tiles cols={1}>
          <Tile icon={Lightbulb} label="Nein, klassisch" hint="Leitungen werden trotzdem vorbereitet" selected={!project.smartHome.enabled && project.wizard.done.includes('p.smart')} onClick={() => pick('Smart Home nein', (p) => { p.smartHome.enabled = false; })} />
          <Tile icon={Wifi} label="Ja" hint="System wählst du als Nächstes" selected={project.smartHome.enabled} onClick={() => pick('Smart Home ja', (p) => { p.smartHome.enabled = true; if (p.smartHome.system === 'keines') p.smartHome.system = 'home_assistant'; })} />
        </Tiles>
      </Q>;
    case 'p.smartsystem':
      return <Q title="Welches System?" hint="Weißt du es noch nicht, nimm Home Assistant: das lässt die meisten Wege offen.">
        <Tiles cols={1}>
          {([['home_assistant', 'Home Assistant', 'Offen, verbindet fast alles'], ['knx', 'KNX', 'Kabelgebunden, eigene Busleitung'], ['shelly', 'Shelly', 'Funk-Module hinter Schaltern'], ['zigbee', 'Zigbee', 'Funk, viele Hersteller'], ['matter_thread', 'Matter / Thread', 'Neuer Funkstandard'], ['homematic_ip', 'Homematic IP', 'Funk, verbreitet in DE'], ['gemischt', 'Gemischt', 'Mehrere Systeme']] as const).map(([v, l, h]) =>
            <Tile key={v} icon={Cpu} label={l} hint={h} selected={answered && project.smartHome.system === v} onClick={() => pick(`Smart Home ${l}`, (p) => { p.smartHome.system = v; p.smartHome.busCableToSwitches = v === 'knx'; })} />)}
        </Tiles>
      </Q>;
    case 'p.netzwerk':
      return <Q title="Wo soll der Internet-Router hin?" hint="Jede Netzwerkdose bekommt ein Kabel dorthin." more={<NetworkStep project={project} />}>
        <Chips>
          {['Technikraum', 'Keller', 'Flur', 'Abstellraum', 'Büro', 'Wohnzimmer'].map((l) => <Chip key={l} label={l} selected={project.network.rackLocation === l} onClick={() => pick(`Router: ${l}`, (p) => { p.network.rackLocation = l; })} />)}
        </Chips>
      </Q>;
    // --- Grundriss -----------------------------------------------------------
    case 'g.plan':
      return floor ? <PlanQuestion project={project} floorId={floor.id} next={next} /> : null;

    // --- Räume anlegen -------------------------------------------------------
    case 'r.raeume':
      return floor ? <RoomsQuestion project={project} floorId={floor.id} /> : null;

    // --- je Raum ----------------------------------------------------------------
    case 'raum.typ':
      return room ? <Q room={room} title="Wofür wird der Raum genutzt?" hint="Davon hängen Geräte, Leistung und Mindestausstattung ab.">
        <Tiles cols={3} stacked>
          {ROOM_TYPES.map((t) => <Tile key={t} icon={ROOM_ICON[t]} label={ROOM_SHORT[t]} selected={room.roomType === t} onClick={() => { setRoomTypeSilently(project, room, t); setTimeout(next, 180); }} />)}
        </Tiles>
      </Q> : null;
    case 'raum.masse':
      return room ? <SizeQuestion project={project} room={room} next={next} /> : null;
    case 'raum.oeffnungen':
      return room ? <OpeningsQuestion project={project} room={room} /> : null;
    case 'raum.waende': {
      if (!room) return null;
      const mats = new Set(room.walls.map((w) => w.material));
      const cur = mats.size === 1 ? [...mats][0] : undefined;
      const M: [string, string, string, string][] = [
        ['ziegel', 'Ziegel', 'Rot, innen mit Löchern', 'oklch(55% 0.12 35)'],
        ['kalksandstein', 'Kalksandstein', 'Weiß, glatt, schwer', 'oklch(92% 0.01 90)'],
        ['beton', 'Beton', 'Grau, sehr hart', 'oklch(62% 0.005 260)'],
        ['porenbeton', 'Porenbeton', 'Weiß, leicht, porös (Ytong)', 'oklch(96% 0.005 90)'],
        ['bims', 'Bims', 'Grau, grob, leicht', 'oklch(70% 0.01 80)'],
        ['trockenbau', 'Trockenbau', 'Klingt hohl beim Klopfen', 'oklch(88% 0.02 230)'],
        ['holz', 'Holz', 'Holzständer oder Blockbau', 'oklch(65% 0.08 65)'],
        ['unbekannt', 'Weiß ich nicht', 'Der Elektriker prüft vor Ort', 'transparent'],
      ];
      return <Q room={room} title="Woraus sind die Wände?" hint="Wenn es mehrere sind: das, was überwiegt." more={<WallsStep room={room} />}>
        <Tiles cols={2}>
          {M.map(([v, l, h, sw]) => <Tile key={v} swatch={sw} label={l} hint={h} selected={answered && cur === v} onClick={() => { upRoom(room.id, `${room.name}: Wände ${l}`, (r) => { r.walls.forEach((w) => { w.material = v as any; }); }); setTimeout(next, 180); }} />)}
        </Tiles>
      </Q>;
    }
    case 'raum.decke': {
      if (!room) return null;
      const c = room.ceiling.construction;
      const set = (v: Room['ceiling']['construction'], l: string, fn: (x: Draft<Room>['ceiling']) => void) => { upRoom(room.id, `${room.name}: Decke ${l}`, (r) => { r.ceiling.construction = v; fn(r.ceiling); }); setTimeout(next, 180); };
      return <Q room={room} title="Was für eine Decke hat der Raum?" more={<CeilingStep room={room} />}>
        <Tiles cols={1}>
          <Tile icon={Square} label="Betondecke" hint="Glatt und massiv, Bohren geht" selected={answered && (c === 'stahlbeton' || c === 'filigran')} onClick={() => set('stahlbeton', 'Beton', (x) => { x.slotsAllowed = false; x.drillingAllowed = true; })} />
          <Tile icon={Layers} label="Hohlkörperdecke" hint="Hohle Steine (Hourdis), nicht schlitzen" selected={answered && c === 'hourdis'} onClick={() => set('hourdis', 'Hohlkörper', (x) => { x.slotsAllowed = false; x.drillingAllowed = true; })} />
          <Tile icon={Hammer} label="Holzbalkendecke" hint="Altbau, Balken mit Dielen" selected={answered && c === 'holzbalken'} onClick={() => set('holzbalken', 'Holzbalken', (x) => { x.slotsAllowed = false; x.drillingAllowed = true; })} />
          <Tile icon={Layers} label="Abgehängt oder verkleidet" hint="Gipskarton, Paneele: Platz für Kabel" selected={answered && c === 'abgehaengt'} onClick={() => set('abgehaengt', 'abgehängt', (x) => { x.cavityDepth = Math.max(x.cavityDepth, 10); x.drillingAllowed = true; })} />
          <Tile icon={Square} label="Weiß ich nicht" selected={c === 'unbekannt' && isDone(project, { id: `raum:${room.id}:decke`, key: 'raum.decke', section: 'raeume' })} onClick={() => set('unbekannt', 'unbekannt', () => {})} />
        </Tiles>
      </Q>;
    }
    case 'raum.fbh': {
      if (!room) return null;
      const set = (v: boolean, l: string) => { upRoom(room.id, `${room.name}: Fußbodenheizung ${l}`, (r) => { r.floor.underfloorHeating = v; if (v) r.floor.slotsAllowed = false; }); setTimeout(next, 180); };
      const done = isDone(project, { id: `raum:${room.id}:fbh`, key: 'raum.fbh', section: 'raeume' });
      return <Q room={room} title="Gibt es eine Fußbodenheizung?" hint="Dann wird im Boden auf keinen Fall geschlitzt." more={<FloorStep project={project} room={room} />}>
        <Tiles cols={2}>
          <Tile label="Ja" selected={done && room.floor.underfloorHeating} onClick={() => set(true, 'ja')} />
          <Tile label="Nein" selected={done && !room.floor.underfloorHeating} onClick={() => set(false, 'nein')} />
        </Tiles>
      </Q>;
    }
    case 'raum.leitungsweg':
      return room ? <RouteQuestion project={project} room={room} next={next} /> : null;
    case 'raum.geraete':
      return room ? <DevicesQuestion project={project} room={room} /> : null;
    case 'raum.bestand': {
      if (!room) return null;
      return <Q room={room} title="Gibt es alte Dosen oder Leitungen, die bleiben?" more={<ExistingStep room={room} />}>
        <Tiles cols={2}>
          <Tile label="Nein, alles neu" onClick={next} selected={false} />
          <Tile label="Ja" hint="Unter „Genauer angeben“ eintragen" onClick={() => {}} selected={false} />
        </Tiles>
      </Q>;
    }
    case 'raum.check':
      return room ? <RoomCheck project={project} room={room} next={next} /> : null;

    // --- Vorschläge -------------------------------------------------------------
    case 'v.dosen':
      return <OutletsQuestion project={project} />;
    case 'v.vorhanden':
      return <ExistingQuestion project={project} />;
    case 'v.kreise':
      return <CircuitsQuestion project={project} />;
    case 'fertig':
      return <FinishQuestion project={project} />;
  }
  return null;
}

// ---------------------------------------------------------------------------

function setRoomTypeSilently(project: Project, room: Room, type: RoomTypeId) {
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

function PlanQuestion({ project, floorId, next }: { project: Project; floorId: string; next: () => void }) {
  const fi = project.floors.findIndex((f) => f.id === floorId);
  const floor = project.floors[fi];
  const [err, setErr] = useState('');
  const upload = async (file: File) => {
    setErr('');
    try {
      const img = await loadImage(file);
      up(`Grundriss für ${floor.name} hochgeladen`, (p) => { const fl = p.floors[fi]; fl.backgroundPlan = img.dataUrl; fl.backgroundSize = { w: img.w, h: img.h }; fl.backgroundScale = undefined; });
    } catch (e) { setErr((e as Error).message); }
  };
  const fileInput = (label: string, primary?: boolean) => (
    <label className={`filebtn a-big ${primary ? '' : ''}`}><Upload size={20} aria-hidden /> {label}
      <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </label>
  );
  if (!floor.backgroundPlan) {
    return <Q title={`Hast du einen Grundriss vom ${floor.name}?`} hint="Ein Foto vom Bauplan reicht. Ohne Plan geht es auch, dann fragt das Programm die Maße ab.">
      {fileInput('Foto oder Bild hochladen', true)}
      <button className="a-big" onClick={next}>Nein, ohne Plan weiter</button>
      {err && <p className="sev-fehler">{err}</p>}
    </Q>;
  }
  if (!floor.backgroundScale) {
    return <Q title="Wie groß ist der Plan in echt?" hint="Tippe Anfang und Ende eines Maßes an, das im Plan steht, zum Beispiel eine Wandlänge. Zum genauen Treffen hineinzoomen.">
      <PlanTracer floor={floor} rooms={project.rooms.filter((r) => r.floorId === floor.id)} mode="kalibrieren"
        onCalibrate={(sc) => { up(`Maßstab ${floor.name}`, (p) => { p.floors[fi].backgroundScale = sc; }); }} />
      <button className="small" onClick={() => up('Grundriss entfernt', (p) => { const fl = p.floors[fi]; fl.backgroundPlan = undefined; fl.backgroundSize = undefined; })}>Anderes Bild nehmen</button>
    </Q>;
  }
  return <Q title={`Grundriss ${floor.name}`} hint="Der Plan ist eingelesen. Räume legst du gleich an und kannst sie darauf einzeichnen.">
    <PlanTracer floor={floor} rooms={project.rooms.filter((r) => r.floorId === floor.id)} mode="ansehen" />
    <FloorPlanAi project={project} floorId={floor.id} />
    {fileInput('Anderes Bild')}
  </Q>;
}

function RoomsQuestion({ project, floorId }: { project: Project; floorId: string }) {
  const floor = project.floors.find((f) => f.id === floorId)!;
  const rooms = project.rooms.filter((r) => r.floorId === floorId);
  const [measuring, setMeasuring] = useState(false);
  const add = (t: RoomTypeId) => {
    const info = ROOM_TYPE_INFO[t];
    const base = ROOM_SHORT[t];
    const same = project.rooms.filter((r) => r.name === base || r.name.startsWith(`${base} `)).length;
    const name = same ? `${base} ${same + 1}` : base;
    const fb = project.settings.defaultFutureBuildup;
    const room = createRectRoom({
      id: newId('raum'), floorId, name, width: 400, depth: 300, height: Math.max(200, (floor.height ?? 275) - 25), provenance: 'annahme',
      installationType: info.installation ?? project.settings.defaultInstallationType,
      floor: fb ? { futureAboveRef: [{ name: 'Bodenaufbau (Vorgabe)', thickness: fb }] } : {},
    });
    up(`Raum ${name} angelegt`, (p) => {
      p.rooms.push({ ...room, roomType: t, usage: info.label, wetRoom: !!info.wetRoom, loads: loadsForType(t) } as any);
      p.wizard.done.push(`raum:${room.id}:typ`);
    });
  };
  return <Q title={`Welche Räume gibt es im ${floor.name}?`} hint="Tippe jeden Raum einmal an. Zwei Kinderzimmer: zweimal tippen.">
    <Tiles cols={3} stacked>
      {ROOM_TYPES.map((t) => {
        const n = rooms.filter((r) => r.roomType === t).length;
        return <Tile key={t} icon={ROOM_ICON[t]} label={ROOM_SHORT[t]} badge={n ? String(n) : undefined} selected={n > 0} onClick={() => add(t)} />;
      })}
    </Tiles>
    {rooms.length > 0 && (
      <ul className="a-list" aria-label="Angelegte Räume">
        {rooms.map((r) => {
          const Icon = r.roomType ? ROOM_ICON[r.roomType] : Square;
          return (
            <li key={r.id}>
              <Icon size={20} aria-hidden />
              <span className="grow"><TextField value={r.name} onChange={(v) => v.trim() && upRoom(r.id, `Raum umbenannt in ${v}`, (x) => { x.name = v.trim(); })} /></span>
              <button className="icon" aria-label={`${r.name} entfernen`} onClick={() => up(`Raum ${r.name} entfernt`, (p) => { p.rooms = p.rooms.filter((x) => x.id !== r.id); })}><Trash2 size={18} aria-hidden /></button>
            </li>
          );
        })}
      </ul>
    )}
    <button className="a-big" onClick={() => setMeasuring(true)}><Ruler size={20} aria-hidden /> Raum direkt vor Ort aufmessen</button>
    {measuring && <MeasureFlow project={project} floorId={floorId} onClose={() => setMeasuring(false)} />}
  </Q>;
}

function SizeQuestion({ project, room, next }: { project: Project; room: Room; next: () => void }) {
  const [measuring, setMeasuring] = useState(false);
  const [tracing, setTracing] = useState(false);
  const floor = project.floors.find((f) => f.id === room.floorId)!;
  const rect = isRectRoom(room);
  const setDim = (k: 'w' | 'd' | 'h', v: number | null) => {
    if (!v || v < 30) return;
    upRoom(room.id, `${room.name}: ${k === 'h' ? 'Höhe' : k === 'w' ? 'Länge' : 'Breite'} ${v} cm`, (r) => {
      if (k === 'h') r.height = v;
      else if (k === 'w') { r.polygon[1].x = v; r.polygon[2].x = v; } else { r.polygon[2].y = v; r.polygon[3].y = v; }
      r.provenance = 'gemessen';
    });
  };
  return <Q room={room} title="Wie groß ist der Raum?" hint="Innen gemessen, von Wand zu Wand.">
    {rect && <button className="primary a-big" onClick={() => setMeasuring(true)}><Ruler size={20} aria-hidden /> Schritt für Schritt aufmessen</button>}
    {rect && <Note>Mit Türen und Fenstern, ideal am Handy vor Ort. Oder schnell eintragen:</Note>}
    <div className="a-nums">
      {rect && <NumField label="Wand 1, cm" unit="" value={room.polygon[1].x} onChange={(v) => setDim('w', v)} />}
      {rect && <NumField label="Wand 2, cm" unit="" value={room.polygon[2].y} onChange={(v) => setDim('d', v)} />}
      <NumField label="Höhe, cm" unit="" value={room.height} onChange={(v) => setDim('h', v)} />
    </div>
    {!rect && <Note>Der Raum hat {room.polygon.length} Ecken ({fmt(roomArea(room), 1)} m²).</Note>}
    {!rect && <button className="a-big" onClick={() => setMeasuring(true)}><Ruler size={20} aria-hidden /> Neu aufmessen (Form wird neu erfasst)</button>}
    <NotchEditor room={room} />
    {floor.backgroundScale && <button className="small" onClick={() => setTracing(!tracing)}>{tracing ? 'Plan schließen' : 'Im Grundriss einzeichnen'}</button>}
    {tracing && <PlanTracer floor={floor} rooms={project.rooms.filter((r) => r.floorId === floor.id)} mode="raum" highlightRoomId={room.id}
      onRect={(rc) => { upRoom(room.id, `${room.name}: Lage aus Grundriss`, (r) => { r.originOnFloor = { x: rc.x, y: rc.y }; r.rotation = 0; r.placedBy = 'plan'; if (isRectRoom(r as Room)) r.polygon = [{ x: 0, y: 0 }, { x: rc.w, y: 0 }, { x: rc.w, y: rc.d }, { x: 0, y: rc.d }]; r.provenance = 'aus_plan'; }); setTracing(false); }} />}
    <div className="a-preview"><RoomPlan project={project} room={room} layers={['moebel', 'masse']} /></div>
    {measuring && <MeasureFlow project={project} floorId={room.floorId} room={room} fresh={!rect} onClose={(id) => {
      setMeasuring(false);
      if (id) { store.silent((p) => { for (const k of ['oeffnungen']) { const qid = `raum:${room.id}:${k}`; if (!p.wizard.done.includes(qid)) p.wizard.done.push(qid); } }); next(); }
    }} />}
  </Q>;
}

/** Kamin, Schacht, Pfeiler: in einer Ecke aussparen oder mitten an einer Wand. Wirkt sofort, Rückgängig mit ↶. */
export function NotchEditor({ room }: { room: Room }) {
  const [mode, setMode] = useState<'ecke' | 'wand' | null>(null);
  const [what, setWhat] = useState<'kamin' | 'schacht' | 'vorsprung'>('kamin');
  const corners = convexCorners(room);
  const geoms = wallGeoms(room);
  const [corner, setCorner] = useState<number | null>(null);
  const [wallI, setWallI] = useState<number | null>(null);
  const [a, setA] = useState<number | null>(50);
  const [b, setB] = useState<number | null>(40);
  const [from, setFrom] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const zone = what === 'kamin' ? 'kaminwange' as const : 'tabu' as const;
  const label = { kamin: 'Kamin', schacht: 'Schacht', vorsprung: 'Pfeiler' }[what];
  const existing = room.walls.filter((w) => /kamin|vorsprung/i.test(w.label)).length;
  const c = corners.find((x) => x.vertex === corner);
  const apply = () => {
    setErr('');
    try {
      const next = mode === 'ecke' && c ? notchCorner(room, c.vertex, a ?? 0, b ?? 0, zone) : mode === 'wand' && wallI != null ? projectWall(room, wallI, from ?? 0, a ?? 0, b ?? 0, zone) : null;
      if (!next) { setErr(mode === 'ecke' ? 'Bitte eine Ecke wählen.' : 'Bitte eine Wand wählen.'); return; }
      upRoom(room.id, `${room.name}: ${label} ${mode === 'ecke' ? 'in der Ecke' : 'an der Wand'} eingetragen`, (r) => { Object.assign(r, JSON.parse(JSON.stringify(next))); });
      setMode(null); setCorner(null); setWallI(null);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="a-more is-open">
      <p className="a-num-label">Kamin, Schacht oder Vorsprung?{existing ? ` ${existing} Wandfläche${existing === 1 ? '' : 'n'} am Vorsprung eingetragen.` : ''}</p>
      {!mode && <Tiles cols={2}>
        <Tile icon={Square} label="In einer Ecke" hint="z. B. Kamin in der Raumecke" onClick={() => setMode('ecke')} />
        <Tile icon={Layers} label="Mitten an einer Wand" hint="Pfeiler, Schacht, Kamin" onClick={() => setMode('wand')} />
      </Tiles>}
      {mode && <>
        <WallKey room={room} highlight={mode === 'wand' ? wallI ?? undefined : c?.wallIn} onPick={mode === 'wand' ? setWallI : undefined} />
        <Chips>{(['kamin', 'schacht', 'vorsprung'] as const).map((w) => <Chip key={w} label={{ kamin: 'Kamin', schacht: 'Schacht', vorsprung: 'Pfeiler / Vorsprung' }[w]} selected={what === w} onClick={() => setWhat(w)} />)}</Chips>
        {mode === 'ecke'
          ? <Chips>{corners.map((x) => <Chip key={x.vertex} label={`Ecke Wand ${x.wallIn + 1} / ${x.wallOut + 1}`} selected={corner === x.vertex} onClick={() => setCorner(x.vertex)} />)}</Chips>
          : <Chips>{geoms.map((g) => <Chip key={g.index} label={`Wand ${g.index + 1} (${fmt(g.length, 0)})`} selected={wallI === g.index} onClick={() => setWallI(g.index)} />)}</Chips>}
        <div className="a-nums">
          {mode === 'wand' && <NumField label="Ab linker Ecke, cm" unit="" value={from} onChange={setFrom} />}
          <NumField label={mode === 'ecke' ? `Entlang Wand ${c ? c.wallIn + 1 : '…'}, cm` : 'Breite, cm'} unit="" value={a} onChange={setA} />
          <NumField label={mode === 'ecke' ? `Entlang Wand ${c ? c.wallOut + 1 : '…'}, cm` : 'Tiefe in den Raum, cm'} unit="" value={b} onChange={setB} />
        </div>
        {err && <p className="mq-issues">{err}</p>}
        <div className="a-chips">
          <button className="primary" onClick={apply}><Check size={18} aria-hidden /> Eintragen</button>
          <button onClick={() => { setMode(null); setErr(''); }}>Abbrechen</button>
        </div>
        <Note>Die Wände am Vorsprung werden Tabuzone: dort wird nicht geschlitzt. Rückgängig mit ↶.</Note>
      </>}
    </div>
  );
}

function OpeningsQuestion({ project, room }: { project: Project; room: Room }) {
  const [open, setOpen] = useState(false);
  const items = [
    ...room.doors.map((d) => ({ id: d.id, label: `${d.hasFrame ? 'Tür' : d.width > 200 ? 'Tor' : 'Durchgang'}${d.leadsTo ? ` zu ${d.leadsTo}` : ''}${d.pairDoorId ? ' (verknüpft)' : ''}`, where: `Wand ${d.wallIndex + 1}, ${fmt(d.s, 0)} cm ab links, ${fmt(d.width, 0)} cm breit` })),
    ...room.windows.map((w) => ({ id: w.id, label: 'Fenster', where: `Wand ${w.wallIndex + 1}, ${fmt(w.s, 0)} cm ab links, ${fmt(w.width, 0)} cm breit` })),
  ];
  return <Q room={room} title="Welche Türen und Fenster hat der Raum?" hint="Wo die Tür ist, kommen die Schalter hin.">
    {items.length > 0
      ? <ul className="a-list">{items.map((x) => <li key={x.id}><DoorOpen size={20} aria-hidden /><span className="grow"><b>{x.label}</b><div className="a-list-sub">{x.where}</div></span></li>)}</ul>
      : <Note>Noch keine eingetragen.</Note>}
    <button className="primary a-big" onClick={() => setOpen(true)}><Plus size={20} aria-hidden /> {items.length ? 'Ändern oder ergänzen' : 'Tür oder Fenster eintragen'}</button>
    <div className="a-preview"><RoomPlan project={project} room={room} layers={['moebel', 'masse']} /></div>
    {open && <MeasureFlow project={project} floorId={room.floorId} room={room} startAt="liste" onClose={() => setOpen(false)} />}
  </Q>;
}

const ROUTE_TEXT: Record<RouteOption, [string, string, LucideIcon]> = {
  decke: ['Über die Decke', 'Hohlraum oder Schlitz in der Decke', Layers],
  boden: ['Im Fußboden', 'Schlitz im Estrich, Wände bleiben heil', Footprints],
  decke_abhaengen: ['Decke abhängen', 'Neue Decke mit Platz für Kabel', Layers],
  sockelleiste: ['Kabelkanal an der Fußleiste', 'Wenig Dreck, kurze Wege zu den Dosen', Square],
  wand_waagerecht: ['Schlitze oben in der Wand', 'Nur wenn die Statik es erlaubt', Hammer],
  aufputz: ['Sichtbar auf der Wand', 'Rohr oder Kanal, schnell und günstig', Wrench],
};

function RouteQuestion({ project, room, next }: { project: Project; room: Room; next: () => void }) {
  const f = routingFeasibility(project, room);
  const strategyOf: Record<RouteOption, Room['routing']['strategy']> = { decke: 'decke', boden: 'boden', decke_abhaengen: 'decke', sockelleiste: 'sockelleiste', wand_waagerecht: 'wand_waagerecht', aufputz: 'aufputz' };
  const chosen: string | undefined = room.routingOptions.answered ? (room.routing.strategy === 'decke' && room.routingOptions.ceilingSuspend === 'ja' ? 'decke_abhaengen' : room.routing.strategy) : undefined;
  const choose = (o: RouteOption) => {
    upRoom(room.id, `${room.name}: Leitungsweg ${ROUTE_TEXT[o][0]}`, (r) => {
      r.routing.strategy = strategyOf[o];
      if (o === 'decke_abhaengen') r.routingOptions.ceilingSuspend = 'ja';
      if (o === 'aufputz') r.routingOptions.surfaceAccepted = 'ja';
      if (o === 'sockelleiste') r.routingOptions.skirtingAccepted = 'ja';
      r.routingOptions.answered = true;
    });
    setTimeout(next, 180);
  };
  const usable = f.options.filter((o) => o.verdict !== 'nein');
  return <Q room={room} title="Wie sollen die Kabel zu den Dosen kommen?" hint="Das Programm hat aus Decke, Boden und Wänden berechnet, was geht." more={<FeasibilityPanel project={project} room={room} compact />}>
    <Tiles cols={1}>
      {usable.map((o) => {
        const [l, h, I] = ROUTE_TEXT[o.option];
        const rec = f.recommended?.option === o.option;
        return <Tile key={o.option} icon={I} label={l} hint={h} badge={rec ? 'Empfohlen' : o.verdict === 'bedingt' ? 'Mit Vorbehalt' : undefined} selected={chosen === o.option} onClick={() => choose(o.option)} />;
      })}
    </Tiles>
    {f.options.some((o) => o.verdict === 'nein') && <Note>Nicht möglich: {f.options.filter((o) => o.verdict === 'nein').map((o) => ROUTE_TEXT[o.option][0]).join(', ')}.</Note>}
  </Q>;
}

function DevicesQuestion({ project, room }: { project: Project; room: Room }) {
  if (!room.roomType) return <Q room={room} title="Welche Geräte kommen in den Raum?"><Note>Zuerst die Nutzung des Raums wählen.</Note></Q>;
  const all = loadsForType(room.roomType, false);
  const has = (label: string) => room.loads.some((l) => l.label === label);
  const toggle = (label: string) => upRoom(room.id, `${room.name}: ${has(label) ? 'ohne' : 'mit'} ${label}`, (r) => {
    if (r.loads.some((l) => l.label === label)) r.loads = r.loads.filter((l) => l.label !== label);
    else { const l = all.find((x) => x.label === label); if (l) r.loads.push(l as any); }
  });
  const total = room.loads.reduce((s, l) => s + l.power, 0);
  return <Q room={room} title="Welche Geräte kommen hier hin?" hint="Für Großgeräte plant das Programm eigene Anschlüsse und Stromkreise."
    more={<>{room.roomType === 'heimkino' && <TheaterPanel project={project} room={room} />}<button className="small" onClick={() => store.setUi({ view: 'raum', roomId: room.id, tab: 'einrichtung' })}>Möbel und eigene Geräte in der Expertenansicht</button></>}>
    <Tiles cols={1}>
      {all.map((l) => <Tile key={l.label} icon={Zap} label={l.label} hint={kw(l.power)} selected={has(l.label)} onClick={() => toggle(l.label)} />)}
    </Tiles>
    <Note>Zusammen {kw(total)}.</Note>
  </Q>;
}

function RoomCheck({ project, room, next }: { project: Project; room: Room; next: () => void }) {
  const f = runRules(project, { roomId: room.id }).findings.filter((x) => x.severity === 'fehler' || x.severity === 'warnung');
  return <Q room={room} title={`So sieht ${room.name} aus`}>
    <div className="a-preview"><RoomPlan project={project} room={room} layers={['moebel', '230v', 'licht', 'daten', 'masse']} /></div>
    <div className="a-facts">
      <div><span>Fläche</span><b className="a-figure">{fmt(roomArea(room), 1)} m²</b></div>
      <div><span>Türen, Fenster</span><b className="a-figure">{room.doors.length + room.windows.length}</b></div>
      <div><span>Geräte</span><b className="a-figure">{room.loads.length}</b></div>
    </div>
    {f.length > 0 && <Note>{f.length} Punkt{f.length === 1 ? '' : 'e'} zum Prüfen, mit Lösungsvorschlägen in der Raumansicht.</Note>}
    <Tiles cols={2}>
      <Tile icon={Check} label="Passt so" selected={room.confirmed} onClick={() => { upRoom(room.id, `${room.name}: bestätigt`, (r) => { r.confirmed = true; }); setTimeout(next, 180); }} />
      <Tile icon={Wrench} label="Genauer ansehen" onClick={() => store.setUi({ view: 'raum', roomId: room.id, tab: 'zusammenfassung' })} />
    </Tiles>
  </Q>;
}

function OutletsQuestion({ project }: { project: Project }) {
  const rooms = project.rooms.filter((r) => r.inScope);
  const per = rooms.map((r) => ({ r, list: suggestOutlets(project, r) }));
  const total = per.reduce((s, x) => s + x.list.length, 0);
  const placed = rooms.reduce((s, r) => s + r.outlets.length, 0);
  const takeAll = () => { for (const { r } of per) { const cur = store.getState().project!.rooms.find((x) => x.id === r.id)!; const l = suggestOutlets(store.getState().project!, cur); if (l.length) acceptSuggestions(cur, l); } };
  return <Q title="Dosen, Schalter und Licht" hint="Das Programm setzt Schalter neben die Türen, Licht, Rauchmelder und Steckdosen nach Nutzung und Geräten.">
    <div className="a-facts">
      <div><span>Neue Vorschläge</span><b className="a-figure">{total}</b></div>
      <div><span>Schon geplant</span><b className="a-figure">{placed}</b></div>
    </div>
    {total > 0
      ? <button className="primary a-big" onClick={takeAll}><Check size={20} aria-hidden /> Alle {total} übernehmen</button>
      : <Note>Alles übernommen. Verschieben kannst du jede Dose in der Raumansicht.</Note>}
    {per.filter((x) => x.list.length).length > 0 && <ul className="a-list">
      {per.filter((x) => x.list.length).map(({ r, list }) => (
        <li key={r.id}>
          <span className="grow"><b>{r.name}</b><div className="a-list-sub">{list.length} Vorschläge</div></span>
          <button className="small" onClick={() => store.setUi({ view: 'raum', roomId: r.id, tab: 'auslaesse' })}>Einzeln ansehen</button>
        </li>
      ))}
    </ul>}
  </Q>;
}

/** Große Anschlüsse zuerst: daran entscheidet sich, ob neu geplant wird. */
const BIG_KINDS: Outlet['kind'][] = ['festanschluss', 'anschlussdose', 'herd', 'starkstrom'];

function ExistingQuestion({ project }: { project: Project }) {
  const rooms = project.rooms.filter((r) => r.inScope && r.outlets.some((o) => o.status === 'neu' || o.status === 'bestand_bleibt'));
  const toggle = (room: Room, o: Outlet) => upRoom(room.id, `${room.name}: ${o.label} ${o.status === 'bestand_bleibt' ? 'wird neu' : 'schon vorhanden'}`, (r) => {
    const x = r.outlets.find((y) => y.id === o.id);
    if (!x) return;
    if (x.status === 'bestand_bleibt') x.status = 'neu';
    else { x.status = 'bestand_bleibt'; x.circuitId = undefined; } // hängt an einem bestehenden Stromkreis
  });
  const name = (room: Room, o: Outlet) => room.loads.find((l) => l.outletId === o.id)?.label ?? (o.note.split(/[–(,]/)[0].trim() || outletKindLabel[o.kind]);
  const row = (room: Room, o: Outlet) => (
    <Tile key={o.id} icon={BIG_KINDS.includes(o.kind) ? Zap : Square} label={name(room, o)} hint={`${o.label}, ${outletKindLabel[o.kind]}`}
      badge={o.status === 'bestand_bleibt' ? 'Schon vorhanden' : undefined} selected={o.status === 'bestand_bleibt'} onClick={() => toggle(room, o)} />
  );
  const kept = project.rooms.flatMap((r) => r.outlets).filter((o) => o.status === 'bestand_bleibt').length;
  return <Q title="Ist davon schon etwas installiert?" hint="Tippe an, was schon da ist und so bleibt. Dafür plant das Programm keine neue Leitung, kein Material und keinen neuen Stromkreis.">
    {rooms.map((room) => {
      const big = room.outlets.filter((o) => (o.status === 'neu' || o.status === 'bestand_bleibt') && (BIG_KINDS.includes(o.kind) || room.loads.some((l) => l.outletId === o.id && l.dedicated)));
      const rest = room.outlets.filter((o) => (o.status === 'neu' || o.status === 'bestand_bleibt') && !big.includes(o));
      return (
        <div key={room.id} className="hub-section">
          <div className="hub-h"><h2>{room.name}</h2></div>
          {big.length > 0 && <Tiles cols={1}>{big.map((o) => row(room, o))}</Tiles>}
          {rest.length > 0 && <More label={`Alle anderen Auslässe (${rest.length})`}><Tiles cols={2}>{rest.map((o) => row(room, o))}</Tiles></More>}
        </div>
      );
    })}
    {!rooms.length && <Note>Noch nichts geplant. Zuerst die Vorschläge für Dosen und Licht übernehmen.</Note>}
    {kept > 0 && <Note>{kept} Auslass{kept === 1 ? '' : 'lässe'} als vorhanden markiert.</Note>}
  </Q>;
}

/** Ohne erfasste Verteilung kann nichts zugeordnet werden: dann eine Hauptverteilung als Annahme anlegen. */
function withHv(p: Project | Draft<Project>) {
  if (!p.distributions.some((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank')) {
    p.distributions.push({ id: newId('hv'), name: 'Hauptverteilung (HV)', kind: 'HV', feedCable: '', feedFuse: '', mainFuse: '', netForm: 'unbekannt', meter: '', freeModules: 0, breakers: [], rcds: [], hasSpd: false, photos: [], note: 'angenommen, Standort noch offen' } as any);
  }
}

function CircuitsQuestion({ project }: { project: Project }) {
  const noHv = !project.distributions.some((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank');
  const prop = useMemo(() => proposeCircuits(noHv ? produce(project, (d) => { withHv(d); }) : project, 'offen'), [project, noHv]);
  const open = project.rooms.flatMap((r) => r.outlets).filter((o) => !o.circuitId && o.status !== 'bestand_bleibt' && o.status !== 'bestand_entfaellt' && ['steckdose', 'schalter', 'licht_decke', 'licht_wand', 'anschlussdose', 'festanschluss', 'herd', 'starkstrom'].includes(o.kind)).length;
  return <Q title="Stromkreise einteilen" hint="Das Programm verteilt die Dosen auf Sicherungen und FI-Schalter und prüft den Platz im Sicherungskasten.">
    <div className="a-facts">
      <div><span>Stromkreise</span><b className="a-figure">{project.circuits.length}</b></div>
      <div><span>Ohne Stromkreis</span><b className="a-figure">{open}</b></div>
    </div>
    {noHv && open > 0 && <Note>Der Sicherungskasten ist noch nicht erfasst. Das Programm nimmt eine Hauptverteilung an; Standort und freie Plätze kannst du später nachtragen.</Note>}
    {open > 0
      ? <button className="primary a-big" onClick={() => up('Stromkreisvorschlag übernommen (offen)', (p) => { withHv(p); applyCircuitProposal(p as Project, proposeCircuits(p as Project, 'offen'), 'offen'); })}><Check size={20} aria-hidden /> Vorschlag übernehmen ({prop.circuits.filter((c) => !project.circuits.some((x) => x.id === c.id)).length} neue Kreise)</button>
      : <Note>Alle Dosen sind einem Stromkreis zugeordnet.</Note>}
    <button className="a-big" onClick={() => store.setUi({ view: 'verteilung' })}>Stromkreise im Detail ansehen</button>
  </Q>;
}

function FinishQuestion({ project }: { project: Project }) {
  const r = runRules(project);
  const pr = assistantProgress(project);
  useEffect(() => { /* nichts */ }, []);
  return <Q title="Geschafft" hint={pr.done < pr.total - 1 ? `${pr.total - pr.done - 1} Fragen sind noch offen, du kannst sie jederzeit über die Übersicht nachholen.` : 'Alle Fragen sind beantwortet.'}>
    <div className="a-facts">
      <div><span>Fehler</span><b className="a-figure">{r.counts.fehler}</b></div>
      <div><span>Warnungen</span><b className="a-figure">{r.counts.warnung}</b></div>
      <div><span>Hinweise</span><b className="a-figure">{r.counts.hinweis}</b></div>
    </div>
    <Tiles cols={1}>
      <Tile icon={Check} label="Prüfung mit Lösungsvorschlägen" hint="Jede Meldung mit einem Vorschlag zum Übernehmen" onClick={() => store.setUi({ view: 'pruefung' })} />
      <Tile icon={Layers} label="Pläne und Ausdrucke" hint="Raumpläne, Ausführungsplan, Schlitzplan" onClick={() => store.setUi({ view: 'ausgaben' })} />
      <Tile icon={Package} label="Material, Kosten, Aufgaben" hint="Einkaufsliste mit Mengen" onClick={() => store.setUi({ view: 'material' })} />
    </Tiles>
    {!project.wizard.finished && <button className="primary a-big" onClick={() => { up('Assistent abgeschlossen', (p) => { p.wizard.finished = true; if (!p.wizard.done.includes('fertig')) p.wizard.done.push('fertig'); }); store.setUi({ view: 'projekt' }); }}>Assistent abschließen</button>}
  </Q>;
}
