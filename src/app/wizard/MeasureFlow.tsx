/**
 * Aufmaß Schritt für Schritt – fürs Handy gebaut: eine Frage pro Bildschirm,
 * große Eingabefelder, Skizze mit der gerade gemeinten Wand. Am Ende entsteht
 * daraus der Raum mit Kamin/Vorsprüngen und richtig sitzenden Öffnungen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Room } from '../../core/model/schema';
import { createRectRoom, newId } from '../../core/model/factory';
import {
  applyMeasure, checkOpening, cornerWalls, defaultsFor, draftComplete, draftFromRoom, emptyDraft, notchError, notchWhatLabel, openingKindLabel, openingS, shapeRoom, shapeWalls, WALL_HINT,
  type MeasureDraft, type MeasuredNotch, type MeasuredOpening, type NotchWhat, type OpeningKind,
} from '../../core/wizard/measure';
import { fmt, roomArea } from '../../core/geometry/room';
import { store } from '../store';

type Step = 'start' | 'l1' | 'l2' | 'hoehe' | 'vorsprung' | 'n-ort' | 'n-masse' | 'liste' | 'o-art' | 'o-wand' | 'o-abstand' | 'o-breite' | 'o-hoehe' | 'o-bruestung' | 'o-tuer' | 'name' | 'fertig';

const storageKey = (k: string) => `ep.aufmass.${k}`;
function loadSaved(k: string): MeasureDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(k));
    return raw ? { ...emptyDraft(''), ...JSON.parse(raw) } : null; // ältere Entwürfe ohne Vorsprünge
  } catch { return null; }
}
function save(k: string, d: MeasureDraft | null) {
  try { if (d) localStorage.setItem(storageKey(k), JSON.stringify(d)); else localStorage.removeItem(storageKey(k)); } catch { /* egal */ }
}

const CORNER_LABEL = ['zwischen Wand 4 und Wand 1', 'zwischen Wand 1 und Wand 2', 'zwischen Wand 2 und Wand 3', 'zwischen Wand 3 und Wand 4'];

export function MeasureFlow({ project, floorId, room, onClose, startAt, fresh }: {
  project: Project; floorId: string; room?: Room; onClose: (createdRoomId?: string) => void; startAt?: 'start' | 'liste';
  /** Form neu erfassen, auch wenn der Raum schon eine andere Form hat */
  fresh?: boolean;
}) {
  const key = room ? `raum.${room.id}${fresh ? '.neu' : ''}` : `neu.${floorId}`;
  const initial = () => (room ? (fresh ? { ...emptyDraft(room.name), height: room.height } : draftFromRoom(room)) : emptyDraft(''));
  const [draft, setDraft] = useState<MeasureDraft>(() => loadSaved(key) ?? initial());
  const fixed = !!draft.fixedPolygon;
  const [step, setStep] = useState<Step>(startAt ?? (fixed ? 'liste' : 'start'));
  const [cur, setCur] = useState<MeasuredOpening | null>(null);
  const [notch, setNotch] = useState<MeasuredNotch | null>(null);
  const resumed = useRef(!!loadSaved(key));
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);
  useEffect(() => { save(key, draft); }, [key, draft]);
  const hRef = project.settings.heightReference.label;
  const walls = useMemo(() => shapeWalls(draft), [draft]);

  const upd = (patch: Partial<MeasureDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const updCur = (patch: Partial<MeasuredOpening>) => setCur((c) => (c ? { ...c, ...patch } : c));
  const updNotch = (patch: Partial<MeasuredNotch>) => setNotch((c) => (c ? { ...c, ...patch } : c));

  const startOpening = (kind: OpeningKind) => {
    setCur({ id: newId('m'), kind, wall: 0, distance: 0, from: 'links', ...defaultsFor(kind) });
    setStep('o-wand');
  };
  const commitOpening = () => {
    if (!cur) return;
    setDraft((d) => ({ ...d, openings: d.openings.some((o) => o.id === cur.id) ? d.openings.map((o) => (o.id === cur.id ? cur : o)) : [...d.openings, cur] }));
    setCur(null);
    setStep('liste');
  };
  const startNotch = (kind: 'ecke' | 'wand') => {
    setNotch({ id: newId('v'), kind, what: 'kamin', corner: kind === 'ecke' ? 3 : undefined, wall: kind === 'wand' ? 0 : undefined, from: kind === 'wand' ? 50 : undefined, a: kind === 'ecke' ? 50 : 50, b: kind === 'ecke' ? 50 : 30 });
    setStep('n-ort');
  };
  const commitNotch = () => {
    if (!notch) return;
    // Wandnummern der Öffnungen hängen an der Form: bei geänderter Form neu zuordnen lassen
    setDraft((d) => ({ ...d, notches: d.notches.some((n) => n.id === notch.id) ? d.notches.map((n) => (n.id === notch.id ? notch : n)) : [...d.notches, notch] }));
    setNotch(null);
    setStep('vorsprung');
  };
  const curIssues = cur ? checkOpening({ ...draft, openings: draft.openings.filter((o) => o.id !== cur.id) }, cur) : [];
  const notchErr = notch ? notchError(draft, notch) : null;

  const finish = () => {
    if (!draftComplete(draft)) return;
    if (room) {
      store.update(`${room.name}: Aufmaß Schritt für Schritt übernommen`, (p) => { const r = p.rooms.find((x) => x.id === room.id); if (r) applyMeasure(r as Room, draft); });
      save(key, null);
      onClose(room.id);
      return;
    }
    const fb = project.settings.defaultFutureBuildup;
    const id = newId('raum');
    const base = createRectRoom({
      id, floorId, name: draft.name.trim() || `Raum ${project.rooms.length + 1}`, width: draft.length1!, depth: draft.length2!, height: draft.height!, provenance: 'gemessen',
      installationType: project.settings.defaultInstallationType,
      floor: fb ? { futureAboveRef: [{ name: 'Bodenaufbau (Vorgabe)', thickness: fb }] } : {},
    });
    store.update(`Raum „${base.name}“ aufgemessen`, (p) => {
      p.rooms.push(base as any);
      applyMeasure(p.rooms[p.rooms.length - 1] as Room, draft);
    });
    save(key, null);
    onClose(id);
  };

  // --- Reihenfolge der Schritte -----------------------------------------------
  const order: Step[] = fixed
    ? ['liste', 'fertig']
    : ['start', 'l1', 'l2', 'hoehe', 'vorsprung', 'liste', ...(room ? [] : ['name' as Step]), 'fertig'];
  const curOrder: Step[] = cur ? ['o-art', 'o-wand', 'o-abstand', 'o-breite', 'o-hoehe', ...(cur.kind === 'fenster' || cur.kind === 'sonstiges' ? ['o-bruestung' as Step] : []), ...(cur.kind === 'tuer' ? ['o-tuer' as Step] : [])] : [];
  const inOpening = step.startsWith('o-');
  const inNotch = step.startsWith('n-');
  const next = () => {
    if (inOpening) {
      const i = curOrder.indexOf(step);
      if (i === curOrder.length - 1) commitOpening(); else setStep(curOrder[i + 1]);
      return;
    }
    if (inNotch) { if (step === 'n-ort') setStep('n-masse'); else commitNotch(); return; }
    const i = order.indexOf(step);
    if (i < order.length - 1) setStep(order[i + 1]);
  };
  const back = () => {
    if (inOpening) {
      const i = curOrder.indexOf(step);
      if (i <= 1) { setCur(null); setStep('liste'); } else setStep(curOrder[i - 1]);
      return;
    }
    if (inNotch) { if (step === 'n-masse') setStep('n-ort'); else { setNotch(null); setStep('vorsprung'); } return; }
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]); else onClose();
  };

  const valid: Record<Step, boolean> = {
    start: true,
    l1: !!draft.length1 && draft.length1 >= 30,
    l2: !!draft.length2 && draft.length2 >= 30,
    hoehe: !!draft.height && draft.height >= 100,
    vorsprung: draft.notches.every((n) => !notchError({ ...draft, notches: draft.notches.filter((x) => x.id !== n.id) }, n)),
    'n-ort': true,
    'n-masse': !!notch && !notchErr,
    liste: draft.openings.every((o) => checkOpening(draft, o).length === 0),
    'o-art': true,
    'o-wand': true,
    'o-abstand': !!cur && cur.distance >= 0,
    'o-breite': !!cur && cur.width > 0 && !curIssues.some((m) => /Passt nicht|Überschneidet/.test(m)),
    'o-hoehe': !!cur && cur.height > 0 && !curIssues.some((m) => /Höher/.test(m)),
    'o-bruestung': !!cur && (cur.sill ?? -1) >= 0 && !curIssues.length,
    'o-tuer': !!cur && !curIssues.length,
    name: true,
    fertig: draftComplete(draft),
  };

  const total = order.length - 1;
  const pos = inOpening ? order.indexOf('liste') : inNotch ? order.indexOf('vorsprung') : order.indexOf(step);
  const highlight = inOpening && cur ? cur.wall : step === 'l1' ? 0 : step === 'l2' ? 1 : undefined;
  const previewDraft = step === 'n-masse' && notch && !notchErr ? { ...draft, notches: [...draft.notches.filter((n) => n.id !== notch.id), notch] } : draft;
  const area = (() => { try { return roomArea(shapeRoom(draft)); } catch { return ((draft.length1 ?? 0) * (draft.length2 ?? 0)) / 10000; } })();
  const wallName = (i: number) => `Wand ${i + 1}${walls[i]?.label ? ` (${walls[i].label})` : ''}`;
  const notchText = (n: MeasuredNotch) => n.kind === 'ecke'
    ? `${notchWhatLabel[n.what]} in der Ecke ${CORNER_LABEL[n.corner!]}, ${fmt(n.a)} × ${fmt(n.b)} cm`
    : `${notchWhatLabel[n.what]} an Wand ${n.wall! + 1}, ${fmt(n.from)} cm ab links, ${fmt(n.a)} breit, ${fmt(n.b)} tief`;

  return (
    <div className="measure" role="dialog" aria-modal="true" aria-label="Aufmaß Schritt für Schritt">
      <header className="measure-head">
        <button className="measure-x" onClick={() => onClose()} aria-label="Schließen">✕</button>
        <div className="measure-title">
          <b>{room ? `Aufmaß: ${room.name}` : 'Neuen Raum aufmessen'}</b>
          <span className="muted small">{inOpening && cur ? `${openingKindLabel[cur.kind]}, ` : inNotch && notch ? `${notchWhatLabel[notch.what]}, ` : ''}Schritt {Math.max(1, pos + (fixed ? 1 : 0))} von {total + (fixed ? 1 : 0)}</span>
        </div>
      </header>
      <div className="measure-progress"><span style={{ transform: `scaleX(${Math.max(0, pos) / total})` }} /></div>

      <div className="measure-body" ref={bodyRef}>
        {step !== 'start' && step !== 'o-art' && <Sketch draft={previewDraft} highlight={highlight} cur={inOpening ? cur : null} measuring={step === 'o-abstand'}
          corner={step === 'n-ort' && notch?.kind === 'ecke' ? notch.corner : undefined} notchWall={step === 'n-ort' && notch?.kind === 'wand' ? notch.wall : undefined} />}

        {step === 'start' && (
          <div className="mq">
            <h2>So geht's</h2>
            <ol className="mq-list">
              <li>Stell dich in den Raum und such dir eine Wand als <b>Wand 1</b> aus – am besten die mit der Eingangstür. Schau auf diese Wand.</li>
              <li><b>Wand 2</b> ist dann rechts von dir, <b>Wand 3</b> hinter dir, <b>Wand 4</b> links.</li>
              <li>Miss die Längen von Ecke zu Ecke, als wäre der Raum ein Rechteck. Einen Kamin oder Vorsprung trägst du danach extra ein.</li>
              <li>Öffnungen misst du mit Blick auf ihre Wand von der <b>linken Ecke</b> aus – oder von rechts, wenn das einfacher ist.</li>
            </ol>
            {resumed.current && <p className="mq-note">Ein angefangenes Aufmaß wurde wiederhergestellt. <button className="linklike" onClick={() => { setDraft(initial()); resumed.current = false; }}>Neu beginnen</button></p>}
            {room && room.outlets.length > 0 && <p className="mq-note">Dieser Raum hat schon {room.outlets.length} Auslässe. Sie behalten ihre Wand und ihren Abstand – nach dem Aufmaß bitte kurz prüfen.</p>}
          </div>
        )}

        {step === 'l1' && <Q title="Wie lang ist Wand 1?" hint="Die Wand, vor der du stehst – von Ecke zu Ecke.">
          <BigNumber key={step} value={draft.length1} onChange={(v) => upd({ length1: v })} onEnter={() => valid.l1 && next()} unit="cm" />
        </Q>}
        {step === 'l2' && <Q title="Wie lang ist Wand 2?" hint="Die Wand rechts von dir – von Ecke zu Ecke.">
          <BigNumber key={step} value={draft.length2} onChange={(v) => upd({ length2: v })} onEnter={() => valid.l2 && next()} unit="cm" />
        </Q>}
        {step === 'hoehe' && <Q title="Wie hoch ist der Raum?" hint={`Vom Fußboden (${hRef}) bis zur Decke.`}>
          <BigNumber key={step} value={draft.height} onChange={(v) => upd({ height: v })} onEnter={() => valid.hoehe && next()} unit="cm" />
        </Q>}

        {step === 'vorsprung' && (
          <div className="mq">
            <h2>Gibt es einen Kamin, Schacht oder Vorsprung?</h2>
            <p className="muted">Alles, was in den Raum hineinragt. Dort wird nicht geschlitzt und keine Dose gesetzt.</p>
            {draft.notches.length > 0 && <ul className="mq-openings">
              {draft.notches.map((n) => {
                const err = notchError({ ...draft, notches: draft.notches.filter((x) => x.id !== n.id) }, n);
                return (
                  <li key={n.id} className={err ? 'bad' : ''}>
                    <div><b>{notchWhatLabel[n.what]}</b><div className="muted small">{notchText(n)}</div>{err && <div className="sev-fehler small">{err}</div>}</div>
                    <span className="mq-row-actions">
                      <button onClick={() => { setNotch(n); setStep('n-ort'); }}>Ändern</button>
                      <button className="danger" onClick={() => upd({ notches: draft.notches.filter((x) => x.id !== n.id) })} aria-label="Entfernen">✕</button>
                    </span>
                  </li>
                );
              })}
            </ul>}
            <div className="mq-choices">
              <button className="mq-choice" onClick={() => startNotch('ecke')}>＋ In einer Ecke<span>z. B. Kamin oder Schacht in der Raumecke</span></button>
              <button className="mq-choice" onClick={() => startNotch('wand')}>＋ Mitten an einer Wand<span>z. B. Pfeiler, Kamin oder Schacht zwischen den Ecken</span></button>
            </div>
            {draft.openings.length > 0 && draft.notches.length > 0 && <p className="mq-note">Prüfe danach kurz die Türen und Fenster: Wände an einem Vorsprung bekommen neue Nummern.</p>}
          </div>
        )}

        {step === 'n-ort' && notch && (notch.kind === 'ecke'
          ? <Q title="In welcher Ecke?">
            <div className="mq-toggle" role="group" aria-label="Was ist es">
              {(['kamin', 'schacht', 'vorsprung'] as NotchWhat[]).map((w) => <button key={w} className={notch.what === w ? 'active' : ''} onClick={() => updNotch({ what: w })}>{notchWhatLabel[w]}</button>)}
            </div>
            <div className="mq-choices two">
              {([0, 1, 2, 3] as const).map((c) => <button key={c} className={`mq-choice ${notch.corner === c ? 'active' : ''}`} onClick={() => updNotch({ corner: c })}>Ecke {c + 1}<span>{CORNER_LABEL[c]}</span></button>)}
            </div>
          </Q>
          : <Q title="An welcher Wand?" hint="Abstand von der linken Ecke dieser Wand bis zum Vorsprung.">
            <div className="mq-toggle" role="group" aria-label="Was ist es">
              {(['kamin', 'schacht', 'vorsprung'] as NotchWhat[]).map((w) => <button key={w} className={notch.what === w ? 'active' : ''} onClick={() => updNotch({ what: w })}>{notchWhatLabel[w]}</button>)}
            </div>
            <div className="mq-choices two">
              {[0, 1, 2, 3].map((w) => <button key={w} className={`mq-choice ${notch.wall === w ? 'active' : ''}`} onClick={() => updNotch({ wall: w })}>Wand {w + 1}<span>{WALL_HINT[w]}</span></button>)}
            </div>
            <BigNumber key={`von-${notch.id}`} value={notch.from} onChange={(v) => updNotch({ from: v ?? 0 })} unit="cm" />
          </Q>)}
        {step === 'n-masse' && notch && (() => {
          const [wIn, wOut] = notch.kind === 'ecke' ? cornerWalls(notch.corner!) : [0, 0];
          return <Q title={`Wie groß ist ${notch.what === 'kamin' ? 'der Kamin' : notch.what === 'schacht' ? 'der Schacht' : 'der Vorsprung'}?`}
            hint={notch.kind === 'ecke' ? `Wie weit er an Wand ${wIn + 1} und an Wand ${wOut + 1} entlang reicht.` : 'Breite entlang der Wand, Tiefe in den Raum hinein.'}>
            <label className="mq-label">{notch.kind === 'ecke' ? `Entlang Wand ${wIn + 1}` : 'Breite'}</label>
            <BigNumber key={`a-${notch.id}`} value={notch.a} onChange={(v) => updNotch({ a: v ?? 0 })} unit="cm" />
            <label className="mq-label">{notch.kind === 'ecke' ? `Entlang Wand ${wOut + 1}` : 'Tiefe in den Raum'}</label>
            <BigNumber key={`b-${notch.id}`} value={notch.b} onChange={(v) => updNotch({ b: v ?? 0 })} onEnter={() => valid['n-masse'] && next()} unit="cm" focus={false} />
            {notchErr && <Issues list={[notchErr]} />}
          </Q>;
        })()}

        {step === 'liste' && (
          <div className="mq">
            <h2>Türen, Fenster und andere Öffnungen</h2>
            <p className="muted">{draft.openings.length ? 'Gibt es noch weitere?' : 'Gibt es Türen, Fenster, ein Tor oder Durchgänge? Trag jede einzeln ein.'}</p>
            {draft.openings.length > 0 && <ul className="mq-openings">
              {draft.openings.map((o) => {
                const issues = checkOpening(draft, o);
                return (
                  <li key={o.id} className={issues.length ? 'bad' : ''}>
                    <div><b>{openingKindLabel[o.kind]}</b>, {wallName(o.wall)}<div className="muted small">{fmt(openingS(draft, o))} cm ab linker Ecke, {fmt(o.width)} × {fmt(o.height)} cm{o.sill != null && (o.kind === 'fenster' || o.kind === 'sonstiges') ? `, Brüstung ${fmt(o.sill)}` : ''}</div>{issues.map((m) => <div key={m} className="sev-fehler small">{m}</div>)}</div>
                    <span className="mq-row-actions">
                      <button onClick={() => { setCur(o); setStep('o-wand'); }}>Ändern</button>
                      <button className="danger" onClick={() => upd({ openings: draft.openings.filter((x) => x.id !== o.id) })} aria-label="Entfernen">✕</button>
                    </span>
                  </li>
                );
              })}
            </ul>}
            <div className="mq-choices">
              {(Object.keys(openingKindLabel) as OpeningKind[]).map((k) => <button key={k} className="mq-choice" onClick={() => startOpening(k)}>＋ {openingKindLabel[k]}</button>)}
            </div>
          </div>
        )}

        {step === 'o-wand' && cur && <Q title={`In welcher Wand ist ${artikel(cur.kind)} ${openingKindLabel[cur.kind]}?`}>
          <div className="mq-choices two">
            {walls.map((w, i) => <button key={i} className={`mq-choice ${cur.wall === i ? 'active' : ''}`} onClick={() => { updCur({ wall: i }); setStep('o-abstand'); }}>Wand {i + 1}<span>{w.label || (walls.length === 4 ? WALL_HINT[i] : '')}{w.label || walls.length === 4 ? ', ' : ''}{fmt(w.length)} cm</span></button>)}
          </div>
        </Q>}
        {step === 'o-abstand' && cur && <Q title="Wie weit ist sie von der Ecke entfernt?" hint={`Schau auf Wand ${cur.wall + 1} und miss von der Ecke bis zur Kante der Öffnung (Rohbau, ohne Zarge/Rahmen). Am Kamin ist die Kaminkante die Ecke.`}>
          <div className="mq-toggle" role="group" aria-label="Gemessen von">
            <button className={cur.from === 'links' ? 'active' : ''} onClick={() => updCur({ from: 'links' })}>von der linken Ecke</button>
            <button className={cur.from === 'rechts' ? 'active' : ''} onClick={() => updCur({ from: 'rechts' })}>von der rechten Ecke</button>
          </div>
          <BigNumber key={step + cur.id} value={cur.distance} onChange={(v) => updCur({ distance: v ?? 0 })} onEnter={() => valid['o-abstand'] && next()} unit="cm" />
        </Q>}
        {step === 'o-breite' && cur && <Q title="Wie breit ist die Öffnung?" hint={cur.kind === 'tuer' ? 'Rohbauöffnung von Kante zu Kante (Normtür 88,5 cm, breite Tür 101 cm).' : 'Von Kante zu Kante im Rohbau.'}>
          <BigNumber key={step + cur.id} value={cur.width} onChange={(v) => updCur({ width: v ?? 0 })} onEnter={() => valid['o-breite'] && next()} unit="cm" />
          <Issues list={curIssues.filter((m) => /Passt nicht|Überschneidet/.test(m))} />
        </Q>}
        {step === 'o-hoehe' && cur && <Q title="Wie hoch ist die Öffnung?" hint={cur.kind === 'tuer' ? 'Rohbauöffnung (Normtür 201 cm).' : undefined}>
          <BigNumber key={step + cur.id} value={cur.height} onChange={(v) => updCur({ height: v ?? 0 })} onEnter={() => valid['o-hoehe'] && next()} unit="cm" />
          <Issues list={curIssues.filter((m) => /Höher/.test(m))} />
        </Q>}
        {step === 'o-bruestung' && cur && <Q title="Wie hoch ist die Brüstung?" hint="Vom Fußboden bis zur Unterkante der Öffnung.">
          <BigNumber key={step + cur.id} value={cur.sill ?? null} onChange={(v) => updCur({ sill: v ?? 0 })} onEnter={() => valid['o-bruestung'] && next()} unit="cm" />
          <Issues list={curIssues} />
        </Q>}
        {step === 'o-tuer' && cur && <Q title="Wie geht die Tür auf?">
          <p className="mq-label">Wo sind die Bänder (Scharniere)? <span className="muted">Blick von innen</span></p>
          <div className="mq-toggle">
            <button className={cur.hinge === 'links' ? 'active' : ''} onClick={() => updCur({ hinge: 'links' })}>links</button>
            <button className={cur.hinge === 'rechts' ? 'active' : ''} onClick={() => updCur({ hinge: 'rechts' })}>rechts</button>
          </div>
          <p className="mq-label">Geht sie in diesen Raum auf?</p>
          <div className="mq-toggle">
            <button className={cur.swing === 'innen' ? 'active' : ''} onClick={() => updCur({ swing: 'innen' })}>ja, nach innen</button>
            <button className={cur.swing === 'aussen' ? 'active' : ''} onClick={() => updCur({ swing: 'aussen' })}>nein, nach außen</button>
          </div>
          <p className="mq-label">Führt zu (optional)</p>
          <input className="mq-text" value={cur.leadsTo ?? ''} placeholder="z. B. Flur" onChange={(e) => updCur({ leadsTo: e.target.value })} />
          <Issues list={curIssues} />
        </Q>}

        {step === 'name' && <Q title="Wie heißt der Raum?" hint="Der künftige Name, z. B. „Küche“. Die Nutzung fragt der Assistent danach ab.">
          <input className="mq-text big" value={draft.name} autoFocus placeholder={`Raum ${project.rooms.length + 1}`} onChange={(e) => upd({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && next()} />
        </Q>}

        {step === 'fertig' && (
          <div className="mq">
            <h2>Passt das so?</h2>
            <ul className="mq-summary">
              {!fixed && <li>Wand 1: <b>{fmt(draft.length1)} cm</b>, Wand 2: <b>{fmt(draft.length2)} cm</b></li>}
              <li>Höhe: <b>{fmt(draft.height)} cm</b>, Fläche {fmt(area, 2)} m²</li>
              {draft.notches.map((n) => <li key={n.id}>{notchText(n)}</li>)}
              <li>{draft.openings.length ? `${draft.openings.length} Öffnung(en): ${draft.openings.map((o) => `${openingKindLabel[o.kind]} (W${o.wall + 1})`).join(', ')}` : 'keine Öffnungen'}</li>
            </ul>
            {!draftComplete(draft) && <p className="sev-fehler">Es fehlen noch Angaben oder etwas passt nicht – bitte zurückgehen.</p>}
            <p className="muted small">Wandmaterial, Boden, Decke und Nutzung fragt der Assistent als Nächstes ab. Alles lässt sich später noch ändern.</p>
          </div>
        )}
      </div>

      <footer className="measure-foot">
        <button className="mq-back" onClick={back}>{step === order[0] && !inOpening ? 'Abbrechen' : '← Zurück'}</button>
        {step === 'fertig'
          ? <button className="primary mq-next" disabled={!valid.fertig} onClick={finish}>{room ? 'Maße übernehmen' : 'Raum anlegen'}</button>
          : step === 'liste'
            ? <button className="primary mq-next" disabled={!valid.liste} onClick={next}>{draft.openings.length ? 'Fertig mit Öffnungen →' : 'Keine (weiter) →'}</button>
            : step === 'vorsprung'
              ? <button className="primary mq-next" disabled={!valid.vorsprung} onClick={next}>{draft.notches.length ? 'Weiter →' : 'Nein, nichts (weiter) →'}</button>
              : step === 'o-art' || step === 'o-wand' ? <span /> : <button className="primary mq-next" disabled={!valid[step]} onClick={next}>{(inOpening && curOrder.indexOf(step) === curOrder.length - 1) || step === 'n-masse' ? 'Speichern ✓' : 'Weiter →'}</button>}
      </footer>
    </div>
  );
}

const artikel = (k: OpeningKind) => (k === 'tuer' ? 'die' : k === 'tor' ? 'das' : k === 'durchgang' ? 'der' : k === 'fenster' ? 'das' : 'die');

function Q({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mq">
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </div>
  );
}

function Issues({ list }: { list: string[] }) {
  return list.length ? <div className="mq-issues">{list.map((m) => <div key={m}>{m}</div>)}</div> : null;
}

/** Großes Zahlenfeld mit Ziffernblock auf dem Handy; Komma oder Punkt. */
function BigNumber({ value, onChange, onEnter, unit, focus = true }: { value: number | null | undefined; onChange: (v: number | null) => void; onEnter?: () => void; unit: string; focus?: boolean }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value).replace('.', ','));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, [focus]);
  return (
    <label className="mq-num">
      <input ref={ref} inputMode="decimal" enterKeyHint="next" autoComplete="off" value={txt}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.]/g, '');
          setTxt(t);
          const v = Number(t.replace(',', '.'));
          onChange(t === '' || !Number.isFinite(v) ? null : v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }} />
      <span>{unit}</span>
    </label>
  );
}

/** Draufsicht-Skizze der echten Form: Wände nummeriert, aktuelle Wand hervorgehoben, Öffnungen und Vorsprünge eingezeichnet. */
function Sketch({ draft, highlight, cur, measuring, corner, notchWall }: { draft: MeasureDraft; highlight?: number; cur: MeasuredOpening | null; measuring: boolean; corner?: number; notchWall?: number }) {
  let room: Room;
  try { room = shapeRoom(draft); } catch { room = shapeRoom({ ...draft, notches: [] }); }
  const poly = room.polygon;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = maxX - minX || 400, D = maxY - minY || 300;
  const pad = Math.max(W, D) * 0.16;
  const side = Math.max(W, D) * 0.3;
  const u = Math.max(W, D) / 100;
  const n = poly.length;
  const wall = (i: number) => ({ a: poly[i], b: poly[(i + 1) % n] });
  const len = (i: number) => { const { a, b } = wall(i); return Math.hypot(b.x - a.x, b.y - a.y); };
  const along = (i: number, s: number) => { const { a, b } = wall(i); const L = len(i) || 1; return { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L }; };
  const inward = (i: number) => { const { a, b } = wall(i); const L = len(i) || 1; return { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }; };
  const list = cur ? [...draft.openings.filter((o) => o.id !== cur.id), cur] : draft.openings;
  const color: Record<OpeningKind, string> = { tuer: 'var(--accent)', fenster: 'var(--ep-daten)', tor: 'var(--ep-licht)', durchgang: 'var(--ep-dim)', sonstiges: 'var(--muted)' };
  const mark = 'var(--color-accent-deep)';
  const rectCorners = [{ x: 0, y: 0 }, { x: draft.length1 || 400, y: 0 }, { x: draft.length1 || 400, y: draft.length2 || 300 }, { x: 0, y: draft.length2 || 300 }];
  // Rechteck-Wand für die Vorsprung-Auswahl (vor dem Ausschneiden)
  const rw = notchWall != null ? { a: rectCorners[notchWall], b: rectCorners[(notchWall + 1) % 4] } : null;
  const labelFor = (i: number) => (n === 4 || len(i) >= Math.max(W, D) * 0.25 || highlight === i);
  return (
    <svg className="mq-sketch" viewBox={`${minX - side} ${minY - pad} ${W + 2 * side} ${D + 2 * pad}`} role="img" aria-label="Skizze des Raums">
      <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--panel)" stroke="var(--ink)" strokeWidth={u * 1.2} />
      {room.walls.map((w, i) => w.zones.some((z) => z.kind === 'kaminwange' || z.kind === 'tabu')
        ? <line key={`z${i}`} x1={wall(i).a.x} y1={wall(i).a.y} x2={wall(i).b.x} y2={wall(i).b.y} stroke="var(--muted)" strokeWidth={u * 2.4} strokeDasharray={`${u * 2} ${u * 1.5}`} /> : null)}
      {poly.map((_, i) => {
        if (!labelFor(i)) return null;
        const { a, b } = wall(i);
        const m = along(i, len(i) / 2);
        const nn = inward(i);
        const horizontal = Math.abs(nn.y) > Math.abs(nn.x);
        const lab = horizontal ? { x: m.x, y: m.y - nn.y * pad * 0.5 } : { x: m.x - nn.x * u * 3, y: m.y };
        const anchor = horizontal ? 'middle' : nn.x < 0 ? 'start' : 'end';
        const hl = highlight === i;
        return (
          <g key={i}>
            {hl && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={mark} strokeWidth={u * 3} strokeLinecap="round" />}
            <text x={lab.x} y={lab.y} fontSize={u * 6} textAnchor={anchor} dominantBaseline="central" fill={hl ? mark : 'var(--muted)'} fontWeight={hl ? 700 : 400}>W{i + 1}{n === 4 || hl ? ` · ${fmt(len(i))}` : ''}</text>
          </g>
        );
      })}
      {corner != null && <circle cx={rectCorners[corner].x} cy={rectCorners[corner].y} r={u * 4} fill="none" stroke={mark} strokeWidth={u * 1.5} />}
      {rw && <line x1={rw.a.x} y1={rw.a.y} x2={rw.b.x} y2={rw.b.y} stroke={mark} strokeWidth={u * 3} strokeLinecap="round" />}
      {list.map((o) => {
        if (o.wall >= n) return null;
        const s = openingS(draft, o);
        const p1 = along(o.wall, s), p2 = along(o.wall, s + o.width);
        const isCur = cur?.id === o.id;
        return <line key={o.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color[o.kind]} strokeWidth={u * (isCur ? 4 : 3)} opacity={isCur ? 1 : 0.8} />;
      })}
      {cur && measuring && cur.wall < n && (() => {
        const L = len(cur.wall);
        const s0 = cur.from === 'links' ? 0 : L;
        const s1 = cur.from === 'links' ? cur.distance : L - cur.distance;
        const nn = inward(cur.wall);
        const off = u * 6;
        const p0 = along(cur.wall, s0), p1 = along(cur.wall, s1);
        const q0 = { x: p0.x + nn.x * off, y: p0.y + nn.y * off }, q1 = { x: p1.x + nn.x * off, y: p1.y + nn.y * off };
        return <g stroke={mark} strokeWidth={u * 0.8} fill={mark}>
          <line x1={q0.x} y1={q0.y} x2={q1.x} y2={q1.y} />
          <circle cx={q0.x} cy={q0.y} r={u * 1.4} />
          <circle cx={q1.x} cy={q1.y} r={u * 1.4} />
          <text x={(q0.x + q1.x) / 2 + nn.x * u * 5} y={(q0.y + q1.y) / 2 + nn.y * u * 5} fontSize={u * 5} textAnchor="middle" dominantBaseline="central" stroke="none">{fmt(cur.distance)}</text>
        </g>;
      })()}
      {/* Standpunkt: Blick auf Wand 1 */}
      {(highlight === undefined || highlight === 0) && corner == null && notchWall == null
        ? <g fill="var(--muted)"><circle cx={minX + W / 2} cy={minY + D * 0.72} r={u * 3} /><path d={`M${minX + W / 2 - u * 3} ${minY + D * 0.72 - u * 4}L${minX + W / 2} ${minY + D * 0.72 - u * 9}L${minX + W / 2 + u * 3} ${minY + D * 0.72 - u * 4}Z`} /></g> : null}
    </svg>
  );
}
