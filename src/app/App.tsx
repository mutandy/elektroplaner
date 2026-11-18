import { useEffect, useRef, useState } from 'react';
import { store, useStore, downloadFile, exampleProject } from './store';
import { createProject, loadProject, ProjectLoadError, serializeProject } from '../core/model/factory';
import { runRules } from '../core/rules/rules';
import { ProjectView } from './views/ProjectView';
import { RoomView } from './views/RoomView';
import { DistributionView, OutputView, RulesView, VersionsView } from './views/OtherViews';
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
  const savedAt = useStore((s) => s.savedAt);
  const server = useStore((s) => s.server);
  const sync = useStore((s) => s.sync);
  const loadError = useStore((s) => s.loadError);
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

  const report = runRules(project);
  const room = project.rooms.find((r) => r.id === ui.roomId);

  const importFile = async (f: File) => {
    try {
      store.replace(loadProject(await f.text()), `Projektdatei „${f.name}“ geöffnet`);
    } catch (e) {
      const err = e as ProjectLoadError;
      alert(`${err.message}\n\n${(err.issues ?? []).slice(0, 15).join('\n')}`);
    }
  };

  const startNew = () => store.replace(createProject({ name: 'Neues Projekt' }), 'Neues Projekt angelegt');
  const wiz = progress(project);

  const nav = (view: typeof ui.view, roomId?: string) => store.setUi({ view, roomId, outletId: undefined, wallIndex: 0 });

  return (
    <div className="app">
      <header className="top">
        <div className="brand">⚡ Elektroplaner</div>
        <div className="pname">{project.name}</div>
        <div className="actions">
          <button disabled={!canUndo} onClick={store.undo} title="Rückgängig (Strg+Z)">↶</button>
          <button disabled={!canRedo} onClick={store.redo} title="Wiederholen (Strg+Y)">↷</button>
          <button onClick={() => downloadFile(`${project.name.replace(/[^\wäöüÄÖÜß -]/g, '')}.elektroplan.json`, serializeProject(project))}>Speichern als Datei</button>
          <button onClick={() => fileRef.current?.click()}>Öffnen</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          <button onClick={() => { if (confirm('Neues, leeres Projekt mit dem Assistenten beginnen? Das aktuelle bleibt über „Rückgängig“ erreichbar – vorher als Datei speichern!')) startNew(); }}>Neu</button>
          <button onClick={() => { if (confirm('Beispielprojekt „Kellerwohnung“ laden?')) store.replace(exampleProject(), 'Beispielprojekt geladen'); }}>Beispiel</button>
          <select value={theme} onChange={(e) => setTheme(e.target.value as any)} title="Darstellung"><option value="auto">Auto</option><option value="hell">Hell</option><option value="dunkel">Dunkel</option></select>
        </div>
      </header>
      <div className="disclaimer">⚡ {DISCLAIMER}</div>
      {BROWSER_DEMO && <div className="disclaimer">Browser-Version zum Ausprobieren: Dein Projekt wird automatisch in diesem Browser gespeichert. Drucken/PDF, Datei-Downloads (Speichern, CSV, Excel) und die KI-Funktionen gehen hier nicht – dafür die App lokal installieren.</div>}
      {loadError && <div className="error">{loadError}</div>}
      {sync === 'konflikt' && (
        <div className="error">
          Das Projekt wurde inzwischen auf einem anderen Gerät geändert. Deine Änderungen hier sind noch nicht auf dem Server.{' '}
          <button onClick={() => void store.takeServer()}>Stand vom Server laden</button>{' '}
          <button className="danger" onClick={() => void store.keepMine()}>Meinen Stand behalten (Server überschreiben)</button>
        </div>
      )}
      <div className="main">
        <nav className="side">
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
          <div className="saved muted small">{server
            ? sync === 'konflikt' ? '⚠ Konflikt – siehe Hinweis oben' : sync === 'offline' ? '⚠ Server nicht erreichbar – Stand nur in diesem Browser' : sync === 'speichert' ? 'Speichert auf dem Server …' : savedAt ? `Auf dem Server gesichert ${savedAt}` : 'Zentral auf dem Server gespeichert'
            : savedAt ? `Im Browser gesichert ${savedAt}` : 'Noch nicht gesichert'}</div>
        </nav>
        <main className="content">
          {ui.view === 'willkommen' && <Welcome onNew={startNew} onExample={() => store.replace(exampleProject(), 'Beispielprojekt geladen')} onOpen={() => fileRef.current?.click()} />}
          {ui.view === 'assistent' && <Wizard project={project} />}
          {ui.view === 'projekt' && <ProjectView project={project} />}
          {ui.view === 'verteilung' && <DistributionView project={project} />}
          {ui.view === 'raum' && room && <RoomView key={room.id} project={project} room={room} outletId={ui.outletId} wallIndex={ui.wallIndex} />}
          {ui.view === 'raum' && !room && <p>Raum nicht gefunden.</p>}
          {ui.view === 'pruefung' && <RulesView project={project} />}
          {ui.view === 'material' && <MaterialView project={project} />}
          {ui.view === 'ausgaben' && <OutputView project={project} />}
          {ui.view === 'versionen' && <VersionsView project={project} />}
        </main>
      </div>
    </div>
  );
}

function Welcome({ onNew, onExample, onOpen }: { onNew: () => void; onExample: () => void; onOpen: () => void }) {
  return (
    <div className="welcome">
      <h1>Elektroplanung für Wohngebäude</h1>
      <p>Das Programm fragt Schritt für Schritt alles ab, was für die Planung nötig ist – Projekt, Verteilung, Räume, Wände, Türen, Boden, Decke, Nutzung – und macht erst danach Vorschläge. Am Ende stehen Raumlayouts, Ausführungsplan, Dosen- und Stromkreislisten.</p>
      <div className="cards">
        <button className="card primary-card" onClick={onNew}><b>Neues Projekt beginnen</b><span>Der Assistent führt dich von Null an durch alle Fragen.</span></button>
        <button className="card" onClick={onOpen}><b>Projektdatei öffnen</b><span>Eine gespeicherte *.elektroplan.json laden.</span></button>
        <button className="card" onClick={onExample}><b>Beispiel ansehen</b><span>Kellerwohnung mit Bad, Küche, Heimkino, Garage – fertig ausgefüllt.</span></button>
      </div>
    </div>
  );
}
