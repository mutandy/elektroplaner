/**
 * Projektübersicht: alle Projekte anlegen, öffnen, umbenennen, duplizieren,
 * löschen. Jedes Projekt ist eigenständig – „Neu“ überschreibt nichts.
 */
import { useState } from 'react';
import { store, useStore } from '../store';
import { projectTypeLabel } from '../../core/model/labels';
import type { ProjectMeta } from '../repo';

function when(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `heute, ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `gestern, ${time}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ProjectsView({ onImport }: { onImport: () => void }) {
  const projects = useStore((s) => s.projects);
  const ready = useStore((s) => s.ready);
  const server = useStore((s) => s.server);
  const openId = useStore((s) => s.project?.id);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const shown = projects.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="projects">
      <div className="projects-head">
        <h1>Projekte</h1>
        <p className="muted">
          Jedes Projekt ist eine eigene Planung, z. B. ein Haus, eine Wohnung oder eine Sanierung. Alles wird automatisch {server ? <b>zentral auf deinem Server</b> : <b>in diesem Browser</b>} gespeichert
          {server ? ', alle Geräte sehen dieselben Projekte.' : '. Für die Nutzung auf mehreren Geräten die App auf dem eigenen Server betreiben.'}
        </p>
      </div>

      <div className="cards">
        <button className="card primary-card" disabled={busy || !ready} onClick={run(() => store.newProject())}><b>+ Neues Projekt</b><span>Leeres Projekt – der Assistent führt dich von Null an durch alle Fragen.</span></button>
        <button className="card" disabled={busy || !ready} onClick={run(() => store.addExample())}><b>+ Beispielprojekt</b><span>Kellerwohnung mit Bad, Küche, Heimkino, Garage – fertig ausgefüllt, zum Ausprobieren.</span></button>
        <button className="card" disabled={busy || !ready} onClick={onImport}><b>Projektdatei importieren</b><span>Eine *.elektroplan.json als neues Projekt hinzufügen.</span></button>
      </div>

      <div className="projects-listhead">
        <h2>{projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}</h2>
        {projects.length > 5 && <input id="projekt-suche" type="search" placeholder="Projekt suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      </div>

      {!ready && <p className="muted">Projekte werden geladen …</p>}
      {ready && !projects.length && <p className="muted">Noch keine Projekte. Leg oben ein neues an oder füge das Beispiel hinzu.</p>}
      <ul className="projectlist">
        {shown.map((p) => <ProjectRow key={p.id} p={p} isOpen={p.id === openId} />)}
      </ul>
    </div>
  );
}

function ProjectRow({ p, isOpen }: { p: ProjectMeta; isOpen: boolean }) {
  const [mode, setMode] = useState<'normal' | 'umbenennen' | 'loeschen'>('normal');
  const [name, setName] = useState(p.name);
  const [busy, setBusy] = useState(false);
  const server = useStore((s) => s.server);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); setMode('normal'); } };
  const facts = [p.projectType ? projectTypeLabel[p.projectType] ?? p.projectType : null, `${p.floors} ${p.floors === 1 ? 'Geschoss' : 'Geschosse'}`, `${p.rooms} ${p.rooms === 1 ? 'Raum' : 'Räume'}`].filter(Boolean).join(' · ');

  return (
    <li className={`projectrow ${isOpen ? 'is-open' : ''}`}>
      <div className="projectrow-main">
        {mode === 'umbenennen' ? (
          <form className="inline" onSubmit={(e) => { e.preventDefault(); void run(() => store.rename(p.id, name)); }}>
            <input id={`name-${p.id}`} autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Projektname" />
            <button className="primary" type="submit" disabled={busy || !name.trim()}>Speichern</button>
            <button type="button" onClick={() => { setName(p.name); setMode('normal'); }}>Abbrechen</button>
          </form>
        ) : (
          <button className="projectrow-name linkish" onClick={() => void store.open(p.id)} title="Projekt öffnen">
            {p.name}{isOpen && <span className="pill sev-hinweis">zuletzt geöffnet</span>}
          </button>
        )}
        <div className="muted small">{facts} · geändert {when(p.savedAt ?? p.updatedAt)}</div>
      </div>
      <div className="projectrow-actions">
        {mode === 'loeschen' ? (
          <>
            <span className="small">„{p.name}“ löschen?{server ? ' (landet im Papierkorb-Ordner auf dem Server)' : ' Das lässt sich nicht rückgängig machen.'}</span>
            <button className="danger" disabled={busy} onClick={() => void run(() => store.remove(p.id))}>Ja, löschen</button>
            <button onClick={() => setMode('normal')}>Nein</button>
          </>
        ) : mode === 'normal' ? (
          <>
            <button className="primary" onClick={() => void store.open(p.id)}>Öffnen</button>
            <button onClick={() => { setName(p.name); setMode('umbenennen'); }}>Umbenennen</button>
            <button disabled={busy} onClick={() => void run(() => store.duplicate(p.id))}>Duplizieren</button>
            <button className="danger" onClick={() => setMode('loeschen')}>Löschen</button>
          </>
        ) : null}
      </div>
    </li>
  );
}
