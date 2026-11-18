/**
 * Geführter Assistent: Reihenfolge der Schritte und Prüfung, was noch fehlt.
 * Reine Logik ohne Oberfläche – die App rendert je Schritt-ID ein Formular.
 *
 * Grundsatz: erst Informationen sammeln, dann empfehlen. Jeder Schritt kann
 * übersprungen werden („weiß ich noch nicht“); fehlende Angaben bleiben als
 * offene Punkte sichtbar.
 */
import type { Project, Room } from '../model/schema';
import { wallGeoms } from '../geometry/room';

export type StepGroup = 'Projekt' | 'Grundriss' | 'Räume' | 'Empfehlungen' | 'Abschluss';

export const ROOM_SUBSTEPS = ['nutzung', 'masse', 'waende', 'tueren', 'fenster', 'besonderheiten', 'boden', 'decke', 'leitungsweg', 'einrichtung', 'bestand', 'zusammenfassung'] as const;
export type RoomSubstep = (typeof ROOM_SUBSTEPS)[number];

export const roomSubstepLabel: Record<RoomSubstep, string> = {
  masse: 'Maße und Höhe',
  waende: 'Wände',
  tueren: 'Türen',
  fenster: 'Fenster',
  besonderheiten: 'Vorwand, Kamin, Hindernisse',
  boden: 'Boden',
  decke: 'Decke',
  nutzung: 'Nutzung und Verbraucher',
  einrichtung: 'Möbel und Geräte',
  leitungsweg: 'Leitungswege: was ist möglich?',
  bestand: 'Bestandsleitungen',
  zusammenfassung: 'Zusammenfassung',
};

export interface Step {
  id: string;
  group: StepGroup;
  title: string;
  roomId?: string;
  sub?: RoomSubstep;
}

const PROJECT_STEPS: Step[] = [
  { id: 'projekt.start', group: 'Projekt', title: 'Was wird geplant?' },
  { id: 'projekt.gebaeude', group: 'Projekt', title: 'Gebäude und Geschosse' },
  { id: 'projekt.bezug', group: 'Projekt', title: 'Höhenbezug und Bodenaufbau' },
  { id: 'projekt.installation', group: 'Projekt', title: 'Installationsart und Schalterprogramm' },
  { id: 'projekt.verteilung', group: 'Projekt', title: 'Zähler und Verteilung' },
  { id: 'projekt.bestand', group: 'Projekt', title: 'Was bleibt, wie es ist?' },
  { id: 'projekt.smarthome', group: 'Projekt', title: 'Smart Home' },
  { id: 'projekt.netzwerk', group: 'Projekt', title: 'Netzwerk' },
  { id: 'grundriss', group: 'Grundriss', title: 'Grundrisse je Geschoss (optional)' },
  { id: 'raeume', group: 'Räume', title: 'Räume je Geschoss anlegen' },
];

/** Bestandsleitungen gibt es nur im Bestand. */
export function roomSubsteps(project: Project): RoomSubstep[] {
  return ROOM_SUBSTEPS.filter((s) => s !== 'bestand' || project.projectType !== 'neubau');
}

export function allSteps(project: Project): Step[] {
  const steps = [...PROJECT_STEPS];
  for (const r of project.rooms.filter((r) => r.inScope)) {
    for (const sub of roomSubsteps(project)) {
      steps.push({ id: `raum:${r.id}:${sub}`, group: 'Räume', title: `${r.name}: ${roomSubstepLabel[sub]}`, roomId: r.id, sub });
    }
  }
  steps.push({ id: 'empfehlungen.auslaesse', group: 'Empfehlungen', title: 'Vorgeschlagene Auslässe' });
  steps.push({ id: 'empfehlungen.stromkreise', group: 'Empfehlungen', title: 'Stromkreise und Leitungswege' });
  steps.push({ id: 'abschluss', group: 'Abschluss', title: 'Fertig – was noch offen ist' });
  return steps;
}

/** Was fehlt in einem Schritt? Leere Liste = vollständig. */
export function missingFor(project: Project, step: Step): string[] {
  const m: string[] = [];
  const room = step.roomId ? project.rooms.find((r) => r.id === step.roomId) : undefined;
  switch (step.id) {
    case 'projekt.start':
      if (!project.name.trim() || project.name === 'Neues Projekt') m.push('Projektname');
      break;
    case 'projekt.gebaeude':
      if (!project.bundesland) m.push('Bundesland (für die Rauchwarnmelder-Pflicht)');
      break;
    case 'projekt.verteilung': {
      const hv = project.distributions.find((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank');
      if (!hv) m.push('Hauptverteilung');
      else {
        if (hv.netForm === 'unbekannt') m.push('Netzform (steht oft am Hausanschluss oder fragt den Netzbetreiber)');
        if (!hv.breakers.length && hv.freeModules === 0) m.push('freie Plätze / freie Sicherungen in der Verteilung');
        if (!hv.rcds.length) m.push('vorhandene FI/RCD');
      }
      break;
    }
    case 'projekt.smarthome':
      if (project.smartHome.enabled && project.smartHome.system === 'keines') m.push('Smart-Home-System');
      break;
    case 'raeume':
      if (!project.rooms.some((r) => r.inScope)) m.push('mindestens ein Raum, der geplant wird');
      for (const f of project.floors) if (!project.rooms.some((r) => r.floorId === f.id)) m.push(`Räume im ${f.name}`);
      break;
    case 'grundriss':
      for (const f of project.floors) if (f.backgroundPlan && !f.backgroundScale) m.push(`Maßstab für den Grundriss ${f.name}`);
      break;
  }
  if (room && step.sub) m.push(...missingForRoom(project, room, step.sub));
  return m;
}

export function missingForRoom(project: Project, room: Room, sub: RoomSubstep): string[] {
  const m: string[] = [];
  switch (sub) {
    case 'masse':
      if (room.provenance === 'annahme') m.push('Maße sind nur angenommen – bitte aufmessen');
      break;
    case 'waende':
      room.walls.forEach((w) => { if (w.material === 'unbekannt') m.push(`Material Wand ${w.index + 1}`); });
      break;
    case 'tueren':
      if (!room.doors.length) m.push('mindestens eine Tür');
      break;
    case 'boden':
      if (room.floor.slotsAllowed && room.floor.protectedLayerDepth == null) m.push('Tiefe von Folie/Dämmung im Boden');
      break;
    case 'decke':
      if (room.ceiling.construction === 'unbekannt') m.push('Deckenbauart');
      break;
    case 'nutzung':
      if (!room.roomType) m.push('Raumtyp (Nutzung)');
      break;
    case 'leitungsweg':
      if (!room.routingOptions.answered) m.push('Leitungswege prüfen und bestätigen');
      break;
    case 'zusammenfassung':
      if (!room.confirmed) m.push('Zusammenfassung bestätigen');
      break;
  }
  return m;
}

export function stepIndex(project: Project, id: string): number {
  return Math.max(0, allSteps(project).findIndex((s) => s.id === id));
}

export interface Progress {
  total: number;
  done: number;
  open: { step: Step; missing: string[] }[];
}

export function progress(project: Project): Progress {
  const steps = allSteps(project);
  const done = steps.filter((s) => project.wizard.done.includes(s.id)).length;
  const open = steps
    .filter((s) => s.id !== 'abschluss')
    .map((step) => ({ step, missing: missingFor(project, step) }))
    .filter((x) => x.missing.length > 0);
  return { total: steps.length, done, open };
}

/**
 * Beschreibung einer Wand für Laien: wo liegt sie in der Draufsicht
 * (oben/rechts/unten/links), damit „Wand 3“ greifbar wird.
 */
export function wallSideLabel(room: Room, index: number): string {
  const w = wallGeoms(room)[index];
  if (!w) return '';
  const { x, y } = w.normal; // zeigt in den Raum
  if (Math.abs(y) > Math.abs(x)) return y > 0 ? 'oben im Plan' : 'unten im Plan';
  return x > 0 ? 'links im Plan' : 'rechts im Plan';
}
