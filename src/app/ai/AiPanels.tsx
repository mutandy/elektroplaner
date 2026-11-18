/** KI-Bausteine der Oberfläche: alle Ergebnisse werden vor der Übernahme angezeigt. */
import { useState } from 'react';
import type { Photo, Project, Room } from '../../core/model/schema';
import { DistributionPhotoResult, DISTRIBUTION_PROMPT, FLOOR_PLAN_PROMPT, FloorPlanResult, RoomTextResult, applyDistributionPhoto, applyFloorPlan, applyRoomText, roomTextPrompt } from '../../core/ai/tasks';
import { ROOM_TYPE_INFO } from '../../core/model/roomTypes';
import { newId } from '../../core/model/factory';
import { fmt } from '../../core/geometry/room';
import { kw } from '../../core/planning/loads';
import { wallSideLabel } from '../../core/wizard/steps';
import { store } from '../store';
import { AI_MODEL, aiAvailable, aiViaServer, askStructured, getApiKey, setApiKey } from './claude';
import { loadImage } from '../components/PlanTracer';
import { Select, TextInput } from '../components/ui';

function useAi<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<T | null>(null);
  const run = async (fn: () => Promise<T>) => {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, result, setResult, run };
}

export function AiKeySettings() {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(!!getApiKey());
  if (aiViaServer() && !key) return <p className="small ok">✔ KI-Unterstützung ist über deinen Server eingeschaltet ({AI_MODEL}). Der API-Schlüssel liegt auf dem Server, nicht im Browser. Bilder und Texte, die du auswerten lässt, gehen über den Server an die Claude-API.</p>;
  return (
    <div>
      <p className="small">Optional: Mit einem eigenen Claude-API-Schlüssel kann das Programm Grundrisse, Fotos der Verteilung und Raumbeschreibungen auswerten ({AI_MODEL}). Alles kommt als Vorschlag, den du prüfst. Der Schlüssel wird <b>nur in diesem Browser</b> gespeichert, nie in der Projektdatei; Bilder und Texte gehen dabei an die Claude-API.</p>
      <div className="inline">
        <input type="password" value={key} placeholder="sk-ant-…" onChange={(e) => { setKey(e.target.value); setSaved(false); }} style={{ minWidth: '24em' }} autoComplete="off" />
        <button onClick={() => { setApiKey(key.trim()); setSaved(!!key.trim()); }}>Speichern</button>
        {saved && <button className="danger" onClick={() => { setApiKey(''); setKey(''); setSaved(false); }}>Entfernen</button>}
        <span className={saved ? 'ok small' : 'muted small'}>{saved ? '✔ Schlüssel hinterlegt' : 'kein Schlüssel'}</span>
      </div>
    </div>
  );
}

const NoKey = () => <p className="muted small">KI-Auswertung möglich, wenn unter Projekt → „KI-Unterstützung“ ein Claude-API-Schlüssel hinterlegt ist.</p>;
const Err = ({ msg }: { msg: string }) => (msg ? <p className="sev-fehler small">{msg}</p> : null);

// ---------------------------------------------------------------------------

export function FloorPlanAi({ project, floorId }: { project: Project; floorId: string }) {
  const floor = project.floors.find((f) => f.id === floorId)!;
  const ai = useAi<FloorPlanResult>();
  const [names, setNames] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  if (!floor.backgroundPlan) return null;
  if (!aiAvailable()) return <NoKey />;
  return (
    <div className="aibox">
      <div className="inline">
        <button disabled={ai.busy} onClick={() => ai.run(() => askStructured({ schema: FloorPlanResult, system: FLOOR_PLAN_PROMPT, text: `Geschoss: ${floor.name}. Lies alle Räume aus diesem Plan.`, images: [{ dataUrl: floor.backgroundPlan! }] }))}>{ai.busy ? 'Claude liest den Plan …' : '✨ Räume aus dem Grundriss lesen (KI)'}</button>
        {!floor.backgroundScale && <span className="muted small">Tipp: erst Maßstab festlegen, dann werden auch Lage und Größe übernommen.</span>}
      </div>
      <Err msg={ai.error} />
      {ai.result && (
        <>
          <p className="small">{ai.result.rooms.length} Räume erkannt{ai.result.overallDimension.lengthM ? ` · Gesamtmaß ${fmt(ai.result.overallDimension.lengthM, 2)} m (${ai.result.overallDimension.description})` : ''}. Haken entfernen, was nicht übernommen werden soll; künftigen Namen eintragen.</p>
          <table className="findings">
            <thead><tr><th /><th>Im Plan</th><th>Art</th><th>Maße laut Plan</th><th>Künftiger Name</th><th>Hinweise</th></tr></thead>
            <tbody>{ai.result.rooms.map((r, i) => (
              <tr key={i}>
                <td><input type="checkbox" checked={!skip[i]} onChange={(e) => setSkip({ ...skip, [i]: !e.target.checked })} /></td>
                <td><b>{r.label}</b></td><td>{r.kind}</td>
                <td>{r.widthM && r.depthM ? `${fmt(r.widthM, 2)} × ${fmt(r.depthM, 2)} m` : '–'}</td>
                <td><TextInput value={names[i] ?? ''} placeholder={r.label} onChange={(v) => setNames({ ...names, [i]: v })} /></td>
                <td className="small">{r.notes}</td>
              </tr>
            ))}</tbody>
          </table>
          {ai.result.notes && <p className="small muted">{ai.result.notes}</p>}
          <div className="inline">
            <button className="primary" onClick={() => {
              const picks = ai.result!.rooms.map((_, i) => ({ index: i, name: names[i] ?? '' })).filter((x) => !skip[x.index]);
              store.update(`${picks.length} Räume aus Grundriss (KI) übernommen`, (p) => { applyFloorPlan(p, floorId, ai.result!, picks); });
              ai.setResult(null);
            }}>Ausgewählte Räume anlegen</button>
            <span className="muted small">Maße und Lage sind Vorschläge („aus Plan“) – im Raumschritt „Maße“ mit dem Aufmaß überschreiben.</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DistributionPhotoAi({ project, distributionId }: { project: Project; distributionId: string }) {
  const dist = project.distributions.find((d) => d.id === distributionId);
  const ai = useAi<DistributionPhotoResult>();
  if (!dist) return null;
  const photo = dist.photos[dist.photos.length - 1];
  return (
    <div className="aibox">
      <div className="inline">
        <label className="filebtn small">📷 Foto der Verteilung hinzufügen
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            const img = await loadImage(f, 1600);
            store.update(`${dist.name}: Foto ergänzt`, (p) => { p.distributions.find((d) => d.id === distributionId)!.photos.push({ id: newId('foto'), dataUrl: img.dataUrl, caption: f.name, at: new Date().toISOString() }); });
          }} />
        </label>
        {photo && aiAvailable() && <button disabled={ai.busy} onClick={() => ai.run(() => askStructured({ schema: DistributionPhotoResult, system: DISTRIBUTION_PROMPT, text: `Verteilung „${dist.name}“. Lies alle Geräte aus.`, images: [{ dataUrl: photo.dataUrl }] }))}>{ai.busy ? 'Claude liest das Foto …' : '✨ Geräte aus dem Foto lesen (KI)'}</button>}
        {photo && !aiAvailable() && <span className="muted small">Mit API-Schlüssel kann das Foto ausgewertet werden.</span>}
      </div>
      {dist.photos.length > 0 && <div className="thumbs">{dist.photos.map((ph) => <img key={ph.id} src={ph.dataUrl} alt={ph.caption} title={ph.caption} />)}</div>}
      <Err msg={ai.error} />
      {ai.result && (
        <>
          <table className="findings">
            <thead><tr><th>Gerät</th><th>Daten</th><th>Anzahl</th><th>Beschriftung</th></tr></thead>
            <tbody>{ai.result.devices.map((d, i) => <tr key={i}><td>{d.kind}</td><td>{[d.characteristic && d.ratedCurrent ? `${d.characteristic}${d.ratedCurrent}` : d.ratedCurrent ? `${d.ratedCurrent} A` : '', d.poles ? `${d.poles}-polig` : '', d.residualCurrent ? `${d.residualCurrent} mA` : '', d.rcdType ? `Typ ${d.rcdType}` : ''].filter(Boolean).join(', ')}</td><td>{d.count}</td><td className="small">{d.label ?? ''}</td></tr>)}</tbody>
          </table>
          <p className="small">Freie Plätze: {ai.result.freeModules ?? 'unbekannt'} TE{ai.result.mainFuse ? ` · Hauptsicherung: ${ai.result.mainFuse}` : ''}{ai.result.uncertain.length ? ` · unsicher: ${ai.result.uncertain.join('; ')}` : ''}</p>
          <div className="inline">
            <button className="primary" onClick={() => { store.update(`${dist.name}: Geräte aus Foto (KI) übernommen`, (p) => applyDistributionPhoto(p, distributionId, ai.result!)); ai.setResult(null); }}>In die Verteilung übernehmen</button>
            <span className="muted small">Wie viele LS davon frei sind, trägst du danach je Gruppe ein. Die Elektrofachkraft bestätigt den Bestand.</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function RoomTextAi({ room }: { room: Room }) {
  const [text, setText] = useState('');
  const ai = useAi<RoomTextResult>();
  const [opt, setOpt] = useState({ type: true, loads: true, furniture: true });
  if (!aiAvailable()) return null;
  return (
    <div className="aibox">
      <p className="small"><b>✨ In eigenen Worten beschreiben (KI):</b> z. B. „Schlafzimmer mit Doppelbett an der Fensterwand, links und rechts Nachttische, gegenüber Schrank, in der Ecke ein Schreibtisch mit zwei Monitoren, später vielleicht Kinderzimmer.“</p>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="inline"><button disabled={ai.busy || text.trim().length < 10} onClick={() => ai.run(() => askStructured({ schema: RoomTextResult, system: roomTextPrompt(room), text, effort: 'medium' }))}>{ai.busy ? 'Claude denkt …' : 'Auswerten'}</button></div>
      <Err msg={ai.error} />
      {ai.result && (
        <div className="small">
          <label className="check"><input type="checkbox" checked={opt.type} onChange={(e) => setOpt({ ...opt, type: e.target.checked })} />Raumtyp: <b>{ai.result.roomType ? ROOM_TYPE_INFO[ai.result.roomType].label : '–'}</b> {ai.result.usage && `(${ai.result.usage})`}</label><br />
          <label className="check"><input type="checkbox" checked={opt.loads} onChange={(e) => setOpt({ ...opt, loads: e.target.checked })} />Geräte: {ai.result.loads.map((l) => `${l.label} ${kw(l.power)}${l.dedicated ? ' (eigener Kreis)' : ''}`).join(', ') || '–'}</label><br />
          <label className="check"><input type="checkbox" checked={opt.furniture} onChange={(e) => setOpt({ ...opt, furniture: e.target.checked })} />Möbel: {ai.result.furniture.map((f) => `${f.label} (${f.wallSide})`).join(', ') || '–'}</label>
          {ai.result.wishes.length > 0 && <p>Wünsche: {ai.result.wishes.join(' · ')}</p>}
          {ai.result.questions.length > 0 && <p className="sev-warnung">Offen: {ai.result.questions.join(' · ')}</p>}
          <button className="primary" onClick={() => { store.update(`${room.name}: Beschreibung (KI) übernommen`, (p) => applyRoomText(p, room.id, ai.result!, opt)); ai.setResult(null); setText(''); }}>Übernehmen</button>
          <span className="muted"> Möbel landen grob an der genannten Wand – Lage danach im Plan anpassen.</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PhotoList({ photos, wallOptions, onAdd, onChange, onRemove }: {
  photos: Photo[];
  wallOptions?: { value: string; label: string }[];
  onAdd: (p: Photo[]) => void;
  onChange: (id: string, patch: Partial<Photo>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <label className="filebtn small">📷 Fotos hinzufügen
        <input type="file" accept="image/*" multiple hidden onChange={async (e) => {
          const files = [...(e.target.files ?? [])]; e.target.value = '';
          const out: Photo[] = [];
          for (const f of files) { const img = await loadImage(f, 1600); out.push({ id: newId('foto'), dataUrl: img.dataUrl, caption: f.name.replace(/\.[^.]+$/, ''), at: new Date().toISOString() }); }
          if (out.length) onAdd(out);
        }} />
      </label>
      <div className="photogrid">
        {photos.map((ph) => (
          <figure key={ph.id}>
            <img src={ph.dataUrl} alt={ph.caption} />
            <figcaption>
              <TextInput value={ph.caption} placeholder="Beschriftung" onChange={(v) => onChange(ph.id, { caption: v })} />
              {wallOptions && <Select value={ph.wallIndex == null ? undefined : String(ph.wallIndex)} allowEmpty="ganzer Raum" options={wallOptions} onChange={(v) => onChange(ph.id, { wallIndex: v == null ? undefined : Number(v) })} />}
              <button className="icon danger" onClick={() => confirm('Foto entfernen?') && onRemove(ph.id)}>✕</button>
            </figcaption>
          </figure>
        ))}
      </div>
      {photos.length === 0 && <p className="muted small">Noch keine Fotos. Tipp: jede Wand einmal fotografieren (Zollstock ins Bild), vor dem Verschließen jede Trasse.</p>}
    </div>
  );
}

export function RoomPhotos({ room }: { room: Room }) {
  const set = (text: string, fn: (r: Room) => void) => store.update(`${room.name}: ${text}`, (p) => fn(p.rooms.find((x) => x.id === room.id) as Room));
  return <PhotoList photos={room.photos} wallOptions={room.walls.map((w) => ({ value: String(w.index), label: `W${w.index + 1} – ${wallSideLabel(room, w.index)}` }))}
    onAdd={(ps) => set(`${ps.length} Foto(s) ergänzt`, (r) => { r.photos.push(...ps); })}
    onChange={(id, patch) => set('Foto geändert', (r) => { Object.assign(r.photos.find((x) => x.id === id)!, patch); })}
    onRemove={(id) => set('Foto entfernt', (r) => { r.photos = r.photos.filter((x) => x.id !== id); })} />;
}
