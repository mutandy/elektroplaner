import { useState } from 'react';
import type { Draft } from 'immer';
import type { Outlet, Project, Room } from '../../core/model/schema';
import { newId } from '../../core/model/factory';
import { bbox, ffbToZ, fmt, futureBuildup, roomArea, suggestedSwitchS, wallGeoms, wallName, zToFfb } from '../../core/geometry/room';
import { boxTypeLabel, ceilingLabel, insertLabel, installationTypeLabel, outletKindLabel, smartHomeLabel, wallMaterialLabel } from '../../core/model/labels';
import { FURNITURE_TYPES } from '../../core/model/catalog';
import { ALL_LAYERS, layerLabel, type Layer } from '../../core/render/plan';
import { runRules, severityLabel, effectiveSmart } from '../../core/rules/rules';
import { normValue } from '../../core/rules/normValues';
import { store } from '../store';
import { Check, EditTable, Field, NumberInput, Section, Select, TextInput, opts, type Col } from '../components/ui';
import { RoomPlan, WallElevation } from '../components/PlanCanvas';

type Tab = 'bau' | 'einrichtung' | 'auslaesse' | 'zusammenfassung';

const upRoom = (roomId: string, text: string, fn: (r: Draft<Room>, p: Draft<Project>) => void) =>
  store.update(text, (p) => {
    const r = p.rooms.find((x) => x.id === roomId);
    if (r) fn(r, p);
  });

const isRect = (r: Room) =>
  r.polygon.length === 4 && r.polygon[0].x === 0 && r.polygon[0].y === 0 && r.polygon[1].y === 0 && r.polygon[3].x === 0 && r.polygon[2].x === r.polygon[1].x && r.polygon[2].y === r.polygon[3].y;

/** Wand-Referenzen nach Einfügen/Entfernen einer Ecke anpassen. */
function shiftWallRefs(r: Draft<Room>, map: (wi: number, s: number) => { wi: number; s: number }) {
  for (const d of r.doors) { const m = map(d.wallIndex, d.s); d.wallIndex = m.wi; d.s = m.s; }
  for (const w of r.windows) { const m = map(w.wallIndex, w.s); w.wallIndex = m.wi; w.s = m.s; }
  for (const o of r.outlets) if (o.wallIndex != null) { const m = map(o.wallIndex, o.s ?? 0); o.wallIndex = m.wi; if (o.s != null) o.s = m.s; }
  for (const f of r.furniture) if (f.wallIndex != null) f.wallIndex = map(f.wallIndex, 0).wi;
  for (const o of r.obstacles) if (o.wallIndex != null) o.wallIndex = map(o.wallIndex, 0).wi;
}

function insertCorner(roomId: string, i: number) {
  upRoom(roomId, 'Ecke eingefügt', (r) => {
    const a = r.polygon[i];
    const b = r.polygon[(i + 1) % r.polygon.length];
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    r.polygon.splice(i + 1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    shiftWallRefs(r, (wi, s) => (wi > i ? { wi: wi + 1, s } : wi === i && s > half ? { wi: i + 1, s: s - half } : { wi, s }));
    r.walls.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(r.walls[i])), preWall: [], zones: [] });
    r.walls.forEach((w, k) => (w.index = k));
  });
}

function removeCorner(roomId: string, i: number) {
  upRoom(roomId, 'Ecke entfernt', (r) => {
    if (r.polygon.length <= 3) return;
    r.polygon.splice(i, 1);
    const prev = (i - 1 + r.walls.length) % r.walls.length;
    shiftWallRefs(r, (wi, s) => (wi === i ? { wi: prev > i ? prev - 1 : prev, s } : wi > i ? { wi: wi - 1, s } : { wi, s }));
    r.walls.splice(i, 1);
    r.walls.forEach((w, k) => (w.index = k));
  });
}

function nextLabel(room: Room) {
  const prefix = (room.outlets[0]?.label.match(/^[A-Za-zÄÖÜäöü]+/)?.[0]) ?? room.name.replace(/[^A-Za-zÄÖÜ]/g, '').slice(0, 1).toUpperCase() ?? 'D';
  let n = 1;
  const used = new Set(room.outlets.map((o) => o.label));
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function defaultZ(project: Project, room: Room, kind: Outlet['kind']): number {
  const h = { ...project.settings.defaultHeights, ...room.heightOverrides };
  const ap = room.installationType !== 'unterputz' && room.installationType !== 'hohlwand';
  const ffb = kind === 'schalter' || kind === 'taster' || kind === 'bewegungsmelder' ? h.schalter : kind === 'lan' ? h.lan : ap ? h.aufputzKeller : h.steckdose;
  return Math.round(ffbToZ(room, ffb) * 10) / 10;
}

function newOutlet(project: Project, room: Room, kind: Outlet['kind'], wallIndex: number): Outlet {
  const ap = room.installationType !== 'unterputz' && room.installationType !== 'hohlwand';
  const base = { id: newId('a'), label: nextLabel(room), kind, gangs: 1, orientation: 'waagerecht' as const, growth: 'rechts' as const, boxType: (ap ? 'aufputz' : 'up_tief') as Outlet['boxType'], inserts: [] as Outlet['inserts'], controls: [], smart: false, status: 'neu' as const, note: '' };
  if (kind === 'licht_decke' || kind === 'rauchwarnmelder') {
    const bb = bbox(room.polygon);
    return { ...base, mount: 'decke', x: Math.round((bb.minX + bb.maxX) / 2), y: Math.round((bb.minY + bb.maxY) / 2), boxType: kind === 'rauchwarnmelder' ? 'aufputz' : room.ceiling.construction === 'hourdis' ? 'bestand' : 'decke_beton' };
  }
  let wi = wallIndex;
  let s = wallGeoms(room)[wi]?.length / 2 || 50;
  if (kind === 'schalter' || kind === 'taster') {
    const door = room.doors.find((d) => d.wallIndex === wallIndex) ?? room.doors.find((d) => d.isMainEntrance) ?? room.doors[0];
    if (door) {
      wi = door.wallIndex;
      s = suggestedSwitchS(door, normValue(project, 'schalter.abstandZarge'), normValue(project, 'schalter.abstandOhneZarge'));
    }
  }
  const inserts: Record<string, Outlet['inserts']> = {
    steckdose: ['steckdose'], schalter: ['ausschalter'], taster: ['taster'], lan: ['lan_2fach'], lautsprecher: ['lautsprecher_klemme'], anschlussdose: ['geraeteanschluss'], licht_wand: ['geraeteanschluss'], herd: ['geraeteanschluss'], tv_sat: ['tv_sat'],
  };
  return { ...base, mount: 'wand', wallIndex: wi, s: Math.round(s * 10) / 10, z: defaultZ(project, room, kind), inserts: inserts[kind] ?? [] };
}

export function RoomView({ project, room, outletId, wallIndex }: { project: Project; room: Room; outletId?: string; wallIndex: number }) {
  const [tab, setTab] = useState<Tab>('bau');
  const [layers, setLayers] = useState<Layer[]>(ALL_LAYERS.filter((l) => l !== 'zonen'));
  const walls = wallGeoms(room);
  const wi = Math.min(wallIndex, walls.length - 1);
  const wallOpts = walls.map((w) => ({ value: String(w.index), label: wallName(room, w.index) }));
  const findings = runRules(project, { roomId: room.id }).findings;
  const sel = room.outlets.find((o) => o.id === outletId);

  return (
    <div className="roomview">
      <div className="roomhead">
        <div>
          <h2>{room.name} {room.formerName && room.formerName !== room.name && <span className="muted small">Bestandsplan: {room.formerName}</span>}</h2>
          <div className="muted small">{fmt(roomArea(room), 2)} m² · Höhe {fmt(room.height)} cm · {installationTypeLabel[room.installationType]} · {room.outlets.length} Auslässe {room.confirmed ? '· ✔ bestätigt' : ''}</div>
        </div>
        <div className="tabs">
          {([['bau', '1 Bauliches'], ['einrichtung', '2 Einrichtung'], ['auslaesse', '3 Auslässe'], ['zusammenfassung', '4 Zusammenfassung']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}{k === 'zusammenfassung' && findings.some((f) => f.severity === 'fehler') ? ' ⛔' : ''}</button>
          ))}
        </div>
      </div>
      <div className="split">
        <div className="editor">
          {tab === 'bau' && <BauTab project={project} room={room} wallOpts={wallOpts} />}
          {tab === 'einrichtung' && <EinrichtungTab room={room} wallOpts={wallOpts} />}
          {tab === 'auslaesse' && <AuslassTab project={project} room={room} wallOpts={wallOpts} wallIndex={wi} selected={sel} />}
          {tab === 'zusammenfassung' && <SummaryTab project={project} room={room} findings={findings} />}
        </div>
        <div className="viewer">
          <div className="layerbar">
            {ALL_LAYERS.map((l) => (
              <label key={l} className="check small"><input type="checkbox" checked={layers.includes(l)} onChange={(e) => setLayers(e.target.checked ? [...layers, l] : layers.filter((x) => x !== l))} />{layerLabel[l]}</label>
            ))}
          </div>
          <RoomPlan project={project} room={room} layers={layers} selectedOutletId={outletId} />
          <div className="wallpick">
            <span className="muted small">Wandabwicklung:</span>
            {walls.map((w) => <button key={w.index} className={w.index === wi ? 'active' : ''} onClick={() => store.setUi({ wallIndex: w.index })} title={wallName(room, w.index)}>W{w.index + 1}</button>)}
          </div>
          <WallElevation project={project} room={room} wallIndex={wi} layers={layers} selectedOutletId={outletId} />
          <p className="muted small">Auslässe lassen sich in Draufsicht (entlang der Wand) und Abwicklung (Position + Höhe) mit der Maus verschieben. Raster 0,5 cm. Strg+Z macht rückgängig.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BauTab({ project, room, wallOpts }: { project: Project; room: Room; wallOpts: { value: string; label: string }[] }) {
  const id = room.id;
  const set = <K extends keyof Room>(k: K, v: Room[K], label: string) => upRoom(id, `${room.name}: ${label} geändert`, (r) => { (r as any)[k] = v; });
  const rect = isRect(room);
  const fb = futureBuildup(room);
  return (
    <>
      <Section title="Raum">
        <div className="grid2">
          <Field label="Neue Bezeichnung"><TextInput value={room.name} onChange={(v) => set('name', v, 'Name')} /></Field>
          <Field label="Bezeichnung im Bestandsplan" hint="bleibt erhalten, auch wenn der Raum umgenutzt wird"><TextInput value={room.formerName} onChange={(v) => set('formerName', v, 'Bestandsbezeichnung')} /></Field>
          <Field label="Nutzung"><TextInput value={room.usage} onChange={(v) => set('usage', v, 'Nutzung')} placeholder="z. B. Schlafen, Küche, Büro" /></Field>
          <Field label="Mögliche künftige Nutzung"><TextInput value={room.futureUsage} onChange={(v) => set('futureUsage', v, 'künftige Nutzung')} placeholder="vielleicht mal Fitnessraum" /></Field>
          <Field label="Geschoss"><Select value={room.floorId} options={project.floors.map((f) => ({ value: f.id, label: f.name }))} onChange={(v) => v && set('floorId', v, 'Geschoss')} /></Field>
          <Field label="Lichte Raumhöhe (cm über Bezug)"><NumberInput value={room.height} onChange={(v) => v && set('height', v, 'Raumhöhe')} /></Field>
          <Field label="Installationsart"><Select value={room.installationType} options={opts(installationTypeLabel)} onChange={(v) => v && set('installationType', v as Room['installationType'], 'Installationsart')} /></Field>
          <Field label="Smart Home (Raum)"><Select value={room.smartHome} allowEmpty={`wie Projekt (${smartHomeLabel[project.smartHome.enabled ? project.smartHome.system : 'keines']})`} options={opts(smartHomeLabel)} onChange={(v) => set('smartHome', v as Room['smartHome'], 'Smart Home')} /></Field>
          <Field label="Versorgt aus"><Select value={room.distributionId} allowEmpty="–" options={project.distributions.map((d) => ({ value: d.id, label: d.name }))} onChange={(v) => set('distributionId', v, 'Verteilung')} /></Field>
          <div className="checks">
            <Check checked={room.inScope} onChange={(v) => set('inScope', v, 'Planungsumfang')} label="wird in diesem Projekt geplant" />
            <Check checked={room.wetRoom} onChange={(v) => set('wetRoom', v, 'Feuchtraum')} label="Feuchtraum / Bad" />
            <Check checked={room.provenance === 'annahme'} onChange={(v) => set('provenance', v ? 'annahme' : 'gemessen', 'Herkunft')} label="Maße sind Annahmen" />
          </div>
        </div>
      </Section>

      <Section title="Grundriss und Bezugssystem">
        <p className="muted small">Nullpunkt = Ecke 1 (rot). Ecken im Uhrzeigersinn. Wand n läuft von Ecke n nach Ecke n+1; Maße auf der Wand gelten ab ihrer linken Ecke beim Blick von innen.</p>
        {rect ? (
          <div className="grid3">
            <Field label="Breite (Wand 1, cm)"><NumberInput value={room.polygon[1].x} onChange={(v) => v && upRoom(id, `${room.name}: Breite`, (r) => { r.polygon[1].x = v; r.polygon[2].x = v; })} /></Field>
            <Field label="Tiefe (Wand 2, cm)"><NumberInput value={room.polygon[2].y} onChange={(v) => v && upRoom(id, `${room.name}: Tiefe`, (r) => { r.polygon[2].y = v; r.polygon[3].y = v; })} /></Field>
            <Field label=" "><button onClick={() => insertCorner(id, 1)}>Zu Polygon erweitern</button></Field>
          </div>
        ) : (
          <EditTable rows={room.polygon.map((p, i) => ({ ...p, i: `Ecke ${i + 1}` }))} rowKey={(_r, i) => String(i)}
            cols={[{ key: 'i', label: 'Ecke', type: 'readonly' }, { key: 'x', label: 'x (cm)', type: 'number' }, { key: 'y', label: 'y (cm)', type: 'number' },
              { key: 'i', label: '', type: 'readonly', render: (r) => <button className="small" onClick={() => insertCorner(id, Number(String(r.i).replace('Ecke ', '')) - 1)}>＋ Ecke danach</button> }] as Col<any>[]}
            onChange={(i, k, v) => upRoom(id, `${room.name}: Ecke ${i + 1}`, (r) => { (r.polygon[i] as any)[k] = v; })}
            onRemove={(i) => removeCorner(id, i)} />
        )}
        <div className="grid3">
          <Field label="Lage im Geschoss x"><NumberInput value={room.originOnFloor.x} onChange={(v) => v != null && upRoom(id, `${room.name}: Lage`, (r) => { r.originOnFloor.x = v; })} /></Field>
          <Field label="Lage im Geschoss y"><NumberInput value={room.originOnFloor.y} onChange={(v) => v != null && upRoom(id, `${room.name}: Lage`, (r) => { r.originOnFloor.y = v; })} /></Field>
        </div>
      </Section>

      <Section title={`Wände (${room.walls.length})`}>
        <EditTable rows={room.walls.map((w) => ({ ...w, len: fmt(wallGeoms(room)[w.index]?.length) }))} rowKey={(r) => String(r.index)}
          cols={[
            { key: 'index', label: 'Wand', type: 'readonly', render: (r: any) => <b>W{r.index + 1}</b> },
            { key: 'len', label: 'Länge', type: 'readonly' },
            { key: 'label', label: 'Bezeichnung', type: 'text' },
            { key: 'material', label: 'Material', type: 'select', options: opts(wallMaterialLabel) },
            { key: 'exterior', label: 'Außen', type: 'check' },
            { key: 'loadBearing', label: 'tragend', type: 'check' },
            { key: 'horizontalSlotsAllowed', label: 'waagr. Schlitze', type: 'check', title: 'Waagerechte Schlitze erlaubt und gewollt' },
          ] as Col<any>[]}
          onChange={(i, k, v) => upRoom(id, `${room.name}: Wand ${i + 1} ${k}`, (r) => { (r.walls[i] as any)[k] = v; })} />
        <h4>Vorwände (abschnittsweise Höhe)</h4>
        <EditTable rows={room.walls.flatMap((w) => w.preWall.map((p) => ({ ...p, wall: String(w.index) })))} rowKey={(r) => r.id} empty="Keine Vorwand."
          cols={[
            { key: 'wall', label: 'Wand', type: 'select', options: wallOpts },
            { key: 'label', label: 'Abschnitt', type: 'text' },
            { key: 'from', label: 'von', type: 'number' }, { key: 'to', label: 'bis', type: 'number' },
            { key: 'height', label: 'Höhe (leer = raumhoch)', type: 'nullnumber' }, { key: 'depth', label: 'Tiefe', type: 'number' },
          ] as Col<any>[]}
          onChange={(i, k, v) => { const rows = room.walls.flatMap((w) => w.preWall.map((p) => ({ id: p.id, wall: String(w.index) }))); editWallItem(room, 'preWall', rows[i], k, v); }}
          onRemove={(i) => { const rows = room.walls.flatMap((w) => w.preWall.map((p) => ({ id: p.id, wall: String(w.index) }))); removeWallItem(room, 'preWall', rows[i]); }}
          onAdd={() => upRoom(id, `${room.name}: Vorwand ergänzt`, (r) => { r.walls[0].preWall.push({ id: newId('vw'), from: 0, to: 100, height: 120, depth: 20, construction: 'trockenbau', label: '' }); })}
          addLabel="Vorwand-Abschnitt" />
        <h4>Tabuzonen (Kaminwange, Sturz, Brandwand)</h4>
        <EditTable rows={room.walls.flatMap((w) => w.zones.map((z) => ({ ...z, wall: String(w.index) })))} rowKey={(r) => r.id} empty="Keine."
          cols={[
            { key: 'wall', label: 'Wand', type: 'select', options: wallOpts },
            { key: 'kind', label: 'Art', type: 'select', options: opts({ kaminwange: 'Kaminwange', sturz: 'Sturz', brandwand: 'Brandwand', tabu: 'Tabuzone' }) },
            { key: 'from', label: 'von', type: 'number' }, { key: 'to', label: 'bis', type: 'number' },
            { key: 'zFrom', label: 'Höhe von', type: 'number' }, { key: 'zTo', label: 'bis (leer = Decke)', type: 'nullnumber' },
          ] as Col<any>[]}
          onChange={(i, k, v) => { const rows = room.walls.flatMap((w) => w.zones.map((z) => ({ id: z.id, wall: String(w.index) }))); editWallItem(room, 'zones', rows[i], k, v); }}
          onRemove={(i) => { const rows = room.walls.flatMap((w) => w.zones.map((z) => ({ id: z.id, wall: String(w.index) }))); removeWallItem(room, 'zones', rows[i]); }}
          onAdd={() => upRoom(id, `${room.name}: Tabuzone ergänzt`, (r) => { r.walls[0].zones.push({ id: newId('z'), kind: 'kaminwange', from: 0, to: 40, zFrom: 0, depth: 0, note: '' }); })}
          addLabel="Tabuzone" />
      </Section>

      <Section title={`Türen (${room.doors.length})`}>
        <EditTable rows={room.doors} rowKey={(r) => r.id}
          cols={[
            { key: 'wallIndex', label: 'Wand', type: 'select', options: wallOpts },
            { key: 's', label: 'ab l. Ecke', type: 'number' }, { key: 'width', label: 'Breite', type: 'number' }, { key: 'height', label: 'Höhe', type: 'number' },
            { key: 'hinge', label: 'Bänder', type: 'select', options: opts({ links: 'links', rechts: 'rechts' }) },
            { key: 'swing', label: 'öffnet', type: 'select', options: opts({ innen: 'nach innen', aussen: 'nach außen' }) },
            { key: 'hasFrame', label: 'Zarge', type: 'check' },
            { key: 'fireRating', label: 'Brandschutz', type: 'select', options: opts({ keine: '–', T30: 'T30', T60: 'T60', T90: 'T90', RS: 'RS' }) },
            { key: 'leadsTo', label: 'führt zu', type: 'text' },
          ] as Col<any>[]}
          onChange={(i, k, v) => upRoom(id, `${room.name}: Tür ${k}`, (r) => { (r.doors[i] as any)[k] = k === 'wallIndex' ? Number(v) : v; })}
          onRemove={(i) => upRoom(id, `${room.name}: Tür entfernt`, (r) => { r.doors.splice(i, 1); })}
          onAdd={() => upRoom(id, `${room.name}: Tür ergänzt`, (r) => { r.doors.push({ id: newId('t'), wallIndex: 0, s: 20, width: 86, height: 201, hinge: 'links', swing: 'innen', hasFrame: true, fireRating: 'keine', leadsTo: '', isMainEntrance: r.doors.length === 0, provenance: 'gemessen' }); })}
          addLabel="Tür" />
        <p className="muted small">Bänder links/rechts: Blick von innen auf die Wand. Schalter gehören auf die Griffseite (gegenüber den Bändern).</p>
      </Section>

      <Section title={`Fenster (${room.windows.length})`} open={room.windows.length > 0}>
        <EditTable rows={room.windows} rowKey={(r) => r.id}
          cols={[
            { key: 'wallIndex', label: 'Wand', type: 'select', options: wallOpts },
            { key: 's', label: 'ab l. Ecke', type: 'number' }, { key: 'width', label: 'Breite', type: 'number' },
            { key: 'sill', label: 'Brüstung', type: 'number' }, { key: 'height', label: 'Höhe', type: 'number' },
            { key: 'status', label: 'Status', type: 'select', options: opts({ bleibt: 'bleibt', wird_zugemauert: 'wird zugemauert', wird_ersetzt: 'wird ersetzt', neu: 'neu' }) },
            { key: 'lightWell', label: 'Lichtschacht', type: 'check' },
          ] as Col<any>[]}
          onChange={(i, k, v) => upRoom(id, `${room.name}: Fenster ${k}`, (r) => { (r.windows[i] as any)[k] = k === 'wallIndex' ? Number(v) : v; })}
          onRemove={(i) => upRoom(id, `${room.name}: Fenster entfernt`, (r) => { r.windows.splice(i, 1); })}
          onAdd={() => upRoom(id, `${room.name}: Fenster ergänzt`, (r) => { r.windows.push({ id: newId('f'), wallIndex: 0, s: 50, width: 100, sill: 90, height: 120, status: 'bleibt', lightWell: false, provenance: 'gemessen' }); })}
          addLabel="Fenster" />
      </Section>

      <Section title="Boden und Decke">
        <div className="grid2">
          <div>
            <h4>Boden (Höhenbezug: {project.settings.heightReference.label})</h4>
            <Check checked={room.floor.slotsAllowed} onChange={(v) => upRoom(id, `${room.name}: Bodenschlitze`, (r) => { r.floor.slotsAllowed = v; })} label="Bodenschlitze erlaubt" />
            <Check checked={room.floor.underfloorHeating} onChange={(v) => upRoom(id, `${room.name}: FBH`, (r) => { r.floor.underfloorHeating = v; })} label="Fußbodenheizung" />
            <div className="grid2">
              <Field label="Folie/Dämmung beginnt in (cm)"><NumberInput nullable value={room.floor.protectedLayerDepth} onChange={(v) => upRoom(id, `${room.name}: Tiefe Folie`, (r) => { r.floor.protectedLayerDepth = v; })} /></Field>
              <Field label="Max. Schlitztiefe (cm)"><NumberInput value={room.floor.maxSlotDepth} onChange={(v) => v != null && upRoom(id, `${room.name}: Schlitztiefe`, (r) => { r.floor.maxSlotDepth = v; })} /></Field>
            </div>
            <h4>Künftiger Aufbau über Bezug (+{fmt(fb)} cm)</h4>
            <EditTable rows={room.floor.futureAboveRef} rowKey={(_r, i) => String(i)} cols={[{ key: 'name', label: 'Schicht', type: 'text' }, { key: 'thickness', label: 'Dicke', type: 'number' }]}
              onChange={(i, k, v) => upRoom(id, `${room.name}: Bodenaufbau`, (r) => { (r.floor.futureAboveRef[i] as any)[k] = v; })}
              onRemove={(i) => upRoom(id, `${room.name}: Bodenaufbau`, (r) => { r.floor.futureAboveRef.splice(i, 1); })}
              onAdd={() => upRoom(id, `${room.name}: Bodenaufbau`, (r) => { r.floor.futureAboveRef.push({ name: 'Belag', thickness: 1 }); })} addLabel="Schicht" />
            <h4>Bestand unter dem Bezug</h4>
            <EditTable rows={room.floor.existingBelowRef} rowKey={(_r, i) => String(i)} cols={[{ key: 'name', label: 'Schicht', type: 'text' }, { key: 'thickness', label: 'Dicke', type: 'number' }]}
              onChange={(i, k, v) => upRoom(id, `${room.name}: Bodenbestand`, (r) => { (r.floor.existingBelowRef[i] as any)[k] = v; })}
              onRemove={(i) => upRoom(id, `${room.name}: Bodenbestand`, (r) => { r.floor.existingBelowRef.splice(i, 1); })}
              onAdd={() => upRoom(id, `${room.name}: Bodenbestand`, (r) => { r.floor.existingBelowRef.push({ name: 'Estrich', thickness: 5 }); })} addLabel="Schicht" />
          </div>
          <div>
            <h4>Decke</h4>
            <Field label="Bauart"><Select value={room.ceiling.construction} options={opts(ceilingLabel)} onChange={(v) => v && upRoom(id, `${room.name}: Decke`, (r) => { r.ceiling.construction = v as any; })} /></Field>
            <Check checked={room.ceiling.slotsAllowed} onChange={(v) => upRoom(id, `${room.name}: Deckenschlitze`, (r) => { r.ceiling.slotsAllowed = v; })} label="Decke darf geschlitzt werden" />
            <Check checked={room.ceiling.drillingAllowed} onChange={(v) => upRoom(id, `${room.name}: Deckenbohrung`, (r) => { r.ceiling.drillingAllowed = v; })} label="Decke darf gebohrt werden" />
            <Field label="Hohlraum unter Decke (Paneele/Abhängung, cm)"><NumberInput value={room.ceiling.cavityDepth} onChange={(v) => v != null && upRoom(id, `${room.name}: Deckenhohlraum`, (r) => { r.ceiling.cavityDepth = v; })} /></Field>
            <Field label="Notiz"><TextInput value={room.ceiling.note} onChange={(v) => upRoom(id, `${room.name}: Deckennotiz`, (r) => { r.ceiling.note = v; })} /></Field>
          </div>
        </div>
      </Section>

      <Section title={`Hindernisse (${room.obstacles.length})`} open={room.obstacles.length > 0}>
        <EditTable rows={room.obstacles} rowKey={(r) => r.id}
          cols={[
            { key: 'kind', label: 'Art', type: 'select', options: opts({ heizkoerper: 'Heizkörper', rohr: 'Rohr', rohrkasten: 'Rohrkasten', schacht: 'Schacht', stuetze: 'Stütze', tor: 'Tor (geöffnet)', torlaufschiene: 'Torlaufschiene', sonstiges: 'Sonstiges' }) },
            { key: 'label', label: 'Bezeichnung', type: 'text' },
            { key: 'x', label: 'x', type: 'number' }, { key: 'y', label: 'y', type: 'number' }, { key: 'w', label: 'Breite', type: 'number' }, { key: 'd', label: 'Tiefe', type: 'number' },
            { key: 'zFrom', label: 'Höhe von', type: 'number' }, { key: 'zTo', label: 'bis', type: 'nullnumber' },
            { key: 'wallIndex', label: 'an Wand', type: 'select', options: wallOpts, allowEmpty: '–' },
          ] as Col<any>[]}
          onChange={(i, k, v) => upRoom(id, `${room.name}: Hindernis`, (r) => { (r.obstacles[i] as any)[k] = k === 'wallIndex' ? (v == null ? undefined : Number(v)) : v; })}
          onRemove={(i) => upRoom(id, `${room.name}: Hindernis entfernt`, (r) => { r.obstacles.splice(i, 1); })}
          onAdd={() => upRoom(id, `${room.name}: Hindernis ergänzt`, (r) => { r.obstacles.push({ id: newId('h'), kind: 'heizkoerper', label: 'Heizkörper', x: 50, y: 0, w: 100, d: 10, zFrom: 15, zTo: 75, wallIndex: 0, note: '' }); })}
          addLabel="Hindernis" />
      </Section>

      <Section title={`Bestandsleitungen (${room.existingCables.length})`} open={room.existingCables.length > 0}>
        <EditTable rows={room.existingCables} rowKey={(r) => r.id}
          cols={[
            { key: 'label', label: 'Bezeichnung', type: 'text' }, { key: 'cableType', label: 'Leitungstyp', type: 'text' }, { key: 'goesTo', label: 'geht nach', type: 'text' },
            { key: 'condition', label: 'Zustand', type: 'select', options: opts({ unbekannt: 'unbekannt', gut: 'gut', fraglich: 'fraglich', defekt: 'defekt' }) },
            { key: 'reuse', label: 'weiterverwenden', type: 'select', options: opts({ pruefen: 'prüfen', ja: 'ja', nein: 'nein' }) },
          ] as Col<any>[]}
          onChange={(i, k, v) => upRoom(id, `${room.name}: Bestandsleitung`, (r) => { (r.existingCables[i] as any)[k] = v; })}
          onRemove={(i) => upRoom(id, `${room.name}: Bestandsleitung entfernt`, (r) => { r.existingCables.splice(i, 1); })}
          onAdd={() => upRoom(id, `${room.name}: Bestandsleitung ergänzt`, (r) => { r.existingCables.push({ id: newId('bl'), label: '', description: '', cableType: 'unbekannt', goesTo: '', condition: 'unbekannt', reuse: 'pruefen', note: '' }); })}
          addLabel="Bestandsleitung" />
        <p className="muted small">Prüfaufgaben je Bestandsleitung: Zugtest (lose → neue Leitung mit einziehen), Adernzahl/Schutzleiter prüfen, Isolationsmessung durch die Elektrofachkraft.</p>
      </Section>
    </>
  );
}

/** Vorwand-Abschnitt / Tabuzone ändern – auch Umhängen auf eine andere Wand. */
function editWallItem(room: Room, kind: 'preWall' | 'zones', row: { id: string; wall: string }, key: string, value: any) {
  upRoom(room.id, `${room.name}: ${kind === 'preWall' ? 'Vorwand' : 'Tabuzone'} geändert`, (r) => {
    const wIdx = Number(row.wall);
    const list = r.walls[wIdx][kind] as any[];
    const i = list.findIndex((x) => x.id === row.id);
    if (i < 0) return;
    if (key === 'wall') {
      const [item] = list.splice(i, 1);
      (r.walls[Number(value)][kind] as any[]).push(item);
    } else {
      list[i][key] = value;
    }
  });
}

function removeWallItem(room: Room, kind: 'preWall' | 'zones', row: { id: string; wall: string }) {
  upRoom(room.id, `${room.name}: ${kind === 'preWall' ? 'Vorwand' : 'Tabuzone'} entfernt`, (r) => {
    const w = r.walls[Number(row.wall)];
    (w as any)[kind] = (w[kind] as any[]).filter((x) => x.id !== row.id);
  });
}

// ---------------------------------------------------------------------------

function EinrichtungTab({ room, wallOpts }: { room: Room; wallOpts: { value: string; label: string }[] }) {
  const [kind, setKind] = useState(FURNITURE_TYPES[0].kind);
  return (
    <Section title={`Möbel und Geräte (${room.furniture.length})`}>
      <EditTable rows={room.furniture} rowKey={(r) => r.id}
        cols={[
          { key: 'kind', label: 'Typ', type: 'select', options: FURNITURE_TYPES.map((f) => ({ value: f.kind, label: f.label })) },
          { key: 'label', label: 'Bezeichnung', type: 'text' },
          { key: 'x', label: 'x', type: 'number' }, { key: 'y', label: 'y', type: 'number' }, { key: 'w', label: 'Breite', type: 'number' }, { key: 'd', label: 'Tiefe', type: 'number' }, { key: 'height', label: 'Höhe', type: 'number' },
          { key: 'wallIndex', label: 'an Wand', type: 'select', options: wallOpts, allowEmpty: '–' },
        ] as Col<any>[]}
        onChange={(i, k, v) => upRoom(room.id, `${room.name}: Möbel ${k}`, (r) => { (r.furniture[i] as any)[k] = k === 'wallIndex' ? (v == null ? undefined : Number(v)) : v; })}
        onRemove={(i) => upRoom(room.id, `${room.name}: Möbel entfernt`, (r) => { r.furniture.splice(i, 1); })} />
      <div className="inline">
        <Select value={kind} options={FURNITURE_TYPES.map((f) => ({ value: f.kind, label: f.label }))} onChange={(v) => v && setKind(v)} />
        <button onClick={() => {
          const t = FURNITURE_TYPES.find((f) => f.kind === kind)!;
          upRoom(room.id, `${room.name}: ${t.label} ergänzt`, (r) => { r.furniture.push({ id: newId('m'), kind: t.kind, label: t.label, x: 10, y: 10, w: t.w, d: t.d, height: t.height, wallIndex: 0, note: '' }); });
        }}>＋ Möbel/Gerät</button>
      </div>
      <p className="muted small">Lage x/y ab Raum-Nullpunkt (linke obere Ecke des Möbels in der Draufsicht). Automatische Auslass-Vorschläge aus Möbeln folgen in Etappe 2.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------

const QUICK: Outlet['kind'][] = ['steckdose', 'schalter', 'taster', 'lan', 'licht_decke', 'licht_wand', 'anschlussdose', 'herd', 'lautsprecher', 'tv_sat', 'rauchwarnmelder', 'starkstrom', 'leerdose'];

function AuslassTab({ project, room, wallOpts, wallIndex, selected }: { project: Project; room: Room; wallOpts: { value: string; label: string }[]; wallIndex: number; selected?: Outlet }) {
  const circuitOpts = project.circuits.map((c) => ({ value: c.id, label: `${c.label} ${c.name}` }));
  const set = (o: Outlet, k: keyof Outlet, v: any) => upRoom(room.id, `${room.name}: ${o.label} ${String(k)}`, (r) => {
    const x = r.outlets.find((y) => y.id === o.id);
    if (x) (x as any)[k] = v;
  });
  return (
    <>
      <Section title="Neuer Auslass">
        <div className="quick">
          {QUICK.map((k) => (
            <button key={k} onClick={() => {
              const o = newOutlet(project, room, k, wallIndex);
              upRoom(room.id, `${room.name}: ${o.label} (${outletKindLabel[k]}) ergänzt`, (r) => { r.outlets.push(o); });
              store.setUi({ outletId: o.id });
            }}>＋ {outletKindLabel[k]}</button>
          ))}
        </div>
        <p className="muted small">Neue Wandauslässe landen auf der gewählten Wand (W{wallIndex + 1}) in Standardhöhe; Schalter automatisch auf der Griffseite neben der Tür ({fmt(normValue(project, 'schalter.abstandZarge'))} cm neben Zarge).</p>
      </Section>
      {selected && <OutletDetail project={project} room={room} o={selected} wallOpts={wallOpts} circuitOpts={circuitOpts} />}
      <Section title={`Alle Auslässe (${room.outlets.length})`}>
        <EditTable rows={[...room.outlets].sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))} rowKey={(r) => r.id} selectedKey={selected?.id}
          onSelect={(r) => store.setUi({ outletId: r.id, wallIndex: r.wallIndex ?? wallIndex })}
          cols={[
            { key: 'label', label: 'Nr.', type: 'text', width: '4.5em' },
            { key: 'kind', label: 'Art', type: 'readonly', render: (r: Outlet) => <span>{outletKindLabel[r.kind]}</span> },
            { key: 'wallIndex', label: 'Ort', type: 'readonly', render: (r: Outlet) => <span>{r.mount === 'wand' ? `W${(r.wallIndex ?? 0) + 1}` : r.mount}</span> },
            { key: 's', label: 'ab l. Ecke / x', type: 'readonly', render: (r: Outlet) => <span>{r.mount === 'wand' ? fmt(r.s) : `${fmt(r.x)} / ${fmt(r.y)}`}</span> },
            { key: 'z', label: 'Höhe (FFB)', type: 'readonly', render: (r: Outlet) => <span>{r.z != null ? `${fmt(r.z)} (${fmt(zToFfb(room, r.z))})` : '–'}</span> },
            { key: 'gangs', label: 'Pl.', type: 'readonly' },
            { key: 'circuitId', label: 'SK', type: 'readonly', render: (r: Outlet) => <span>{project.circuits.find((c) => c.id === r.circuitId)?.label ?? '–'}</span> },
          ] as Col<any>[]}
          onChange={(i, k, v) => { const o = [...room.outlets].sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))[i]; set(o, k as keyof Outlet, v); }}
          onRemove={(i) => { const o = [...room.outlets].sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))[i]; upRoom(room.id, `${room.name}: ${o.label} gelöscht`, (r) => { r.outlets = r.outlets.filter((x) => x.id !== o.id); }); }} />
      </Section>
    </>
  );
}

function OutletDetail({ project, room, o, wallOpts, circuitOpts }: { project: Project; room: Room; o: Outlet; wallOpts: { value: string; label: string }[]; circuitOpts: { value: string; label: string }[] }) {
  const set = (k: keyof Outlet, v: any) => upRoom(room.id, `${room.name}: ${o.label} – ${String(k)}`, (r) => {
    const x = r.outlets.find((y) => y.id === o.id);
    if (x) (x as any)[k] = v;
  });
  const fb = futureBuildup(room);
  return (
    <Section title={<>Auslass <b>{o.label}</b> – {outletKindLabel[o.kind]}</>}>
      <div className="grid3">
        <Field label="Bezeichnung"><TextInput value={o.label} onChange={(v) => set('label', v)} /></Field>
        <Field label="Art"><Select value={o.kind} options={opts(outletKindLabel)} onChange={(v) => v && set('kind', v)} /></Field>
        <Field label="Montage"><Select value={o.mount} options={opts({ wand: 'Wand', decke: 'Decke', boden: 'Boden' })} onChange={(v) => upRoom(room.id, `${room.name}: ${o.label} Montage`, (r) => {
          const x = r.outlets.find((y) => y.id === o.id)!;
          x.mount = v as any;
          if (v === 'wand') { x.wallIndex ??= 0; x.s ??= 50; x.z ??= defaultZ(project, room, x.kind); } else { x.x ??= 50; x.y ??= 50; }
        })} /></Field>
        {o.mount === 'wand' ? (<>
          <Field label="Wand"><Select value={String(o.wallIndex ?? 0)} options={wallOpts} onChange={(v) => { set('wallIndex', Number(v)); store.setUi({ wallIndex: Number(v) }); }} /></Field>
          <Field label="Abstand ab linker Ecke (cm)" hint={(o.convention ?? project.settings.boxConvention) === 'mittig' ? 'Mitte der Kombination' : 'erste Dose'}><NumberInput value={o.s} onChange={(v) => v != null && set('s', v)} /></Field>
          <Field label={`Höhe Dosenmitte über Bezug (cm)`} hint={o.z != null ? `= ${fmt(zToFfb(room, o.z))} cm über FFB (Aufbau ${fmt(fb)})` : ''}><NumberInput value={o.z} onChange={(v) => v != null && set('z', v)} /></Field>
        </>) : (<>
          <Field label="x ab Nullpunkt (cm)"><NumberInput value={o.x} onChange={(v) => v != null && set('x', v)} /></Field>
          <Field label="y ab Nullpunkt (cm)"><NumberInput value={o.y} onChange={(v) => v != null && set('y', v)} /></Field>
          <span />
        </>)}
        <Field label="Dosenplätze"><NumberInput value={o.gangs} step={1} min={1} onChange={(v) => v && upRoom(room.id, `${room.name}: ${o.label} Plätze`, (r) => {
          const x = r.outlets.find((y) => y.id === o.id)!;
          x.gangs = Math.max(1, Math.min(6, Math.round(v)));
          while (x.inserts.length < x.gangs) x.inserts.push(x.inserts[0] ?? 'steckdose');
          x.inserts = x.inserts.slice(0, x.gangs);
        })} /></Field>
        <Field label="Ausrichtung"><Select value={o.orientation} options={opts({ waagerecht: 'waagerecht', senkrecht: 'senkrecht' })} onChange={(v) => set('orientation', v)} /></Field>
        <Field label="Weitere Dosen"><Select value={o.growth} options={opts(o.orientation === 'waagerecht' ? { rechts: 'nach rechts', links: 'nach links' } : { oben: 'nach oben', unten: 'nach unten' })} onChange={(v) => set('growth', v)} /></Field>
        <Field label="Position bezieht sich auf"><Select value={o.convention} allowEmpty="Projektvorgabe" options={opts({ erste_an_position: 'erste Dose', mittig: 'Mitte der Kombination' })} onChange={(v) => set('convention', v)} /></Field>
        <Field label="Dosenart"><Select value={o.boxType} options={opts(boxTypeLabel)} onChange={(v) => set('boxType', v)} /></Field>
        <Field label="Status"><Select value={o.status} options={opts({ neu: 'neu', bestand_bleibt: 'Bestand bleibt', bestand_wird_ersetzt: 'Bestand wird ersetzt', bestand_entfaellt: 'Bestand entfällt' })} onChange={(v) => set('status', v)} /></Field>
        <Field label="Stromkreis"><Select value={o.circuitId} allowEmpty="– noch offen –" options={circuitOpts} onChange={(v) => set('circuitId', v)} /></Field>
        <Field label=" "><Check checked={o.smart} onChange={(v) => set('smart', v)} label="Smart (Aktor/Taster)" /></Field>
      </div>
      <div className="inline">
        <span className="muted small">Bestückung:</span>
        {o.inserts.map((ins, i) => (
          <Select key={i} value={ins} options={opts(insertLabel)} onChange={(v) => upRoom(room.id, `${room.name}: ${o.label} Bestückung`, (r) => { const x = r.outlets.find((y) => y.id === o.id)!; x.inserts[i] = v as any; })} />
        ))}
        {o.inserts.length < o.gangs && <button className="small" onClick={() => upRoom(room.id, `${room.name}: ${o.label} Bestückung`, (r) => { r.outlets.find((y) => y.id === o.id)!.inserts.push('steckdose'); })}>＋</button>}
      </div>
      <Field label="Hinweis"><TextInput wide value={o.note} onChange={(v) => set('note', v)} /></Field>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function SummaryTab({ project, room, findings }: { project: Project; room: Room; findings: ReturnType<typeof runRules>['findings'] }) {
  const byKind = new Map<string, number>();
  for (const o of room.outlets) byKind.set(outletKindLabel[o.kind], (byKind.get(outletKindLabel[o.kind]) ?? 0) + 1);
  const questions: string[] = [];
  if (!room.usage) questions.push('Wie wird der Raum genutzt – und vielleicht später einmal?');
  if (room.doors.length === 0) questions.push('Wo ist die Tür (Wand, Abstand zur Ecke, Breite, Bänder links/rechts)?');
  if (room.walls.some((w) => w.material === 'unbekannt')) questions.push('Aus welchem Material sind die Wände (Bims, KS, Beton, Ziegel, Trockenbau)?');
  if (room.ceiling.construction === 'unbekannt') questions.push('Welche Decke hat der Raum (Stahlbeton, Hourdis, Holzbalken, abgehängt)? Darf geschlitzt/gebohrt werden?');
  if (room.floor.slotsAllowed && room.floor.protectedLayerDepth == null) questions.push('In welcher Tiefe liegen Folie/Dämmung im Boden?');
  if (room.floor.futureAboveRef.length === 0 && room.installationType === 'unterputz') questions.push('Kommt noch ein Bodenaufbau (Ausgleich, Belag)? Er verschiebt alle Höhen über FFB.');
  if (!room.outlets.some((o) => o.kind === 'licht_decke' || o.kind === 'licht_wand')) questions.push('Wo soll Licht hin (Deckenauslass, Wandleuchte, Spots)?');
  if (effectiveSmart(project, room) !== 'keines' && !room.outlets.some((o) => o.smart)) questions.push('Smart Home ist aktiv: Welche Lichter/Steckdosen sollen smart geschaltet werden?');
  return (
    <>
      <Section title="Zusammenfassung zur Bestätigung">
        <dl className="kv">
          <dt>Raum</dt><dd>{room.name}{room.formerName && room.formerName !== room.name ? ` (Bestandsplan: ${room.formerName})` : ''} – {room.usage || 'Nutzung offen'}{room.futureUsage ? `, künftig: ${room.futureUsage}` : ''}</dd>
          <dt>Größe</dt><dd>{fmt(roomArea(room), 2)} m², {room.polygon.length} Wände, Höhe {fmt(room.height)} cm</dd>
          <dt>Wände</dt><dd>{room.walls.map((w) => `W${w.index + 1} ${wallMaterialLabel[w.material]}${w.exterior ? ' (außen)' : ''}${w.preWall.length ? ' + Vorwand' : ''}${w.zones.length ? ' + Tabuzone' : ''}`).join(', ')}</dd>
          <dt>Öffnungen</dt><dd>{room.doors.length} Tür(en), {room.windows.length} Fenster</dd>
          <dt>Boden/Decke</dt><dd>{room.floor.slotsAllowed ? `Bodenschlitze bis ${fmt(room.floor.maxSlotDepth)} cm` : 'keine Bodenschlitze'}; Aufbau +{fmt(futureBuildup(room))} cm; Decke {ceilingLabel[room.ceiling.construction]} {room.ceiling.slotsAllowed ? '(schlitzbar)' : '(nicht schlitzen)'}</dd>
          <dt>Auslässe</dt><dd>{[...byKind.entries()].map(([k, v]) => `${v}× ${k}`).join(', ') || 'keine'}</dd>
          <dt>Smart Home</dt><dd>{smartHomeLabel[effectiveSmart(project, room)]}</dd>
        </dl>
        <div className="inline">
          {room.confirmed
            ? <button onClick={() => upRoom(room.id, `${room.name}: Bestätigung zurückgenommen`, (r) => { r.confirmed = false; })}>Bestätigung zurücknehmen</button>
            : <button className="primary" onClick={() => upRoom(room.id, `${room.name}: Zusammenfassung bestätigt`, (r) => { r.confirmed = true; })}>✔ Raum so bestätigen</button>}
        </div>
      </Section>
      {questions.length > 0 && (
        <Section title={`Offene Fragen (${questions.length})`}>
          <ul>{questions.map((q) => <li key={q}>{q}</li>)}</ul>
        </Section>
      )}
      <Section title={`Regelprüfung (${findings.length})`}>
        <FindingsList findings={findings} />
      </Section>
    </>
  );
}

export function FindingsList({ findings, project }: { findings: ReturnType<typeof runRules>['findings']; project?: Project }) {
  if (!findings.length) return <p className="ok">✔ Keine Auffälligkeiten.</p>;
  return (
    <table className="findings">
      <thead><tr><th>Status</th>{project && <th>Raum</th>}<th>Meldung</th><th>Quelle</th></tr></thead>
      <tbody>
        {findings.map((f, i) => (
          <tr key={i} className={`sev-${f.severity}`} onClick={() => f.roomId && store.setUi({ view: 'raum', roomId: f.roomId, outletId: f.outletId })}>
            <td><span className={`pill sev-${f.severity}`}>{severityLabel[f.severity]}</span></td>
            {project && <td>{project.rooms.find((r) => r.id === f.roomId)?.name ?? 'Projekt'}</td>}
            <td>{f.message}</td>
            <td className="small">{f.source}{f.confirm && <span className="confirm"> ⚠ vom Elektriker zu bestätigen</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
