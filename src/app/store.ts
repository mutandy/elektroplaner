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
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await idbSet(STORAGE_KEY, JSON.stringify(state.project));
      state = { ...state, savedAt: new Date().toLocaleTimeString('de-DE') };
      emit();
    } catch {
      /* Speichern im Browser nicht möglich (z. B. privates Fenster) – Export bleibt möglich */
    }
  }, 600);
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
    try {
      const raw = await idbGet<string>(STORAGE_KEY);
      if (raw) {
        const project = loadProject(raw);
        state = { ...state, project, ui: { ...state.ui, view: project.wizard.finished ? 'projekt' : 'assistent' } };
        emit();
      }
    } catch (e) {
      state = { ...state, loadError: `Gespeicherter Stand konnte nicht geladen werden: ${(e as Error).message}` };
      emit();
    }
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
