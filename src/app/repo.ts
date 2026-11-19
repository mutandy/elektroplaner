/**
 * Projektablage: mehrere Projekte, entweder zentral auf dem eigenen Server
 * (Docker/Unraid) oder – ohne Server – im Browser (IndexedDB).
 * Beide Varianten haben dieselbe Schnittstelle.
 */
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import type { Project } from '../core/model/schema';
import { loadProject } from '../core/model/factory';

export interface ProjectMeta {
  id: string;
  name: string;
  projectType: string | null;
  updatedAt: string | null;
  savedAt: string | null;
  floors: number;
  rooms: number;
  rev: number;
}

export type SaveResult = { ok: true; rev: number } | { ok: false; conflict: boolean; error: string };

export interface Repo {
  kind: 'server' | 'browser';
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<{ project: Project; rev: number } | null>;
  save(project: Project, json: string, baseRev: number, force?: boolean): Promise<SaveResult>;
  remove(id: string): Promise<void>;
  /** Aktuelle Revision (nur Server: für den Gerätewechsel) */
  rev(id: string): Promise<number | null>;
}

export function metaOf(p: Project, rev: number): ProjectMeta {
  return { id: p.id, name: p.name, projectType: p.projectType ?? null, updatedAt: p.updatedAt ?? null, savedAt: new Date().toISOString(), floors: p.floors.length, rooms: p.rooms.length, rev };
}

// ---------------------------------------------------------------------------

async function errorText(r: Response): Promise<string> {
  return r.json().then((j) => String(j.error ?? `Status ${r.status}`)).catch(() => `Status ${r.status}`);
}

/** Kennung dieses Fensters: eigene Speicherungen kommen über die Live-Verbindung nicht als „fremd“ zurück. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 10);

export interface LiveEvent { type: 'gespeichert' | 'geloescht'; id: string; rev?: number; savedAt?: string; name?: string; by?: string }

/** Live-Verbindung zum Server: meldet Speicherungen und Löschungen von anderen Geräten sofort. */
export function subscribeLive(onEvent: (e: LiveEvent) => void, onStatus: (live: boolean) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource('api/events');
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false); // verbindet sich selbst neu
  es.onmessage = (m) => {
    try { const e = JSON.parse(m.data) as LiveEvent; if (e.by !== CLIENT_ID) onEvent(e); } catch { /* Kommentarzeilen */ }
  };
  return () => es.close();
}

export const serverRepo: Repo = {
  kind: 'server',
  async list() {
    const r = await fetch('api/projekte', { cache: 'no-store' });
    if (!r.ok) throw new Error(await errorText(r));
    return r.json();
  },
  async load(id) {
    const r = await fetch(`api/projekte/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await errorText(r));
    return { project: loadProject(await r.text()), rev: Number(r.headers.get('x-rev') ?? 0) };
  },
  async save(project, json, baseRev, force = false) {
    try {
      const r = await fetch(`api/projekte/${encodeURIComponent(project.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-base-rev': String(baseRev), 'x-client-id': CLIENT_ID, ...(force ? { 'x-force': '1' } : {}) }, body: json });
      if (r.status === 409) return { ok: false, conflict: true, error: await errorText(r) };
      if (!r.ok) return { ok: false, conflict: false, error: await errorText(r) };
      return { ok: true, rev: (await r.json()).rev };
    } catch (e) {
      return { ok: false, conflict: false, error: `Server nicht erreichbar (${(e as Error).message})` };
    }
  },
  async remove(id) {
    const r = await fetch(`api/projekte/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-client-id': CLIENT_ID } });
    if (!r.ok && r.status !== 404) throw new Error(await errorText(r));
  },
  async rev(id) {
    try {
      const r = await fetch(`api/projekte/${encodeURIComponent(id)}/rev`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      return (await r.json()).rev;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------

const INDEX_KEY = 'elektroplaner.projekte';
const LEGACY_KEY = 'elektroplaner.projekt';
const projectKey = (id: string) => `elektroplaner.projekt.${id}`;

async function readIndex(): Promise<ProjectMeta[]> {
  return (await idbGet<ProjectMeta[]>(INDEX_KEY)) ?? [];
}

export const browserRepo: Repo = {
  kind: 'browser',
  async list() {
    return [...(await readIndex())].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  },
  async load(id) {
    const raw = await idbGet<string>(projectKey(id));
    if (!raw) return null;
    const meta = (await readIndex()).find((m) => m.id === id);
    return { project: loadProject(raw), rev: meta?.rev ?? 0 };
  },
  async save(project, json, _baseRev) {
    try {
      await idbSet(projectKey(project.id), json);
      const index = await readIndex();
      const prev = index.find((m) => m.id === project.id);
      const meta = metaOf(project, (prev?.rev ?? 0) + 1);
      await idbSet(INDEX_KEY, [...index.filter((m) => m.id !== project.id), meta]);
      return { ok: true, rev: meta.rev };
    } catch (e) {
      return { ok: false, conflict: false, error: `Speichern im Browser nicht möglich (${(e as Error).message})` };
    }
  },
  async remove(id) {
    await idbDel(projectKey(id));
    await idbSet(INDEX_KEY, (await readIndex()).filter((m) => m.id !== id));
  },
  async rev() {
    return null;
  },
};

/** Früher gab es nur ein Projekt im Browser – liefert es einmalig zur Übernahme. */
export async function takeLegacyBrowserProject(): Promise<Project | null> {
  try {
    const raw = await idbGet<string>(LEGACY_KEY);
    if (!raw) return null;
    const p = loadProject(raw);
    await idbDel(LEGACY_KEY);
    return p;
  } catch {
    return null;
  }
}

/** Zuletzt geöffnetes Projekt merkt sich jedes Gerät selbst. */
export function lastOpened(): string | null {
  try { return localStorage.getItem('ep.letztesProjekt'); } catch { return null; }
}
export function rememberOpened(id: string | null) {
  try { if (id) localStorage.setItem('ep.letztesProjekt', id); else localStorage.removeItem('ep.letztesProjekt'); } catch { /* egal */ }
}

export async function detectServer(): Promise<{ ai: boolean } | null> {
  try {
    const r = await fetch('api/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const j = await r.json();
    return j?.server ? { ai: !!j.ai } : null;
  } catch {
    return null;
  }
}
