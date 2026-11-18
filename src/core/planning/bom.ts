/**
 * Material- und Bestellliste – vollständig aus Modell, Leitungswegen und Längen
 * berechnet. Der Nutzer kann Mengen/Preise überschreiben, abhaken und eigene
 * Positionen ergänzen (project.material).
 */
import type { Outlet, Project } from '../model/schema';
import { effectiveSmart } from '../rules/rules';
import { cableById, packsFor } from './cables';
import { cableTotals, computeLengths, type Lengths } from './circuits';
import { GROUP_ORDER, CABLE_PRICE, priceItem, type MaterialGroup } from './prices';
import { routeTotals } from './routes';

export interface MaterialLine {
  id: string;
  group: MaterialGroup;
  label: string;
  unit: string;
  /** berechneter Bedarf */
  need: number;
  /** Bestellmenge (Gebinde aufgerundet bzw. überschrieben) */
  order: number;
  orderText: string;
  unitPrice: number;
  total: number;
  note: string;
  checked: boolean;
  overridden: { qty: boolean; price: boolean };
  source: 'berechnet' | 'manuell';
}

export interface MaterialList {
  lines: MaterialLine[];
  groups: { group: MaterialGroup; total: number; lines: MaterialLine[] }[];
  total: number;
  openTotal: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function computeMaterial(project: Project, lengths: Lengths = computeLengths(project)): MaterialList {
  const need = new Map<string, { n: number; note: string[] }>();
  const add = (id: string, n: number, note?: string) => {
    if (!(n > 0)) return;
    const cur = need.get(id) ?? { n: 0, note: [] };
    cur.n += n;
    if (note && !cur.note.includes(note)) cur.note.push(note);
    need.set(id, cur);
  };
  const rooms = project.rooms.filter((r) => r.inScope);
  const isNew = (o: Outlet) => o.status === 'neu' || o.status === 'bestand_wird_ersetzt';
  const powered = (o: Outlet) => ['steckdose', 'schalter', 'taster', 'bewegungsmelder', 'licht_decke', 'licht_wand', 'anschlussdose', 'festanschluss', 'herd', 'starkstrom'].includes(o.kind);

  // --- Dosen, Einsätze, Rahmen, Klemmen ---------------------------------------
  for (const room of rooms) {
    const smartSys = effectiveSmart(project, room);
    for (const o of room.outlets.filter(isNew)) {
      if (o.kind === 'rauchwarnmelder') { add('lg.rwm', 1); continue; }
      // Festanschluss (z. B. Wallbox): keine Dose, kein Einsatz – Leitung wird direkt im Gerät angeklemmt
      if (o.kind === 'festanschluss') continue;
      const ap = o.boxType === 'aufputz';
      if (o.mount === 'wand') {
        if (o.boxType === 'up') add('dose.up', o.gangs);
        else if (o.boxType === 'up_tief') add('dose.up_tief', o.gangs);
        else if (o.boxType === 'hohlwand' || o.boxType === 'vorwand') add('dose.hohlwand', o.gangs);
        else if (o.boxType === 'aufputz_holz') add('dose.holz', o.gangs);
        else if (ap) { let g = o.gangs; while (g > 0) { const k = Math.min(3, g); add(`dose.ap_gehaeuse${k}`, 1); g -= k; } }
      } else {
        if (o.boxType === 'decke_beton') add('dose.decke_beton', 1);
        else if (o.boxType === 'decke_hohl') add('dose.decke_hohl', 1);
        else if (ap) add('dose.abzweig_ap', 1);
      }
      // Einsätze
      for (const ins of o.inserts) {
        if (ap) {
          if (o.kind === 'starkstrom') add('sp.ap_cee', 1);
          else if (ins.startsWith('steckdose')) add('sp.ap_steckdose', 1);
          else if (['ausschalter', 'wechselschalter', 'kreuzschalter', 'serienschalter', 'taster'].includes(ins)) add('sp.ap_schalter', 1);
          else add(`sp.${ins}`, 1);
        } else add(`sp.${ins}`, 1);
      }
      if (o.mount === 'wand' && !ap && o.inserts.length && o.boxType !== 'bestand') add(`sp.rahmen${Math.min(5, o.gangs)}`, 1);
      // Smart: UP-Aktor hinter Schaltern/Leuchten, wenn als smart markiert und nicht schon als Einsatz geplant
      if (o.smart && smartSys !== 'keines' && smartSys !== 'knx' && !o.inserts.includes('aktor_unterputz') && ['schalter', 'taster', 'licht_decke', 'licht_wand'].includes(o.kind)) add('sp.aktor_unterputz', 1, 'je Smart-Schaltstelle geschätzt');
      // Klemmen
      if (powered(o)) {
        const five = /5×/.test(project.circuits.find((c) => c.id === o.circuitId)?.cable ?? '') || o.kind === 'herd' || o.kind === 'starkstrom';
        add(five ? 'km.wago5' : 'km.wago3', five ? 5 : 3 * Math.max(1, Math.min(2, o.gangs)));
      }
      if (o.mount === 'wand' && (o.boxType === 'up' || o.boxType === 'up_tief')) add('km.dosenmoertel', 0.4 * o.gangs);
      // Leuchten (Platzhalter)
      if (o.kind === 'licht_decke') add(/spot|paneel/i.test(o.note) ? 'lg.spots' : room.wetRoom || room.installationType.startsWith('aufputz') ? 'lg.wanne' : 'lg.leuchte', 1, 'Platzhalter – Leuchte nach Wahl');
      if (o.kind === 'licht_wand' && !/unterbau/i.test(o.note)) add('lg.wandleuchte', 1, 'Platzhalter');
      if (/lüfter|luefter/i.test(o.note)) add('lg.luefter', 1);
    }

    // --- Schlitze, Aufputz, Durchbrüche ----------------------------------------
    const rr = lengths.routes.get(room.id);
    if (!rr) continue;
    let wallL = 0, floorL = 0;
    for (const w of rr.wallSlots) wallL += ((w.orientation === 'senkrecht' ? w.zTo - w.zFrom : w.sTo - w.s) * (w.width / 10) * (w.depth / 10)) / 1000;
    for (const f of rr.floorSlots.filter((x) => !x.inCavity)) floorL += (f.length * (f.width / 10) * (f.depth / 10)) / 1000;
    add('km.gips', wallL * 1.2 * 1.3);
    add('km.reparaturmoertel', floorL * 2.0 * 1.2);
    const t = routeTotals(rr);
    add('km.schnellzement', t.floorSlotM * 0.5);
    for (const a of rr.surfaceRuns) {
      const m = (a.length / 100) * 1.1;
      add(a.cables.length > 3 ? 'km.rohr25' : 'km.rohr20', m);
      add('km.rohrschelle', Math.ceil(m * 2));
      add('km.rohrbogen', 1);
      if (a.kind === 'stich' && /garage/i.test(`${room.name} ${room.usage}`)) add('km.stahlrohr', 1.5, 'mechanischer Schutz Garage');
    }
    // je gequerter Tür ein Stück Schutzrohr (Schwellenbreite + Überstand)
    const crossed = room.doors.filter((d) => rr.floorSlots.some((f) => !f.inCavity && f.wallIndex === d.wallIndex && f.sFrom < d.s + d.width && d.s < f.sTo));
    add('km.schutzrohr_schwelle', crossed.reduce((s, d) => s + d.width / 100 + 0.5, 0));
    for (const p of rr.penetrations) add(p.fireStop ? 'km.abschottung' : 'km.durchfuehrung', 1);
  }
  add('km.kabelbinder', Math.max(1, Math.ceil(rooms.length / 5)));
  // Kleinstmengen M25 dem M20-Rohr zuschlagen
  const r25 = need.get('km.rohr25');
  if (r25 && r25.n < 1) { need.delete('km.rohr25'); add('km.rohr20', r25.n); }

  // --- Kabel --------------------------------------------------------------------
  const cableLines: { id: string; cable: string; meters: number }[] = cableTotals(lengths).map((c) => ({ id: `kabel.${c.cable}`, cable: c.cable, meters: c.meters }));
  const nyy = cableLines.filter((c) => c.cable.startsWith('NYY')).reduce((s, c) => s + c.meters, 0);
  if (nyy) { add('km.warnband', nyy); add('km.erdrohr', nyy, 'plus Reserve-Leerrohr'); add('km.dichtung', 1); }

  // --- Verteiler ------------------------------------------------------------------
  for (const c of project.circuits) if (!c.breakerGroupId) add(c.poles === 3 ? 'vt.ls3' : 'vt.ls1', 1);
  let distChanged = false;
  for (const d of project.distributions) {
    for (const r of d.rcds.filter((x) => !x.existing)) add(/wallbox/i.test(r.label) ? 'vt.rcd_wallbox' : 'vt.rcd', 1);
    if (d.kind === 'UV') { add('vt.kv', 1); add('vt.kv_nh', 1); add('vt.kleinmaterial', 1); if (d.hasSpd) add('vt.spd', 1); }
    else if (project.circuits.some((c) => c.distributionId === d.id && !c.breakerGroupId) || d.rcds.some((r) => !r.existing)) distChanged = true;
  }
  if (distChanged) add('vt.kleinmaterial', 1);

  // --- Netzwerk / Smart Home -----------------------------------------------------
  const lanRuns = lengths.runs.filter((r) => r.cable === 'Cat.7' && r.from === 'Netzwerkschrank').length;
  add('nw.patch', lanRuns);
  add('nw.ap', project.network.poeAccessPoints);
  if (project.smartHome.enabled) {
    if (project.smartHome.system === 'knx') add('nw.knx_basis', 1, 'grobe Pauschale, Planung durch KNX-Integrator');
    else if (project.smartHome.system !== 'keines') add('nw.smart_zentrale', 1, 'falls noch nicht vorhanden');
  }

  // --- Werkzeug -----------------------------------------------------------------
  const allT = rooms.map((r) => lengths.routes.get(r.id)).filter(Boolean).map((rr) => routeTotals(rr!));
  const slotM = allT.reduce((s, t) => s + t.floorSlotM + t.wallSlotM, 0);
  const up = allT.reduce((s, t) => s + t.drillUP, 0);
  if (slotM > 0) { const days = Math.max(1, Math.ceil(slotM / 25)); add('wz.fraese', days, `ca. 25 m Schlitz je Tag (${r1(slotM)} m)`); add('wz.sauger', days); add('wz.scheiben', 1); }
  if (up > 0) add('wz.senker', 1);
  if (slotM > 0 || up > 0) { add('wz.ortung', 1); add('wz.schutz', 1); }

  // --- Positionen bauen -----------------------------------------------------------
  const m = project.material;
  const lines: MaterialLine[] = [];
  const mk = (id: string, group: MaterialGroup, label: string, unit: string, needV: number, orderV: number, orderText: string, price: number, note: string, source: MaterialLine['source'] = 'berechnet') => {
    const qo = m.qtyOverrides[id];
    const po = m.priceOverrides[id];
    const order = qo ?? orderV;
    const unitPrice = po ?? price;
    lines.push({ id, group, label, unit, need: r1(needV), order: r1(order), orderText: qo != null ? `${r1(qo)} ${unit} (angepasst)` : orderText, unitPrice, total: Math.round(order * unitPrice * 100) / 100, note, checked: !!m.checked[id], overridden: { qty: qo != null, price: po != null }, source });
  };
  for (const c of cableLines) {
    const ct = cableById(c.cable);
    const pk = packsFor(ct, c.meters);
    const counts = new Map<number, number>();
    pk.packs.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
    const text = [...counts.entries()].map(([s, n]) => `${n}× ${s} m`).join(' + ');
    mk(c.id, 'Kabel und Leitungen', ct.label, 'm', c.meters, pk.total, text, CABLE_PRICE[c.cable] ?? 1.5, 'inkl. Reserven und Zuschlag');
  }
  for (const [id, v] of need) {
    const it = priceItem(id);
    if (!it) continue;
    const pack = it.pack ?? 1;
    const order = it.unit === 'Stk' || it.unit === 'Set' || it.unit === 'Tag' ? Math.ceil(Math.ceil(v.n) / pack) * pack : Math.ceil(v.n / pack) * pack;
    const text = pack > 1 ? `${Math.ceil(order / pack)}× ${pack} ${it.unit}` : `${r1(order)} ${it.unit}`;
    mk(id, it.group, it.label, it.unit, v.n, order, text, it.price, [it.note, ...v.note].filter(Boolean).join('; '));
  }
  for (const e of m.extras) mk(e.id, (GROUP_ORDER.includes(e.group as MaterialGroup) ? e.group : 'Eigene Positionen') as MaterialGroup, e.label, e.unit, e.qty, e.qty, `${e.qty} ${e.unit}`, e.price, e.note, 'manuell');

  const groups = GROUP_ORDER.map((g) => {
    const ls = lines.filter((l) => l.group === g).sort((a, b) => a.label.localeCompare(b.label, 'de'));
    return { group: g, lines: ls, total: Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100 };
  }).filter((g) => g.lines.length);
  const total = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const openTotal = Math.round(lines.filter((l) => !l.checked).reduce((s, l) => s + l.total, 0) * 100) / 100;
  return { lines: groups.flatMap((g) => g.lines), groups, total, openTotal };
}

export const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
