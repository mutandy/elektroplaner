/**
 * Zustandsspeicher: ein Projekt als einzige Datenquelle, Undo/Redo über
 * Schnappschüsse (Immer: strukturelles Teilen), Änderungsprotokoll,
 * automatisches Speichern im Browser (IndexedDB).
 */
import { produce, type Draft } from 'immer';
import { useSyncExternalStore } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Project } from '../core/model/schema';
import { Project as ProjectSchema } from '../core/model/schema';
import { loadProject, nowIso } from '../core/model/factory';
import exampleJson from '../../examples/kellerwohnung.json';
import { setServerAi } from './ai/claude';

const HISTORY_LIMIT = 200;
const STORAGE_KEY = 'elektroplaner.projekt';

export interface UiState {
  view: 'willkommen' | 'assistent' | 'projekt' | 'verteilung' | 'raum' | 'pruefung' | 'material' | 'ausgaben' | 'versionen';
  roomId?: string;
  outletId?: string;
  wallIndex: number;
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  ui: UiState;
  savedAt?: string;
  loadError?: string;
  /** Läuft die App auf dem eigenen Server (Docker/Unraid)? */
  server?: { ai: boolean };
  /** Stand der zentralen Speicherung auf dem Server */
  sync?: 'ok' | 'speichert' | 'konflikt' | 'offline';
}

export function exampleProject(): Project {
  return loadProject(exampleJson);
}

let state: State = {
  project: exampleProject(),
  past: [],
  future: [],
  ui: { view: 'willkommen', wallIndex: 0 },
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Revision des Projekts auf dem Server, auf der der lokale Stand aufbaut. */
let serverRev = 0;
let dirty = false;

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 600);
}

async function saveNow(force = false) {
  const json = JSON.stringify(state.project);
  try {
    await idbSet(STORAGE_KEY, json);
    if (!state.server) state = { ...state, savedAt: new Date().toLocaleTimeString('de-DE') };
  } catch {
    /* Speichern im Browser nicht möglich (z. B. privates Fenster) – Export bleibt möglich */
  }
  if (state.server && (state.sync !== 'konflikt' || force)) {
    state = { ...state, sync: 'speichert' };
    emit();
    try {
      const r = await fetch('api/projekt', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-base-rev': String(serverRev), ...(force ? { 'x-force': '1' } : {}) }, body: json });
      if (r.status === 409) state = { ...state, sync: 'konflikt' };
      else if (!r.ok) {
        const msg = await r.json().then((j) => j.error as string).catch(() => `Status ${r.status}`);
        state = { ...state, sync: 'offline', loadError: `Speichern auf dem Server fehlgeschlagen: ${msg}` };
      }
      else {
        serverRev = (await r.json()).rev;
        dirty = JSON.stringify(state.project) !== json;
        state = { ...state, sync: 'ok', loadError: undefined, savedAt: new Date().toLocaleTimeString('de-DE') };
      }
    } catch {
      state = { ...state, sync: 'offline' };
    }
  }
  emit();
}

async function fetchServerProject(): Promise<Project | null> {
  const r = await fetch('api/projekt', { cache: 'no-store' });
  if (r.status === 404) { serverRev = 0; return null; }
  if (!r.ok) throw new Error(`Server antwortet mit ${r.status}`);
  serverRev = Number(r.headers.get('x-rev') ?? 0);
  return loadProject(await r.text());
}

async function serverStatus(): Promise<{ server: boolean; ai: boolean; rev: number } | null> {
  try {
    const r = await fetch('api/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const j = await r.json();
    return j?.server ? j : null;
  } catch {
    return null;
  }
}

export const store = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /** Änderung mit Undo-Eintrag und Protokollzeile. */
  update(text: string, fn: (d: Draft<Project>) => void) {
    const next = produce(state.project, (d) => {
      fn(d);
      d.updatedAt = nowIso();
      d.changeLog.push({ at: d.updatedAt, text });
      if (d.changeLog.length > 2000) d.changeLog.splice(0, d.changeLog.length - 2000);
    });
    state = { ...state, project: next, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [] };
    emit();
    scheduleSave();
  },

  /** Änderung ohne Undo-Eintrag und ohne Protokoll, aber gespeichert (z. B. Assistent-Schritt). */
  silent(fn: (d: Draft<Project>) => void) {
    state = { ...state, project: produce(state.project, fn) };
    emit();
    scheduleSave();
  },

  /** Vorschau ohne Undo-Eintrag (z. B. während Ziehen). */
  preview(fn: (d: Draft<Project>) => void) {
    state = { ...state, project: produce(state.project, fn) };
    emit();
  },

  /** Abschluss einer Vorschau-Serie: ein Undo-Schritt zurück auf `before`. */
  commit(text: string, before: Project) {
    if (before === state.project) return;
    const next = produce(state.project, (d) => {
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
    state = { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
    emit();
    scheduleSave();
  },
  redo() {
    const [next, ...rest] = state.future;
    if (!next) return;
    state = { ...state, project: next, past: [...state.past, state.project], future: rest };
    emit();
    scheduleSave();
  },

  replace(project: Project, text = 'Projekt geladen') {
    const view = project.wizard.finished ? 'projekt' : 'assistent';
    state = { ...state, project, past: [...state.past, state.project].slice(-HISTORY_LIMIT), future: [], ui: { view, wallIndex: 0 } };
    store.update(text, () => {});
  },

  setUi(patch: Partial<UiState>) {
    state = { ...state, ui: { ...state.ui, ...patch } };
    emit();
  },

  async restore() {
    const status = await serverStatus();
    if (status) {
      setServerAi(status.ai);
      state = { ...state, server: { ai: status.ai }, sync: 'ok' };
      emit();
      try {
        const project = await fetchServerProject();
        if (project) {
          state = { ...state, project, ui: { ...state.ui, view: project.wizard.finished ? 'projekt' : 'assistent' } };
          emit();
          watchServer();
          return;
        }
      } catch (e) {
        state = { ...state, sync: 'offline', loadError: `Projekt vom Server konnte nicht geladen werden: ${(e as Error).message}` };
        emit();
      }
      watchServer();
    }
    try {
      const raw = await idbGet<string>(STORAGE_KEY);
      if (raw) {
        const project = loadProject(raw);
        state = { ...state, project, ui: { ...state.ui, view: project.wizard.finished ? 'projekt' : 'assistent' } };
        emit();
        // Erster Start mit Server: bisherigen Browser-Stand hochladen
        if (state.server && state.sync === 'ok') scheduleSave();
      }
    } catch (e) {
      state = { ...state, loadError: `Gespeicherter Stand konnte nicht geladen werden: ${(e as Error).message}` };
      emit();
    }
  },

  /** Konflikt lösen: Stand vom Server übernehmen (eigener Stand bleibt über „Rückgängig“ erreichbar). */
  async takeServer() {
    const project = await fetchServerProject();
    dirty = false;
    state = { ...state, sync: 'ok' };
    if (project) store.replace(project, 'Stand vom Server übernommen');
  },
  /** Konflikt lösen: eigenen Stand auf den Server schreiben. */
  async keepMine() {
    await saveNow(true);
  },

  saveVersion(name: string) {
    store.update(`Versionsstand „${name}“ gespeichert`, (d) => {
      const { versions: _v, ...core } = JSON.parse(JSON.stringify(state.project)) as Project;
      d.versions.push({ name, at: nowIso(), snapshot: core as any });
    });
  },

  restoreVersion(index: number) {
    const v = state.project.versions[index];
    if (!v) return;
    const restored = ProjectSchema.parse({ ...v.snapshot, versions: state.project.versions });
    state = { ...state, project: restored, past: [...state.past, state.project], future: [] };
    store.update(`Versionsstand „${v.name}“ wiederhergestellt`, () => {});
  },
};

/** Beim Zurückkehren zur App: wurde auf einem anderen Gerät weitergearbeitet? */
function watchServer() {
  const check = async () => {
    if (document.visibilityState !== 'visible' || !state.server || state.sync === 'speichert') return;
    const st = await serverStatus();
    if (!st) { if (state.sync === 'ok') { state = { ...state, sync: 'offline' }; emit(); } return; }
    if (state.sync === 'offline') { state = { ...state, sync: 'ok' }; if (dirty) void saveNow(); }
    if (st.rev !== serverRev) {
      if (dirty) { state = { ...state, sync: 'konflikt' }; emit(); return; }
      try {
        const project = await fetchServerProject();
        if (project) { state = { ...state, project, past: [], future: [], sync: 'ok' }; emit(); await idbSet(STORAGE_KEY, JSON.stringify(project)).catch(() => {}); }
      } catch { /* nächster Versuch beim nächsten Wechsel */ }
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
