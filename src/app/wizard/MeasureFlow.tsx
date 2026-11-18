/**
 * Aufmaß Schritt für Schritt – fürs Handy gebaut: eine Frage pro Bildschirm,
 * große Eingabefelder, Skizze mit der gerade gemeinten Wand. Am Ende entsteht
 * daraus der Raum mit richtig sitzenden Türen, Fenstern und Toren.
 */
import { useEffect, useRef, useState } from 'react';
import type { Project, Room } from '../../core/model/schema';
import { createRectRoom, newId } from '../../core/model/factory';
import {
  applyMeasure, checkOpening, defaultsFor, draftComplete, draftFromRoom, emptyDraft, openingKindLabel, openingS, WALL_HINT, wallLengthOf,
  type MeasureDraft, type MeasuredOpening, type OpeningKind,
} from '../../core/wizard/measure';
import { fmt } from '../../core/geometry/room';
import { store } from '../store';

type Step = 'start' | 'l1' | 'l2' | 'hoehe' | 'liste' | 'o-art' | 'o-wand' | 'o-abstand' | 'o-breite' | 'o-hoehe' | 'o-bruestung' | 'o-tuer' | 'name' | 'fertig';

const storageKey = (k: string) => `ep.aufmass.${k}`;
function loadSaved(k: string): MeasureDraft | null {
  try { const raw = localStorage.getItem(storageKey(k)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save(k: string, d: MeasureDraft | null) {
  try { if (d) localStorage.setItem(storageKey(k), JSON.stringify(d)); else localStorage.removeItem(storageKey(k)); } catch { /* egal */ }
}

export function MeasureFlow({ project, floorId, room, onClose, startAt }: { project: Project; floorId: string; room?: Room; onClose: (createdRoomId?: string) => void; startAt?: 'start' | 'liste' }) {
  const key = room ? `raum.${room.id}` : `neu.${floorId}`;
  const [draft, setDraft] = useState<MeasureDraft>(() => loadSaved(key) ?? (room ? draftFromRoom(room) : emptyDraft('')));
  const [step, setStep] = useState<Step>(startAt ?? 'start');
  const [cur, setCur] = useState<MeasuredOpening | null>(null);
  const resumed = useRef(!!loadSaved(key));
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);
  useEffect(() => { save(key, draft); }, [key, draft]);
  const hRef = project.settings.heightReference.label;

  const upd = (patch: Partial<MeasureDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const updCur = (patch: Partial<MeasuredOpening>) => setCur((c) => (c ? { ...c, ...patch } : c));

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
  const curIssues = cur ? checkOpening({ ...draft, openings: draft.openings.filter((o) => o.id !== cur.id) }, cur) : [];

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
  const order: Step[] = ['start', 'l1', 'l2', 'hoehe', 'liste', ...(room ? [] : ['name' as Step]), 'fertig'];
  const curOrder: Step[] = cur ? ['o-art', 'o-wand', 'o-abstand', 'o-breite', 'o-hoehe', ...(cur.kind === 'fenster' || cur.kind === 'sonstiges' ? ['o-bruestung' as Step] : []), ...(cur.kind === 'tuer' ? ['o-tuer' as Step] : [])] : [];
  const inOpening = step.startsWith('o-');
  const next = () => {
    if (inOpening) {
      const i = curOrder.indexOf(step);
      if (i === curOrder.length - 1) commitOpening(); else setStep(curOrder[i + 1]);
      return;
    }
    const i = order.indexOf(step);
    if (i < order.length - 1) setStep(order[i + 1]);
  };
  const back = () => {
    if (inOpening) {
      const i = curOrder.indexOf(step);
      if (i <= 1) { setCur(null); setStep('liste'); } else setStep(curOrder[i - 1]);
      return;
    }
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]); else onClose();
  };

  const valid: Record<Step, boolean> = {
    start: true,
    l1: !!draft.length1 && draft.length1 >= 30,
    l2: !!draft.length2 && draft.length2 >= 30,
    hoehe: !!draft.height && draft.height >= 100,
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
  const pos = inOpening ? order.indexOf('liste') : order.indexOf(step);
  const highlight = inOpening && cur ? cur.wall : step === 'l1' ? 0 : step === 'l2' ? 1 : undefined;

  return (
    <div className="measure" role="dialog" aria-modal="true" aria-label="Aufmaß Schritt für Schritt">
      <header className="measure-head">
        <button className="measure-x" onClick={() => onClose()} aria-label="Schließen">✕</button>
        <div className="measure-title">
          <b>{room ? `Aufmaß: ${room.name}` : 'Neuen Raum aufmessen'}</b>
          <span className="muted small">{inOpening && cur ? `${openingKindLabel[cur.kind]} · ` : ''}Schritt {Math.max(1, pos)} von {total}</span>
        </div>
      </header>
      <div className="measure-progress"><span style={{ transform: `scaleX(${Math.max(0, pos) / total})` }} /></div>

      <div className="measure-body" ref={bodyRef}>
        {step !== 'start' && step !== 'o-art' && <Sketch draft={draft} highlight={highlight} cur={inOpening ? cur : null} measuring={step === 'o-abstand'} />}

        {step === 'start' && (
          <div className="mq">
            <h2>So geht's</h2>
            <ol className="mq-list">
              <li>Stell dich in den Raum und such dir eine Wand als <b>Wand 1</b> aus – am besten die mit der Eingangstür. Schau auf diese Wand.</li>
              <li><b>Wand 2</b> ist dann rechts von dir, <b>Wand 3</b> hinter dir, <b>Wand 4</b> links.</li>
              <li>Miss immer innen im Rohbau, von Wand zu Wand (Putz/Fliesen, die noch kommen, nicht mitrechnen).</li>
              <li>Öffnungen misst du mit Blick auf ihre Wand von der <b>linken Ecke</b> aus – oder von rechts, wenn das einfacher ist.</li>
            </ol>
            {resumed.current && <p className="mq-note">Ein angefangenes Aufmaß wurde wiederhergestellt. <button className="linklike" onClick={() => { setDraft(room ? draftFromRoom(room) : emptyDraft('')); resumed.current = false; }}>Neu beginnen</button></p>}
            {room && room.outlets.length > 0 && <p className="mq-note">Dieser Raum hat schon {room.outlets.length} Auslässe. Sie behalten ihre Wand und ihren Abstand – nach dem Aufmaß bitte kurz prüfen.</p>}
          </div>
        )}

        {step === 'l1' && <Q title="Wie lang ist Wand 1?" hint="Die Wand, vor der du stehst – von Ecke zu Ecke.">
          <BigNumber key={step + (cur?.id ?? "")} value={draft.length1} onChange={(v) => upd({ length1: v })} onEnter={() => valid.l1 && next()} unit="cm" />
        </Q>}
        {step === 'l2' && <Q title="Wie lang ist Wand 2?" hint="Die Wand rechts von dir – von Ecke zu Ecke. Wand 3 und 4 sind gleich lang (Rechteckraum).">
          <BigNumber key={step + (cur?.id ?? "")} value={draft.length2} onChange={(v) => upd({ length2: v })} onEnter={() => valid.l2 && next()} unit="cm" />
        </Q>}
        {step === 'hoehe' && <Q title="Wie hoch ist der Raum?" hint={`Vom Fußboden (${hRef}) bis zur Decke.`}>
          <BigNumber key={step + (cur?.id ?? "")} value={draft.height} onChange={(v) => upd({ height: v })} onEnter={() => valid.hoehe && next()} unit="cm" />
        </Q>}

        {step === 'liste' && (
          <div className="mq">
            <h2>Türen, Fenster und andere Öffnungen</h2>
            <p className="muted">{draft.openings.length ? 'Gibt es noch weitere?' : 'Gibt es Türen, Fenster, ein Tor oder Durchgänge? Trag jede einzeln ein.'}</p>
            {draft.openings.length > 0 && <ul className="mq-openings">
              {draft.openings.map((o) => {
                const issues = checkOpening(draft, o);
                return (
                  <li key={o.id} className={issues.length ? 'bad' : ''}>
                    <div><b>{openingKindLabel[o.kind]}</b> · Wand {o.wall + 1}<div className="muted small">{fmt(openingS(draft, o))} cm ab linker Ecke · {fmt(o.width)} × {fmt(o.height)} cm{o.sill != null && (o.kind === 'fenster' || o.kind === 'sonstiges') ? ` · Brüstung ${fmt(o.sill)}` : ''}</div>{issues.map((m) => <div key={m} className="sev-fehler small">{m}</div>)}</div>
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
            {[0, 1, 2, 3].map((w) => <button key={w} className={`mq-choice ${cur.wall === w ? 'active' : ''}`} onClick={() => { updCur({ wall: w }); setStep('o-abstand'); }}>Wand {w + 1}<span>{WALL_HINT[w]} · {fmt(wallLengthOf(draft, w))} cm</span></button>)}
          </div>
        </Q>}
        {step === 'o-abstand' && cur && <Q title="Wie weit ist sie von der Ecke entfernt?" hint={`Schau auf Wand ${cur.wall + 1} und miss von der Ecke bis zur Kante der Öffnung (Rohbau, ohne Zarge/Rahmen).`}>
          <div className="mq-toggle" role="group" aria-label="Gemessen von">
            <button className={cur.from === 'links' ? 'active' : ''} onClick={() => updCur({ from: 'links' })}>von der linken Ecke</button>
            <button className={cur.from === 'rechts' ? 'active' : ''} onClick={() => updCur({ from: 'rechts' })}>von der rechten Ecke</button>
          </div>
          <BigNumber key={step + (cur?.id ?? "")} value={cur.distance} onChange={(v) => updCur({ distance: v ?? 0 })} onEnter={() => valid['o-abstand'] && next()} unit="cm" />
        </Q>}
        {step === 'o-breite' && cur && <Q title="Wie breit ist die Öffnung?" hint={cur.kind === 'tuer' ? 'Rohbauöffnung von Kante zu Kante (Normtür 88,5 cm, breite Tür 101 cm).' : 'Von Kante zu Kante im Rohbau.'}>
          <BigNumber key={step + (cur?.id ?? "")} value={cur.width} onChange={(v) => updCur({ width: v ?? 0 })} onEnter={() => valid['o-breite'] && next()} unit="cm" />
          <Issues list={curIssues.filter((m) => /Passt nicht|Überschneidet/.test(m))} />
        </Q>}
        {step === 'o-hoehe' && cur && <Q title="Wie hoch ist die Öffnung?" hint={cur.kind === 'tuer' ? 'Rohbauöffnung (Normtür 201 cm).' : undefined}>
          <BigNumber key={step + (cur?.id ?? "")} value={cur.height} onChange={(v) => updCur({ height: v ?? 0 })} onEnter={() => valid['o-hoehe'] && next()} unit="cm" />
          <Issues list={curIssues.filter((m) => /Höher/.test(m))} />
        </Q>}
        {step === 'o-bruestung' && cur && <Q title="Wie hoch ist die Brüstung?" hint="Vom Fußboden bis zur Unterkante der Öffnung.">
          <BigNumber key={step + (cur?.id ?? "")} value={cur.sill ?? null} onChange={(v) => updCur({ sill: v ?? 0 })} onEnter={() => valid['o-bruestung'] && next()} unit="cm" />
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
              <li>Wand 1 und 3: <b>{fmt(draft.length1)} cm</b>, Wand 2 und 4: <b>{fmt(draft.length2)} cm</b></li>
              <li>Höhe: <b>{fmt(draft.height)} cm</b> · Fläche {fmt(((draft.length1 ?? 0) * (draft.length2 ?? 0)) / 10000, 2)} m²</li>
              <li>{draft.openings.length ? `${draft.openings.length} Öffnung(en): ${draft.openings.map((o) => `${openingKindLabel[o.kind]} (W${o.wall + 1})`).join(', ')}` : 'keine Öffnungen'}</li>
            </ul>
            {!draftComplete(draft) && <p className="sev-fehler">Es fehlen noch Angaben oder eine Öffnung passt nicht – bitte zurückgehen.</p>}
            <p className="muted small">Wandmaterial, Boden, Decke und Nutzung fragt der Assistent als Nächstes ab. Alles lässt sich später noch ändern.</p>
          </div>
        )}
      </div>

      <footer className="measure-foot">
        <button className="mq-back" onClick={back}>{step === 'start' ? 'Abbrechen' : '← Zurück'}</button>
        {step === 'fertig'
          ? <button className="primary mq-next" disabled={!valid.fertig} onClick={finish}>{room ? 'Maße übernehmen' : 'Raum anlegen'}</button>
          : step === 'liste'
            ? <button className="primary mq-next" disabled={!valid.liste} onClick={next}>{draft.openings.length ? 'Fertig mit Öffnungen →' : 'Keine (weiter) →'}</button>
            : step === 'o-art' || step === 'o-wand' ? <span /> : <button className="primary mq-next" disabled={!valid[step]} onClick={next}>{inOpening && curOrder.indexOf(step) === curOrder.length - 1 ? 'Öffnung speichern ✓' : 'Weiter →'}</button>}
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
  return list.length ? <div className="mq-issues">{list.map((m) => <div key={m}>⚠ {m}</div>)}</div> : null;
}

/** Großes Zahlenfeld mit Ziffernblock auf dem Handy; Komma oder Punkt. */
function BigNumber({ value, onChange, onEnter, unit }: { value: number | null | undefined; onChange: (v: number | null) => void; onEnter?: () => void; unit: string }) {
  const [txt, setTxt] = useState(value == null || value === 0 ? (value === 0 ? '0' : '') : String(value).replace('.', ','));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
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

/** Draufsicht-Skizze: Wände nummeriert, aktuelle Wand hervorgehoben, Öffnungen eingezeichnet. */
function Sketch({ draft, highlight, cur, measuring }: { draft: MeasureDraft; highlight?: number; cur: MeasuredOpening | null; measuring: boolean }) {
  const W = draft.length1 || 400, D = draft.length2 || 300;
  const pad = Math.max(W, D) * 0.16;
  const side = Math.max(W, D) * 0.3; // Platz für „W2 · 600“ links/rechts
  const u = Math.max(W, D) / 100;
  const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }];
  const wall = (i: number) => ({ a: corners[i], b: corners[(i + 1) % 4] });
  const along = (i: number, s: number) => { const { a, b } = wall(i); const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L }; };
  const inward = (i: number) => [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }][i];
  const list = cur ? [...draft.openings.filter((o) => o.id !== cur.id), cur] : draft.openings;
  const color: Record<OpeningKind, string> = { tuer: 'var(--accent)', fenster: '#0891b2', tor: '#b45309', durchgang: '#7c3aed', sonstiges: '#64748b' };
  return (
    <svg className="mq-sketch" viewBox={`${-side} ${-pad} ${W + 2 * side} ${D + 2 * pad}`} role="img" aria-label="Skizze des Raums">
      <rect x={0} y={0} width={W} height={D} fill="var(--panel)" stroke="var(--ink)" strokeWidth={u * 1.2} />
      {[0, 1, 2, 3].map((i) => {
        const { a, b } = wall(i);
        const m = along(i, (i % 2 === 0 ? W : D) / 2);
        const n = inward(i);
        // Seitenwände: Beschriftung neben die Linie (links-/rechtsbündig), oben/unten mittig
        const lab = i % 2 === 0 ? { x: m.x, y: m.y - n.y * pad * 0.5 } : { x: m.x - n.x * u * 3, y: m.y };
        const anchor = i === 1 ? 'start' : i === 3 ? 'end' : 'middle';
        const hl = highlight === i;
        return (
          <g key={i}>
            {hl && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={u * 3} strokeLinecap="round" />}
            <text x={lab.x} y={lab.y} fontSize={u * 6} textAnchor={anchor} dominantBaseline="central" fill={hl ? '#dc2626' : 'var(--muted)'} fontWeight={hl ? 700 : 400}>W{i + 1}{(i % 2 === 0 ? draft.length1 : draft.length2) ? ` · ${fmt(i % 2 === 0 ? draft.length1 : draft.length2)}` : ''}</text>
          </g>
        );
      })}
      {list.map((o) => {
        const s = openingS(draft, o);
        const p1 = along(o.wall, s), p2 = along(o.wall, s + o.width);
        const isCur = cur?.id === o.id;
        return <line key={o.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color[o.kind]} strokeWidth={u * (isCur ? 4 : 3)} opacity={isCur ? 1 : 0.8} />;
      })}
      {cur && measuring && (() => {
        const len = wallLengthOf(draft, cur.wall);
        const s0 = cur.from === 'links' ? 0 : len;
        const s1 = cur.from === 'links' ? cur.distance : len - cur.distance;
        const n = inward(cur.wall);
        const off = u * 6;
        const p0 = along(cur.wall, s0), p1 = along(cur.wall, s1);
        const q0 = { x: p0.x + n.x * off, y: p0.y + n.y * off }, q1 = { x: p1.x + n.x * off, y: p1.y + n.y * off };
        return <g stroke="#dc2626" strokeWidth={u * 0.8} fill="#dc2626">
          <line x1={q0.x} y1={q0.y} x2={q1.x} y2={q1.y} />
          <circle cx={q0.x} cy={q0.y} r={u * 1.4} />
          <circle cx={q1.x} cy={q1.y} r={u * 1.4} />
          <text x={(q0.x + q1.x) / 2 + n.x * u * 5} y={(q0.y + q1.y) / 2 + n.y * u * 5} fontSize={u * 5} textAnchor="middle" dominantBaseline="central" stroke="none">{fmt(cur.distance)}</text>
        </g>;
      })()}
      {/* Standpunkt: Blick auf Wand 1 */}
      {highlight === undefined || highlight === 0 ? <g fill="var(--muted)"><circle cx={W / 2} cy={D * 0.72} r={u * 3} /><path d={`M${W / 2 - u * 3} ${D * 0.72 - u * 4}L${W / 2} ${D * 0.72 - u * 9}L${W / 2 + u * 3} ${D * 0.72 - u * 4}Z`} /></g> : null}
    </svg>
  );
}
