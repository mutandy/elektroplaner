import { useEffect, useRef, useState } from 'react';
import { store, useStore, downloadFile } from './store';
import { ProjectLoadError, serializeProject } from '../core/model/factory';
import type { Project } from '../core/model/schema';
import { runRules } from '../core/rules/rules';
import { ProjectView } from './views/ProjectView';
import { RoomView } from './views/RoomView';
import { DistributionView, OutputView, RulesView, VersionsView } from './views/OtherViews';
import { ProjectsView } from './views/ProjectsView';
import { DISCLAIMER } from '../core/docs/documents';
import { Wizard } from './wizard/Wizard';
import { MaterialView } from './views/MaterialView';
import { progress } from '../core/wizard/steps';
import { BROWSER_DEMO } from './browserDemo';

export function App() {
  const project = useStore((s) => s.project);
  const ui = useStore((s) => s.ui);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const sync = useStore((s) => s.sync);
  const loadError = useStore((s) => s.loadError);
  const [importError, setImportError] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<'auto' | 'hell' | 'dunkel'>(() => {
    try { return (localStorage.getItem('ep.theme') as any) || 'auto'; } catch { return 'auto'; }
  });

  useEffect(() => { void store.restore(); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'auto' ? '' : theme === 'hell' ? 'light' : 'dark';
    try { localStorage.setItem('ep.theme', theme); } catch { /* egal */ }
  }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Projektdatei wird immer als eigenes, neues Projekt importiert – nichts wird überschrieben. */
  const importFile = async (f: File) => {
    setImportError(null);
    try {
      await store.importProject(await f.text(), f.name);
    } catch (e) {
      const err = e as ProjectLoadError;
      setImportError([`„${f.name}“ konnte nicht importiert werden: ${err.message}`, ...(err.issues ?? []).slice(0, 15)]);
    }
  };
  const openFileDialog = () => fileRef.current?.click();
  const inProject = !!project && ui.view !== 'projekte';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">⚡ Elektroplaner</div>
        <button className="pname linkish" onClick={() => void store.showProjects()} title="Zur Projektübersicht">{inProject ? project!.name : 'Projekte'}{inProject && <small> ▾ Projekte</small>}</button>
        <div className="actions">
          {inProject && <>
            <button disabled={!canUndo} onClick={store.undo} title="Rückgängig (Strg+Z)">↶</button>
            <button disabled={!canRedo} onClick={store.redo} title="Wiederholen (Strg+Y)">↷</button>
            <button onClick={() => downloadFile(`${project!.name.replace(/[^\wäöüÄÖÜß -]/g, '')}.elektroplan.json`, serializeProject(project!))} title="Projekt als Datei sichern oder weitergeben">Als Datei speichern</button>
          </>}
          <button onClick={openFileDialog} title="Projektdatei als neues Projekt hinzufügen">Datei importieren</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} title="Darstellung"><option value="auto">Auto</option><option value="hell">Hell</option><option value="dunkel">Dunkel</option></select>
        </div>
      </header>
      <div className="disclaimer">⚡ {DISCLAIMER}</div>
      {BROWSER_DEMO && <div className="disclaimer">Browser-Version zum Ausprobieren: Deine Projekte werden automatisch in diesem Browser gespeichert. Drucken/PDF, Datei-Downloads (Speichern, CSV, Excel) und die KI-Funktionen gehen hier nicht – dafür die App lokal oder auf dem eigenen Server betreiben.</div>}
      {loadError && <div className="error">{loadError}</div>}
      {importError && <div className="error">{importError.map((l, i) => <div key={i}>{l}</div>)}<button onClick={() => setImportError(null)}>Schließen</button></div>}
      {sync === 'konflikt' && (
        <div className="error">
          Das Projekt wurde inzwischen auf einem anderen Gerät geändert. Deine Änderungen hier sind noch nicht auf dem Server.{' '}
          <button onClick={() => void store.takeServer()}>Stand vom Server laden</button>{' '}
          <button className="danger" onClick={() => void store.keepMine()}>Meinen Stand behalten (Server überschreiben)</button>
        </div>
      )}
      {inProject ? <Workspace project={project!} /> : <div className="main single"><main className="content"><ProjectsView onImport={openFileDialog} /></main></div>}
    </div>
  );
}

function SaveStatus() {
  const server = useStore((s) => s.server);
  const sync = useStore((s) => s.sync);
  const savedAt = useStore((s) => s.savedAt);
  const where = server ? 'auf dem Server' : 'im Browser';
  const text = sync === 'konflikt' ? '⚠ Konflikt – siehe Hinweis oben'
    : sync === 'offline' ? `⚠ Nicht gespeichert – ${server ? 'Server nicht erreichbar' : 'Browser-Speicher nicht verfügbar'}`
    : sync === 'speichert' ? `Speichert ${where} …`
    : savedAt ? `Gespeichert ${where} ${savedAt}` : `Wird automatisch ${where} gespeichert`;
  return <div className="saved muted small">{text}</div>;
}

function Workspace({ project }: { project: Project }) {
  const ui = useStore((s) => s.ui);
  const report = runRules(project);
  const room = project.rooms.find((r) => r.id === ui.roomId);
  const wiz = progress(project);
  const nav = (view: typeof ui.view, roomId?: string) => store.setUi({ view, roomId, outletId: undefined, wallIndex: 0, tab: undefined });
  return (
      <div className="main">
        <nav className="side">
          <button onClick={() => void store.showProjects()}>← Alle Projekte</button>
          <button className={ui.view === 'assistent' ? 'active' : ''} onClick={() => nav('assistent')}><span>🧭 Assistent</span>{!project.wizard.finished && <span className="pill sev-hinweis">{wiz.done}/{wiz.total}</span>}</button>
          <div className="navhead">Expertenansicht</div>
          <button className={ui.view === 'projekt' ? 'active' : ''} onClick={() => nav('projekt')}>Projekt</button>
          <button className={ui.view === 'verteilung' ? 'active' : ''} onClick={() => nav('verteilung')}>Verteilung & Stromkreise</button>
          <div className="navhead">Räume</div>
          {project.floors.map((f) => (
            <div key={f.id}>
              <div className="navfloor">{f.name}</div>
              {project.rooms.filter((r) => r.floorId === f.id).map((r) => {
                const errs = report.findings.filter((x) => x.roomId === r.id && x.severity === 'fehler').length;
                const warns = report.findings.filter((x) => x.roomId === r.id && x.severity === 'warnung').length;
                return (
                  <button key={r.id} className={`room ${ui.view === 'raum' && ui.roomId === r.id ? 'active' : ''} ${r.inScope ? '' : 'out'}`} onClick={() => nav('raum', r.id)}>
                    <span>{r.confirmed ? '✔ ' : ''}{r.name}{r.formerName && r.formerName !== r.name ? <small> ({r.formerName})</small> : null}</span>
                    {errs > 0 ? <span className="pill sev-fehler">{errs}</span> : warns > 0 ? <span className="pill sev-warnung">{warns}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="navhead">Auswertung</div>
          <button className={ui.view === 'pruefung' ? 'active' : ''} onClick={() => nav('pruefung')}><span>Prüfung</span><span>{report.counts.fehler > 0 && <span className="pill sev-fehler">{report.counts.fehler}</span>} {report.counts.warnung > 0 && <span className="pill sev-warnung">{report.counts.warnung}</span>}</span></button>
          <button className={ui.view === 'material' ? 'active' : ''} onClick={() => nav('material')}>Material, Kosten, Aufgaben</button>
          <button className={ui.view === 'ausgaben' ? 'active' : ''} onClick={() => nav('ausgaben')}>Ausgaben / Druck</button>
          <button className={ui.view === 'versionen' ? 'active' : ''} onClick={() => nav('versionen')}>Versionen & Protokoll</button>
          <SaveStatus />
        </nav>
        <main className="content">
          {ui.view === 'assistent' && <Wizard project={project} />}
          {ui.view === 'projekt' && <ProjectView project={project} />}
          {ui.view === 'verteilung' && <DistributionView project={project} />}
          {ui.view === 'raum' && room && <RoomView key={room.id} project={project} room={room} outletId={ui.outletId} wallIndex={ui.wallIndex} tab={ui.tab} />}
          {ui.view === 'raum' && !room && <p>Raum nicht gefunden.</p>}
          {ui.view === 'pruefung' && <RulesView project={project} />}
          {ui.view === 'material' && <MaterialView project={project} />}
          {ui.view === 'ausgaben' && <OutputView project={project} />}
          {ui.view === 'versionen' && <VersionsView project={project} />}
        </main>
      </div>
  );
}
