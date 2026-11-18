/**
 * Fragen des Assistenten (Fragen-Modus): eine einfache Frage pro Bildschirm.
 *
 * Hier stehen nur Reihenfolge, Gruppierung und Überspring-Regeln – die
 * Darstellung liegt in der App (src/app/assistant). Beantwortet gilt eine
 * Frage, wenn ihre ID in `wizard.done` steht (Vorgaben gibt es immer, deshalb
 * zählt die bewusste Bestätigung) oder wenn `answered` es aus den Daten erkennt.
 */
import type { Project, Room } from '../model/schema';

export type Section = 'projekt' | 'grundriss' | 'raeume' | 'vorschlaege' | 'fertig';

export const sectionLabel: Record<Section, string> = {
  projekt: 'Projekt',
  grundriss: 'Grundriss',
  raeume: 'Räume',
  vorschlaege: 'Vorschläge',
  fertig: 'Fertig',
};

export type QuestionKey =
  | 'p.art' | 'p.name' | 'p.gebaeude' | 'p.bundesland' | 'p.geschosse' | 'p.verlegung' | 'p.boden' | 'p.schalter'
  | 'p.verteilung' | 'p.platz' | 'p.fi' | 'p.smart' | 'p.smartsystem' | 'p.netzwerk' | 'p.bestand'
  | 'g.plan' | 'r.raeume'
  | 'raum.typ' | 'raum.masse' | 'raum.oeffnungen' | 'raum.waende' | 'raum.decke' | 'raum.fbh' | 'raum.leitungsweg' | 'raum.geraete' | 'raum.bestand' | 'raum.check'
  | 'v.dosen' | 'v.kreise' | 'fertig';

export interface Question {
  /** eindeutig, wird in wizard.done gespeichert */
  id: string;
  key: QuestionKey;
  section: Section;
  roomId?: string;
  floorId?: string;
}

const ROOM_KEYS: QuestionKey[] = ['raum.typ', 'raum.masse', 'raum.oeffnungen', 'raum.waende', 'raum.decke', 'raum.fbh', 'raum.leitungsweg', 'raum.geraete', 'raum.bestand', 'raum.check'];

/** Fragen, die in dieser Lage nichts bringen. */
function skip(project: Project, key: QuestionKey, room?: Room): boolean {
  const bestand = project.projectType !== 'neubau';
  switch (key) {
    case 'p.smartsystem': return !project.smartHome.enabled;
    case 'p.bestand': return !bestand;
    case 'raum.bestand': return !bestand;
    // Mit dem Aufmaß Schritt für Schritt sind Türen/Fenster schon erfasst
    case 'raum.oeffnungen': return false;
    case 'raum.fbh': return !!room && room.installationType.startsWith('aufputz');
    // Nutzung schon beim Anlegen per Kachel gewählt
    case 'raum.typ': return !!room?.roomType && project.wizard.done.includes(`raum:${room.id}:typ`);
    default: return false;
  }
}

export function roomQuestions(project: Project, room: Room): Question[] {
  return ROOM_KEYS.filter((k) => !skip(project, k, room)).map((key) => ({ id: `raum:${room.id}:${key.slice(5)}`, key, section: 'raeume' as Section, roomId: room.id, floorId: room.floorId }));
}

export function questionList(project: Project): Question[] {
  const q = (key: QuestionKey, section: Section, extra: Partial<Question> = {}): Question => ({ id: extra.id ?? key, key, section, ...extra });
  const out: Question[] = [];
  for (const key of ['p.art', 'p.name', 'p.gebaeude', 'p.bundesland', 'p.geschosse', 'p.verlegung', 'p.boden', 'p.schalter', 'p.verteilung', 'p.platz', 'p.fi', 'p.smart', 'p.smartsystem', 'p.netzwerk', 'p.bestand'] as QuestionKey[]) {
    if (!skip(project, key)) out.push(q(key, 'projekt'));
  }
  for (const f of project.floors) out.push(q('g.plan', 'grundriss', { id: `g.plan:${f.id}`, floorId: f.id }));
  for (const f of project.floors) {
    out.push(q('r.raeume', 'raeume', { id: `r.raeume:${f.id}`, floorId: f.id }));
    for (const r of project.rooms.filter((x) => x.floorId === f.id && x.inScope)) out.push(...roomQuestions(project, r));
  }
  out.push(q('v.dosen', 'vorschlaege'), q('v.kreise', 'vorschlaege'), q('fertig', 'fertig'));
  return out;
}

export function isDone(project: Project, q: Question): boolean {
  if (project.wizard.done.includes(q.id)) return true;
  const room = q.roomId ? project.rooms.find((r) => r.id === q.roomId) : undefined;
  switch (q.key) {
    case 'raum.typ': return !!room?.roomType;
    case 'raum.leitungsweg': return !!room?.routingOptions.answered;
    case 'raum.check': return !!room?.confirmed;
    case 'g.plan': {
      const f = project.floors.find((x) => x.id === q.floorId);
      return !!f?.backgroundScale;
    }
    default: return false;
  }
}

export interface SectionProgress { section: Section; done: number; total: number }

export function assistantProgress(project: Project) {
  const list = questionList(project);
  const done = list.filter((q) => isDone(project, q)).length;
  const sections = (Object.keys(sectionLabel) as Section[]).map((s) => {
    const qs = list.filter((q) => q.section === s);
    return { section: s, done: qs.filter((q) => isDone(project, q)).length, total: qs.length };
  });
  const rooms = project.rooms.filter((r) => r.inScope).map((r) => {
    const qs = list.filter((q) => q.roomId === r.id);
    return { roomId: r.id, done: qs.filter((q) => isDone(project, q)).length, total: qs.length };
  });
  return { done, total: list.length, sections, rooms, firstOpen: list.find((q) => !isDone(project, q)) };
}
