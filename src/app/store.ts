/**
 * Zustandsspeicher: das geöffnete Projekt als einzige Datenquelle, Undo/Redo
 * über Schnappschüsse (Immer: strukturelles Teilen), Änderungsprotokoll,
 * automatisches Speichern in der Projektablage (Server oder Browser, siehe repo.ts).
 */
import { produce, type Draft } from 'immer';
import { useSyncExternalStore } from 'react';
import type { Project } from '../core/model/schema';
import { Project as ProjectSchema } from '../core/model/schema';
import { createProject, loadProject, newId, nowIso } from '../core/model/factory';
import exampleJson from '../../examples/kellerwohnung.json';
import { setServerAi } from './ai/claude';
import { browserRepo, detectServer, lastOpened, rememberOpened, serverRepo, takeLegacyBrowserProject, type ProjectMeta, type Repo } from './repo';

const HISTORY_LIMIT = 200;

export interface UiState {
  view: 'projekte' | 'assistent' | 'projekt' | 'verteilung' | 'raum' | 'pruefung' | 'material' | 'ausgaben' | 'versionen';
  roomId?: string;
  outletId?: string;
  wallIndex: number;
}

interface State {
  /** Geöffnetes Projekt; null = keins geöffnet (Projektübersicht) */
  project: Project | null;
  past: Project[];
  future: Project[];
  ui: UiState;
  savedAt?: string;
  loadError?: string;
  /** Läuft die App auf dem eigenen Server (Docker/Unraid)? */
  server?: { ai: boolean };
  /** Stand der Speicherung */
  sync?: 'ok' | 'speichert' | 'konflikt' | 'offline';
  /** Alle Projekte (Kurzinfo) */
  projects: ProjectMeta[];
  ready: boolean;
}

export function exampleProject(): Project {
  return loadProject(exampleJson);
}

/** Kopie mit neuer ID (Beispiel hinzufügen, Duplizieren, Import einer schon vorhandenen Datei). */
export function withNewId(p: Project, name = p.name): Project {
  return { ...p, id: newId('projekt'), name, createdAt: nowIso(), updatedAt: nowIso() };
}

let state: State = { project: null, past: [], future: [], ui: { view: 'projekte', wallIndex: 0 }, projects: [], ready: false };
let repo: Repo = browserRepo;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Revision des geöffneten Projekts in der Ablage, auf der der lokale Stand aufbaut. */
let baseRev = 0;
let dirty = false;
let saving: Promise<void> = Promise.resolve();

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 600);
}

function saveNow(force = false): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(() => doSave(force));
  return saving;
}

async function doSave(force: boolean) {
  const project = state.project;
  if (!project || !dirty) return;
  if (state.sync === 'konflikt' && !force) return;
  const json = JSON.stringify(project);
  state = { ...state, sync: 'speichert' };
  emit();
  const r = await repo.save(project, json, baseRev, force);
  if (r.ok) {
    baseRev = r.rev;
    dirty = state.project !== project; // inzwischen weiter geändert?
    state = { ...state, sync: 'ok', loadError: undefined, savedAt: new Date().toLocaleTimeString('de-DE') };
    upsertMeta(project, r.rev);
    if (dirty) scheduleSave();
  } else if (r.conflict) {
    state = { ...state, sync: 'konflikt' };
  } else {
    state = { ...state, sync: 'offline', loadError: `Speichern fehlgeschlagen: ${r.error}` };
  }
  emit();
}

function upsertMeta(p: Project, rev: number) {
  const meta: ProjectMeta = { id: p.id, name: p.name, projectType: p.projectType ?? null, updatedAt: p.updatedAt ?? null, savedAt: new Date().toISOString(), floors: p.floors.length, rooms: p.rooms.length, rev };
  state = { ...state, projects: [meta, ...state.projects.filter((m) => m.id !== p.id)] };
}

function viewFor(p: Project): UiState['view'] {
  return p.wizard.finished ? 'projekt' : 'assistent';
}

function show(project: Project, rev: number) {
  baseRev = rev;
  dirty = false;
  rememberOpened(project.id);
  state = { ...state, project, past: [], future: [], sync: 'ok', savedAt: undefined, loadError: undefined, ui: { view: viewFor(project), wallIndex: 0 } };
  emit();
}

/** Für Bearbeitungsfunktionen: geöffnetes Projekt (Ansichten werden nur mit Projekt gezeigt). */
function current(): Project {
  if (!state.project) throw new Error('Kein Projekt geöffnet');
  return state.project;
}

export const store = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Änderung mit Undo-Eintrag und Protokollzeile. */
  update(text: string, fn: (d: Draft<Project>) => void) {
    const next = produce(current(), (d) => {
      fn(d);
      d.updatedAt = nowIso();
      d.changeLog.push({ at: d.updatedAt, text });
      if (d.changeLog.length > 2000) d.changeLog.splice(0, d.changeLog.length - 2000);
    });
    state = { ...state, project: next, past: [...state.past, current()].slice(-HISTORY_LIMIT), future: [] };
    emit();
    scheduleSave();
  },

  /** Änderung ohne Undo-Eintrag und ohne Protokoll, aber gespeichert (z. B. Assistent-Schritt). */
  silent(fn: (d: Draft<Project>) => void) {
    state = { ...state, project: produce(current(), fn) };
    emit();
    scheduleSave();
  },

  /** Vorschau ohne Undo-Eintrag (z. B. während Ziehen). */
  preview(fn: (d: Draft<Project>) => void) {
    state = { ...state, project: produce(current(), fn) };
    emit();
  },

  /** Abschluss einer Vorschau-Serie: ein Undo-Schritt zurück auf `before`. */
  commit(text: string, before: Project) {
    if (before === state.project) return;
    const next = produce(current(), (d) => {
      d.updatedAt = nowIso();
      d.changeLog.push({ at: d.updatedAt, text });
    });
    state = { ...state, project: next, past: [...state.past, before].slice(-HISTORY_LIMIT), future: [] };
    emit();
    scheduleSave();
  },

  undo() {
    const prev = state.past[state.past.length - 1];
    if (!prev) return;
    state = { ...state, project: prev, past: state.past.slice(0, -1), future: [current(), ...state.future] };
    emit();
    scheduleSave();
  },
  redo() {
    const [next, ...rest] = state.future;
    if (!next) return;
    state = { ...state, project: next, past: [...state.past, current()], future: rest };
    emit();
    scheduleSave();
  },

  setUi(patch: Partial<UiState>) {
    state = { ...state, ui: { ...state.ui, ...patch } };
    emit();
  },

  /** Start: Ablage wählen (Server oder Browser), Projekte laden, zuletzt geöffnetes öffnen. */
  async restore() {
    const srv = await detectServer();
    if (srv) {
      repo = serverRepo;
      setServerAi(srv.ai);
      state = { ...state, server: { ai: srv.ai } };
    }
    try {
      let projects = await repo.list();
      // Früher gab es nur ein Projekt im Browser: einmalig übernehmen
      const legacy = await takeLegacyBrowserProject();
      if (legacy && !projects.some((m) => m.id === legacy.id)) {
        await repo.save(legacy, JSON.stringify(legacy), 0);
        projects = await repo.list();
      }
      // Ganz leer: Beispielprojekt anlegen, damit man etwas zum Ansehen hat
      if (!projects.length) {
        const ex = withNewId(exampleProject());
        await repo.save(ex, JSON.stringify(ex), 0);
        projects = await repo.list();
      }
      state = { ...state, projects, ready: true };
      emit();
      const last = lastOpened();
      if (last && projects.some((m) => m.id === last)) await store.open(last);
    } catch (e) {
      state = { ...state, ready: true, loadError: `Projekte konnten nicht geladen werden: ${(e as Error).message}` };
      emit();
    }
    if (repo.kind === 'server') watchServer();
    window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  },

  async refreshList() {
    try { state = { ...state, projects: await repo.list() }; emit(); } catch (e) { state = { ...state, loadError: (e as Error).message }; emit(); }
  },

  /** Projekt öffnen (vorher Änderungen am bisherigen sichern). */
  async open(id: string) {
    await saveNow();
    try {
      const r = await repo.load(id);
      if (!r) { state = { ...state, loadError: 'Projekt nicht gefunden – evtl. auf einem anderen Gerät gelöscht.' }; await store.refreshList(); return; }
      show(r.project, r.rev);
    } catch (e) {
      state = { ...state, loadError: `Projekt konnte nicht geöffnet werden: ${(e as Error).message}` };
      emit();
    }
  },

  /** Neues Projekt in der Ablage anlegen und öffnen. */
  async create(project: Project, text = 'Projekt angelegt') {
    await saveNow();
    let p = project;
    if (state.projects.some((m) => m.id === p.id)) p = withNewId(p);
    // gleicher Name schon vorhanden → durchnummerieren, damit man die Projekte unterscheiden kann
    const taken = new Set(state.projects.map((m) => m.name));
    if (taken.has(p.name)) {
      const base = p.name.replace(/ \(\d+\)$/, '');
      let n = 2;
      while (taken.has(`${base} (${n})`)) n++;
      p = { ...p, name: `${base} (${n})` };
    }
    p = produce(p, (d) => { d.updatedAt = nowIso(); d.changeLog.push({ at: d.updatedAt, text }); });
    const r = await repo.save(p, JSON.stringify(p), 0);
    if (!r.ok) { state = { ...state, loadError: `Projekt konnte nicht angelegt werden: ${r.error}` }; emit(); return; }
    upsertMeta(p, r.rev);
    show(p, r.rev);
  },

  newProject(name = 'Neues Projekt') {
    return store.create(createProject({ name }), 'Neues Projekt angelegt');
  },
  addExample() {
    return store.create(withNewId(exampleProject()), 'Beispielprojekt angelegt');
  },
  async importProject(text: string, fileName: string) {
    const p = loadProject(text); // wirft ProjectLoadError mit Details
    await store.create(p, `Projektdatei „${fileName}“ importiert`);
  },

  async duplicate(id: string) {
    const r = state.project?.id === id ? { project: state.project } : await repo.load(id);
    if (!r) return;
    await store.create(withNewId(r.project, `${r.project.name} (Kopie)`), `Kopie von „${r.project.name}“`);
  },

  async rename(id: string, name: string) {
    name = name.trim();
    if (!name) return;
    if (state.project?.id === id) { store.update(`Projekt umbenannt in „${name}“`, (d) => { d.name = name; }); await saveNow(); return; }
    const r = await repo.load(id);
    if (!r) return;
    const p = produce(r.project, (d) => { d.name = name; d.updatedAt = nowIso(); d.changeLog.push({ at: d.updatedAt, text: `Projekt umbenannt in „${name}“` }); });
    const res = await repo.save(p, JSON.stringify(p), r.rev);
    if (res.ok) upsertMeta(p, res.rev); else state = { ...state, loadError: `Umbenennen fehlgeschlagen: ${res.error}` };
    emit();
  },

  async remove(id: string) {
    try {
      await repo.remove(id);
    } catch (e) {
      state = { ...state, loadError: `Löschen fehlgeschlagen: ${(e as Error).message}` };
      emit();
      return;
    }
    if (state.project?.id === id) { clearTimeout(saveTimer); dirty = false; rememberOpened(null); state = { ...state, project: null, past: [], future: [], ui: { view: 'projekte', wallIndex: 0 } }; }
    state = { ...state, projects: state.projects.filter((m) => m.id !== id) };
    emit();
  },

  /** Zur Projektübersicht (geöffnetes Projekt bleibt gemerkt). */
  async showProjects() {
    await saveNow();
    store.setUi({ view: 'projekte', roomId: undefined, outletId: undefined });
    void store.refreshList();
  },

  /** Konflikt lösen: Stand vom Server übernehmen. */
  async takeServer() {
    const id = state.project?.id;
    if (!id) return;
    const r = await repo.load(id);
    dirty = false;
    if (r) show(r.project, r.rev);
  },
  /** Konflikt lösen: eigenen Stand auf den Server schreiben. */
  async keepMine() {
    dirty = true;
    await saveNow(true);
  },

  saveVersion(name: string) {
    store.update(`Versionsstand „${name}“ gespeichert`, (d) => {
      const { versions: _v, ...core } = JSON.parse(JSON.stringify(current())) as Project;
      d.versions.push({ name, at: nowIso(), snapshot: core as any });
    });
  },

  restoreVersion(index: number) {
    const v = current().versions[index];
    if (!v) return;
    const restored = ProjectSchema.parse({ ...v.snapshot, versions: current().versions });
    state = { ...state, project: restored, past: [...state.past, current()], future: [] };
    store.update(`Versionsstand „${v.name}“ wiederhergestellt`, () => {});
  },
};

/** Beim Zurückkehren zur App: wurde auf einem anderen Gerät weitergearbeitet? */
function watchServer() {
  let busy = false;
  const check = async () => {
    if (busy || document.visibilityState !== 'visible' || state.sync === 'speichert') return;
    busy = true;
    try {
      if (state.ui.view === 'projekte') { await store.refreshList(); return; }
      const p = state.project;
      if (!p) return;
      const rev = await repo.rev(p.id);
      if (rev == null) { if (!(await detectServer())) { state = { ...state, sync: 'offline' }; emit(); } return; }
      if (state.sync === 'offline') { state = { ...state, sync: 'ok' }; emit(); if (dirty) void saveNow(); }
      if (rev !== baseRev && state.project === p) {
        if (dirty) { state = { ...state, sync: 'konflikt' }; emit(); return; }
        const r = await repo.load(p.id);
        if (r && state.project === p) { baseRev = r.rev; state = { ...state, project: r.project, past: [], future: [], sync: 'ok' }; emit(); }
      }
    } finally {
      busy = false;
    }
  };
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('focus', () => void check());
  setInterval(() => void check(), 60_000);
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.getState()));
}

export function downloadFile(name: string, content: string | ArrayBuffer, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
