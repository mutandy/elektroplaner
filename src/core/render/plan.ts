/** Draufsicht eines Raums (und Gesamtansicht eines Geschosses) als SVG-String. */
import type { Outlet, Project, Room } from '../model/schema';
import { bbox, boxCenters, pointOnWall, wallGeoms, fmt, roomArea, type Pt } from '../geometry/room';
import { outletKindLabel, outletKindShort, boxTypeLabel } from '../model/labels';
import { PLAN_STYLE, attrs, defs, el, esc, g, n, scaleInfo, text, title } from './svg';
import { computeRoomRoutes, type RoomRoutes } from '../planning/routes';

export type Layer = 'moebel' | '230v' | 'daten' | 'licht' | 'beschriftung' | 'masse' | 'zonen' | 'trassen';
export const ALL_LAYERS: Layer[] = ['moebel', '230v', 'daten', 'licht', 'beschriftung', 'masse', 'zonen', 'trassen'];
export const layerLabel: Record<Layer, string> = {
  moebel: 'Möbel', '230v': '230 V', daten: 'LAN/Audio', licht: 'Licht/Decke', beschriftung: 'Beschriftung', masse: 'Maße', zonen: 'Installationszonen', trassen: 'Leitungswege',
};

export function outletLayer(o: Outlet): '230v' | 'daten' | 'licht' {
  if (['lan', 'tv_sat', 'lautsprecher', 'klingel'].includes(o.kind)) return 'daten';
  if (['licht_decke', 'licht_wand', 'rauchwarnmelder'].includes(o.kind) || o.mount === 'decke' && o.kind !== 'steckdose') return 'licht';
  return '230v';
}

export function outletClass(o: Outlet): string {
  if (o.status !== 'neu') return 'o-bestand';
  return `o-${outletLayer(o)}`;
}

export function outletTooltip(project: Project, room: Room, o: Outlet): string {
  const c = project.circuits.find((c) => c.id === o.circuitId);
  const parts = [`${o.label}: ${outletKindLabel[o.kind]}${o.gangs > 1 ? ` ${o.gangs}-fach` : ''}`];
  if (o.mount === 'wand') parts.push(`Wand ${(o.wallIndex ?? 0) + 1}, ${fmt(o.s)} cm ab linker Ecke, Höhe ${fmt(o.z)} cm über ${project.settings.heightReference.label}`);
  else parts.push(`${o.mount === 'decke' ? 'Decke' : 'Boden'} x=${fmt(o.x)} / y=${fmt(o.y)} cm ab Nullpunkt`);
  parts.push(`Dose: ${boxTypeLabel[o.boxType]}`);
  if (c) parts.push(`Stromkreis ${c.label} (${c.name})`);
  if (o.note) parts.push(o.note);
  return parts.join('\n');
}

export interface PlanOptions {
  scale?: number; // für Druckgröße (Standard 1:50)
  layers?: Layer[];
  selectedOutletId?: string;
  /** Feste Breite in px statt mm (Bildschirm). */
  screen?: boolean;
  /** Vorberechnete Leitungswege (sonst werden sie berechnet, wenn die Ebene an ist). */
  routes?: RoomRoutes;
}

/** Leitungswege in der Draufsicht. */
export function routesSvg(room: Room, rr: RoomRoutes, u: number): string {
  const parts: string[] = [];
  for (const f of rr.floorSlots) {
    const w = Math.max(f.width / 10, 1.2 * u);
    parts.push(g({}, [
      title(`${f.id}: Bodenschlitz ${f.inCavity ? '(im Vorwand-Hohlraum – kein Schlitz) ' : ''}entlang Wand ${f.wallIndex + 1}, ${fmt(f.length)} cm, ${f.width}×${f.depth} mm, Kabel: ${f.cables.join(', ')}`),
      el('line', { x1: f.from.x, y1: f.from.y, x2: f.to.x, y2: f.to.y, class: f.inCavity ? 'cavity' : 'slot', 'stroke-width': f.inCavity ? 0.4 * u : w, 'stroke-opacity': f.inCavity ? 1 : 0.55 }),
      f.inCavity || f.length < 25 * u ? '' : g({ class: 'ly-beschriftung' }, text((f.from.x + f.to.x) / 2, (f.from.y + f.to.y) / 2, f.id, { class: 'slott', 'font-size': 1.7 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'paint-order:stroke;stroke:var(--ep-room,#fff);stroke-width:' + n(0.6 * u) })),
    ].join('')));
  }
  for (const c of rr.ceilingRuns) {
    parts.push(g({}, title(`${c.id}: ${c.slot ? 'Deckenschlitz' : 'im Deckenhohlraum'} zu ${c.cables.join(', ')} (${fmt(c.length)} cm)`) +
      el('path', { d: `M${n(c.from.x)} ${n(c.from.y)}L${n(c.to.x)} ${n(c.from.y)}L${n(c.to.x)} ${n(c.to.y)}`, class: 'ceil', 'stroke-width': 0.4 * u, 'stroke-dasharray': `${n(1.5 * u)} ${n(u)}` })));
  }
  for (const a of rr.surfaceRuns) {
    if (a.kind === 'stich') continue;
    const d = a.kind === 'decke' ? `M${n(a.from.x)} ${n(a.from.y)}L${n(a.to.x)} ${n(a.from.y)}L${n(a.to.x)} ${n(a.to.y)}` : `M${n(a.from.x)} ${n(a.from.y)}L${n(a.to.x)} ${n(a.to.y)}`;
    parts.push(g({}, title(`${a.id}: Aufputz ${a.kind === 'decke' ? 'an der Decke' : `Trasse bei ${fmt(a.z)} cm`} – ${a.cables.join(', ')}`) + el('path', { d, class: 'ap', 'stroke-width': 0.8 * u })));
  }
  for (const w of rr.wallSlots.filter((x) => x.orientation === 'senkrecht')) {
    const p = pointOnWall(room, w.wallIndex, w.s, 0.6 * u);
    parts.push(g({}, title(`${w.id}: senkrechter Wandschlitz Wand ${w.wallIndex + 1} bei ${fmt(w.s)} cm, Höhe ${fmt(w.zFrom)}–${fmt(w.zTo)}, ${w.width}×${w.depth} mm`) + el('rect', { x: p.x - 0.9 * u, y: p.y - 0.9 * u, width: 1.8 * u, height: 1.8 * u, class: 'slotfill', 'stroke-width': 0.25 * u })));
  }
  for (const pe of rr.penetrations) {
    const p = pointOnWall(room, pe.wallIndex, pe.s, -2 * u);
    parts.push(g({}, title(`Durchbruch Ø ${pe.diameter} mm bei ${fmt(pe.s)} cm, Höhe ${fmt(pe.z)} – ${pe.note}`) + el('circle', { cx: p.x, cy: p.y, r: 1.6 * u, class: `pen ${pe.fireStop ? 'fire' : ''}`, 'stroke-width': 0.5 * u }) +
      el('path', { d: `M${n(p.x - u)} ${n(p.y - u)}L${n(p.x + u)} ${n(p.y + u)}M${n(p.x + u)} ${n(p.y - u)}L${n(p.x - u)} ${n(p.y + u)}`, class: `pen ${pe.fireStop ? 'fire' : ''}`, 'stroke-width': 0.35 * u })));
  }
  return g({ class: 'ly-trassen' }, parts.join(''));
}

/** Tür als Plan-Elemente: Öffnung, Blatt, Aufschlagbogen. */
function doorSvg(room: Room, d: Room['doors'][number], wallT: number, u: number): string {
  const w = wallGeoms(room)[d.wallIndex];
  if (!w) return '';
  const p1 = pointOnWall(room, d.wallIndex, d.s);
  const p2 = pointOnWall(room, d.wallIndex, d.s + d.width);
  const out = { x: -w.normal.x * wallT, y: -w.normal.y * wallT };
  const gap = `M${n(p1.x + w.normal.x * 0.5)} ${n(p1.y + w.normal.y * 0.5)}L${n(p2.x + w.normal.x * 0.5)} ${n(p2.y + w.normal.y * 0.5)}L${n(p2.x + out.x * 1.05)} ${n(p2.y + out.y * 1.05)}L${n(p1.x + out.x * 1.05)} ${n(p1.y + out.y * 1.05)}Z`;
  const hingeP = d.hinge === 'links' ? p1 : p2;
  const otherP = d.hinge === 'links' ? p2 : p1;
  const side = d.swing === 'innen' ? 1 : -1;
  const base = d.swing === 'innen' ? hingeP : { x: hingeP.x + out.x, y: hingeP.y + out.y };
  const baseOther = d.swing === 'innen' ? otherP : { x: otherP.x + out.x, y: otherP.y + out.y };
  const leafEnd = { x: base.x + w.normal.x * side * d.width, y: base.y + w.normal.y * side * d.width };
  // Bogen von geschlossen (otherP) nach offen (leafEnd)
  const cross = (w.dir.x * w.normal.y - w.dir.y * w.normal.x) * side * (d.hinge === 'links' ? 1 : -1);
  const sweep = cross > 0 ? 1 : 0;
  const fire = d.fireRating !== 'keine' ? text((p1.x + p2.x) / 2 + out.x * 2.2, (p1.y + p2.y) / 2 + out.y * 2.2, d.fireRating, { class: 'origint', 'font-size': 2.4 * u, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }) : '';
  return g({ class: 'door-g' }, [
    title(`Tür ${d.width} × ${d.height} cm, Bänder ${d.hinge}, öffnet nach ${d.swing}${d.fireRating !== 'keine' ? `, ${d.fireRating}` : ''}${d.provenance === 'annahme' ? ' (Annahme)' : ''}`),
    el('path', { d: gap, class: 'opening' }),
    el('line', { x1: base.x, y1: base.y, x2: leafEnd.x, y2: leafEnd.y, class: 'door', 'stroke-width': 0.5 * u }),
    el('path', { d: `M${n(baseOther.x)} ${n(baseOther.y)}A${n(d.width)} ${n(d.width)} 0 0 ${sweep} ${n(leafEnd.x)} ${n(leafEnd.y)}`, class: 'door', 'stroke-width': 0.25 * u, 'stroke-dasharray': `${n(1.5 * u)} ${n(1 * u)}` }),
    fire,
  ].join(''));
}

function windowSvg(room: Room, win: Room['windows'][number], wallT: number, u: number): string {
  const w = wallGeoms(room)[win.wallIndex];
  if (!w) return '';
  const p1 = pointOnWall(room, win.wallIndex, win.s);
  const p2 = pointOnWall(room, win.wallIndex, win.s + win.width);
  const out = { x: -w.normal.x * wallT, y: -w.normal.y * wallT };
  const poly = [p1, p2, { x: p2.x + out.x, y: p2.y + out.y }, { x: p1.x + out.x, y: p1.y + out.y }];
  const mid1 = { x: p1.x + out.x / 2, y: p1.y + out.y / 2 };
  const mid2 = { x: p2.x + out.x / 2, y: p2.y + out.y / 2 };
  return g({}, [
    title(`Fenster ${win.width} cm, Brüstung ${win.sill} cm, ${win.status.replace(/_/g, ' ')}${win.lightWell ? ', Lichtschacht' : ''}`),
    el('path', { d: `M${poly.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`, class: 'window', 'stroke-width': 0.25 * u, 'stroke-dasharray': win.status === 'wird_zugemauert' ? `${n(u)} ${n(u)}` : undefined }),
    el('line', { x1: mid1.x, y1: mid1.y, x2: mid2.x, y2: mid2.y, class: 'thin', 'stroke-width': 0.25 * u }),
  ].join(''));
}

/** Band entlang einer Wand (Vorwand, Zone) als Polygon. */
function wallBand(room: Room, wi: number, from: number, to: number, depth: number): Pt[] {
  return [pointOnWall(room, wi, from), pointOnWall(room, wi, to), pointOnWall(room, wi, to, depth), pointOnWall(room, wi, from, depth)];
}
const pathOf = (pts: Pt[]) => `M${pts.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`;

function outletMarker(project: Project, room: Room, o: Outlet, u: number, selected: boolean): string {
  const cls = outletClass(o);
  const r = 2.2 * u;
  const tip = title(outletTooltip(project, room, o));
  const fs = 2.2 * u;
  if (o.mount === 'wand') {
    if (o.wallIndex == null || o.s == null) return '';
    const centers = boxCenters(o, project.settings);
    const ss = o.orientation === 'waagerecht' ? centers.map((c) => c.s) : [o.s];
    const marks = ss.map((s) => {
      const p = pointOnWall(room, o.wallIndex!, s, r + 0.6 * u);
      return el('circle', { cx: p.x, cy: p.y, r, class: `box ${cls}`, 'stroke-width': 0.35 * u, 'stroke-dasharray': o.status !== 'neu' ? `${n(0.8 * u)} ${n(0.5 * u)}` : undefined });
    });
    const mid = ss.reduce((a, b) => a + b, 0) / ss.length;
    const pl = pointOnWall(room, o.wallIndex, mid, 2 * r + 3.2 * u);
    const sym = pointOnWall(room, o.wallIndex, ss[0], r + 0.6 * u);
    const mult = o.orientation === 'senkrecht' && o.gangs > 1 ? `×${o.gangs}` : '';
    return g({ 'data-outlet': o.id, class: `ly-${outletLayer(o)}${selected ? ' sel' : ''}` }, [
      tip,
      ...marks,
      text(sym.x, sym.y, outletKindShort[o.kind].slice(0, 2), { class: cls.replace('o-', 'o-') + ' ink', 'font-size': 1.5 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'stroke:none' }),
      g({ class: 'ly-beschriftung' }, text(pl.x, pl.y, o.label + mult, { class: `lbl ${cls}`, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', style: 'stroke:none' })),
    ].join(''));
  }
  if (o.x == null || o.y == null) return '';
  const isLight = o.kind === 'licht_decke';
  const shape = isLight
    ? el('circle', { cx: o.x, cy: o.y, r: r * 1.3, class: `box ${cls}`, 'stroke-width': 0.35 * u }) +
      el('path', { d: `M${n(o.x - r * 0.9)} ${n(o.y - r * 0.9)}L${n(o.x + r * 0.9)} ${n(o.y + r * 0.9)}M${n(o.x + r * 0.9)} ${n(o.y - r * 0.9)}L${n(o.x - r * 0.9)} ${n(o.y + r * 0.9)}`, class: cls, 'stroke-width': 0.35 * u })
    : el('rect', { x: o.x - r, y: o.y - r, width: 2 * r, height: 2 * r, class: `box ${cls}`, 'stroke-width': 0.35 * u, 'stroke-dasharray': o.status !== 'neu' ? `${n(0.8 * u)} ${n(0.5 * u)}` : undefined }) +
      text(o.x, o.y, outletKindShort[o.kind].slice(0, 3), { class: 'ink', 'font-size': 1.3 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  return g({ 'data-outlet': o.id, class: `ly-${outletLayer(o)}${selected ? ' sel' : ''}` }, [
    tip,
    shape,
    g({ class: 'ly-beschriftung' }, text(o.x + r * 1.6, o.y - r * 1.4, o.label, { class: `lbl ${cls}`, 'font-size': fs, style: 'stroke:none' })),
  ].join(''));
}

/** Nullpunkt-Markierung: Pfeile entlang der ersten Wand (s-Richtung) und der y-Achse. */
export function originMarker(room: Room, u: number): string {
  const w = wallGeoms(room);
  const w0 = w[0];
  const wl = w[w.length - 1];
  const o = room.polygon[0];
  const L = 12 * u;
  const a1 = { x: o.x + w0.dir.x * L + w0.normal.x * 2 * u, y: o.y + w0.dir.y * L + w0.normal.y * 2 * u };
  const back = { x: -wl.dir.x, y: -wl.dir.y };
  const a2 = { x: o.x + back.x * L + w0.normal.x * 0, y: o.y + back.y * L };
  const s = { x: o.x + w0.normal.x * 2 * u - back.x * 0, y: o.y + w0.normal.y * 2 * u };
  return g({ class: 'origin-g' }, [
    title('Nullpunkt des Raums (Ecke 1). Alle x/y-Maße im Raum ab hier. Wand-Maße jeweils ab linker Ecke beim Blick auf die Wand von innen.'),
    el('circle', { cx: o.x, cy: o.y, r: 1.8 * u, class: 'origin', 'stroke-width': 0.5 * u }),
    el('line', { x1: s.x, y1: s.y, x2: a1.x, y2: a1.y, class: 'origin', 'stroke-width': 0.5 * u, 'marker-end': 'url(#arr)' }),
    el('line', { x1: o.x + w0.normal.x * 2 * u + back.x * 2 * u, y1: o.y + w0.normal.y * 2 * u + back.y * 2 * u, x2: a2.x + w0.normal.x * 2 * u, y2: a2.y + w0.normal.y * 2 * u, class: 'origin', 'stroke-width': 0.5 * u, 'marker-end': 'url(#arr)' }),
    text(a1.x + w0.dir.x * 2 * u, a1.y + w0.dir.y * 2 * u + w0.normal.y * 1.5 * u + w0.normal.x * 0, 'x', { class: 'origint', 'font-size': 2.4 * u, 'dominant-baseline': 'central' }),
    text(a2.x + w0.normal.x * 4 * u + back.x * 2 * u, a2.y + w0.normal.y * 4 * u + back.y * 2 * u, 'y', { class: 'origint', 'font-size': 2.4 * u, 'dominant-baseline': 'central', 'text-anchor': 'middle' }),
    text(o.x - w0.normal.x * 5 * u - w0.dir.x * 4 * u, o.y - w0.normal.y * 5 * u - w0.dir.y * 4 * u, '0', { class: 'origint', 'font-size': 2.8 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' }),
  ].join(''));
}

export function renderRoomPlan(project: Project, room: Room, opts: PlanOptions = {}): string {
  const scale = opts.scale ?? 50;
  const { unit: u, mm } = scaleInfo(scale);
  const layers = new Set(opts.layers ?? ALL_LAYERS);
  const wallT = 4 * u; // dargestellte Wanddicke
  const bb = bbox(room.polygon);
  const pad = 22 * u;
  const vb = { x: bb.minX - pad, y: bb.minY - pad, w: bb.maxX - bb.minX + 2 * pad, h: bb.maxY - bb.minY + 2 * pad };
  const walls = wallGeoms(room);
  const poly = pathOf(room.polygon);
  const parts: string[] = [];
  parts.push(`<style>${PLAN_STYLE}</style>`, defs(u));
  parts.push(el('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, class: 'bg' }));
  // Wände: dicker Strich, Innenseite durch Raumfläche überdeckt
  parts.push(el('path', { d: poly, class: 'wall', 'stroke-width': 2 * wallT }));
  parts.push(el('path', { d: poly, class: 'room' }));
  parts.push(el('path', { d: poly, class: 'thin', 'stroke-width': 0.35 * u }));

  // Installationszonen (senkrecht, als Band an der Wand)
  if (layers.has('zonen')) {
    const zs: string[] = [];
    for (const w of walls) {
      const edges = [0, w.length];
      room.doors.filter((d) => d.wallIndex === w.index).forEach((d) => edges.push(d.s, d.s + d.width));
      room.windows.filter((x) => x.wallIndex === w.index).forEach((x) => edges.push(x.s, x.s + x.width));
      for (const e of edges) {
        for (const sign of [-1, 1]) {
          const a = e + sign * 10;
          const b = e + sign * 30;
          const lo = Math.max(0, Math.min(a, b));
          const hi = Math.min(w.length, Math.max(a, b));
          if (hi - lo > 1) zs.push(el('path', { d: pathOf(wallBand(room, w.index, lo, hi, 2 * u)), class: 'izone' }));
        }
      }
    }
    parts.push(g({ class: 'ly-zonen' }, title('Senkrechte Installationszonen DIN 18015-3 (10–30 cm neben Ecken/Öffnungen)') + zs.join('')));
  }

  // Vorwände und Wandzonen
  for (const w of room.walls) {
    for (const pw of w.preWall) {
      const pts = wallBand(room, w.index, pw.from, pw.to, pw.depth);
      const c = pointOnWall(room, w.index, (pw.from + pw.to) / 2, pw.depth / 2);
      parts.push(g({}, [
        title(`Vorwand ${pw.label}: ${fmt(pw.from)}–${fmt(pw.to)} cm, Höhe ${pw.height == null ? 'raumhoch' : fmt(pw.height) + ' cm'}, Tiefe ${fmt(pw.depth)} cm`),
        el('path', { d: pathOf(pts), class: 'prewall', 'stroke-width': 0.25 * u }),
        g({ class: 'ly-beschriftung' }, text(c.x, c.y, `VW ${pw.height == null ? 'rh' : fmt(pw.height)}`, { class: 'muted', 'font-size': 1.8 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' })),
      ].join('')));
    }
    for (const zn of w.zones) {
      const pts = wallBand(room, w.index, zn.from, zn.to, Math.max(zn.depth, 2.5 * u));
      parts.push(g({}, title(`${zn.kind}: ${fmt(zn.from)}–${fmt(zn.to)} cm – nicht schlitzen/bohren`) + el('path', { d: pathOf(pts), class: zn.kind === 'brandwand' ? 'zone-brand' : 'zone-kamin', 'stroke-width': 0.3 * u })));
    }
  }

  // Hindernisse
  for (const ob of room.obstacles) {
    parts.push(g({ class: 'ly-moebel' }, [
      title(`${ob.label || ob.kind} (${fmt(ob.zFrom)}–${ob.zTo == null ? 'Decke' : fmt(ob.zTo)} cm Höhe) – Bereich freihalten`),
      el('rect', { x: ob.x, y: ob.y, width: ob.w, height: ob.d, class: 'obst', 'stroke-width': 0.25 * u, 'fill-opacity': 0.6 }),
      g({ class: 'ly-beschriftung' }, text(ob.x + ob.w / 2, ob.y + ob.d / 2, ob.label || ob.kind, { class: 'muted', 'font-size': 1.8 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' })),
    ].join('')));
  }

  // Möbel
  if (layers.has('moebel')) {
    const fs = room.furniture.map((f) => g({}, [
      title(`${f.label || f.kind}: ${fmt(f.w)} × ${fmt(f.d)} cm${f.height ? `, Höhe ${fmt(f.height)} cm` : ''}`),
      el('rect', { x: f.x, y: f.y, width: f.w, height: f.d, class: 'furn', 'stroke-width': 0.25 * u }),
      g({ class: 'ly-beschriftung' }, text(f.x + f.w / 2, f.y + f.d / 2, f.label || f.kind, { class: 'muted', 'font-size': 1.8 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central' })),
    ].join('')));
    parts.push(g({ class: 'ly-moebel' }, fs.join('')));
  }

  // Öffnungen
  for (const win of room.windows) parts.push(windowSvg(room, win, wallT, u));
  for (const d of room.doors) parts.push(doorSvg(room, d, wallT, u));

  // Wandbeschriftung + Maße (außen)
  const wl: string[] = [];
  for (const w of walls) {
    const mid = pointOnWall(room, w.index, w.length / 2, -wallT - 4 * u);
    const ang = (Math.atan2(w.dir.y, w.dir.x) * 180) / Math.PI;
    const rot = ang > 90 || ang < -90 ? ang + 180 : ang;
    const midIn = pointOnWall(room, w.index, Math.min(w.length / 2, 18 * u), 4 * u);
    wl.push(g({ class: 'ly-masse' }, text(mid.x, mid.y, `${fmt(w.length)}`, { class: 'dimt', 'font-size': 2.2 * u, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${n(rot)} ${n(mid.x)} ${n(mid.y)})` })));
    // Wandnummer innen mit Richtungspfeil (s läuft von links nach rechts)
    const arrowFrom = pointOnWall(room, w.index, 4 * u, 1.2 * u);
    const arrowTo = pointOnWall(room, w.index, Math.min(14 * u, w.length * 0.4), 1.2 * u);
    wl.push(g({ class: 'ly-beschriftung' }, [
      title(`Wand ${w.index + 1}${room.walls[w.index]?.label ? ` (${room.walls[w.index].label})` : ''}: Maße ab dieser Ecke (links beim Blick auf die Wand)`),
      el('line', { x1: arrowFrom.x, y1: arrowFrom.y, x2: arrowTo.x, y2: arrowTo.y, class: 'mutedline', 'stroke-width': 0.3 * u, 'marker-end': 'url(#arr)' }),
      text(midIn.x + w.normal.x * 2 * u, midIn.y + w.normal.y * 2 * u, `W${w.index + 1}`, { class: 'muted', 'font-size': 2.2 * u, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'central', transform: `rotate(${n(rot)} ${n(midIn.x + w.normal.x * 2 * u)} ${n(midIn.y + w.normal.y * 2 * u)})` }),
    ].join('')));
  }
  parts.push(wl.join(''));

  // Leitungswege
  if (layers.has('trassen')) parts.push(routesSvg(room, opts.routes ?? computeRoomRoutes(project, room), u));

  // Auslässe
  const outs = room.outlets
    .filter((o) => layers.has(outletLayer(o)))
    .map((o) => outletMarker(project, room, o, u, o.id === opts.selectedOutletId));
  parts.push(outs.join(''));

  parts.push(originMarker(room, u));

  const layerCss = ALL_LAYERS.filter((l) => !layers.has(l)).map((l) => `.ly-${l}{display:none}`).join('');
  if (layerCss) parts.splice(1, 0, `<style>${layerCss}</style>`);

  const size = opts.screen ? {} : { width: `${n(mm(vb.w))}mm`, height: `${n(mm(vb.h))}mm` };
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ep" ${attrs(size)} viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" data-scale="${scale}">${parts.join('')}</svg>`;
}

/** Gesamtansicht eines Geschosses: alle Räume an ihrer Lage, mit Namen. */
export function renderFloorOverview(project: Project, floorId: string, opts: { scale?: number; screen?: boolean } = {}): string {
  const rooms = project.rooms.filter((r) => r.floorId === floorId);
  if (!rooms.length) return '';
  const scale = opts.scale ?? 100;
  const { unit: u, mm } = scaleInfo(scale);
  const all = rooms.flatMap((r) => r.polygon.map((p) => ({ x: p.x + r.originOnFloor.x, y: p.y + r.originOnFloor.y })));
  const bb = bbox(all);
  const pad = 15 * u;
  const vb = { x: bb.minX - pad, y: bb.minY - pad, w: bb.maxX - bb.minX + 2 * pad, h: bb.maxY - bb.minY + 2 * pad };
  const parts = [`<style>${PLAN_STYLE}</style>`, defs(u), el('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, class: 'bg' })];
  for (const r of rooms) {
    const pts = r.polygon.map((p) => ({ x: p.x + r.originOnFloor.x, y: p.y + r.originOnFloor.y }));
    const c = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    // Schrift an schmale Räume anpassen (≈ 0,58 × Schriftgröße je Zeichen)
    const rb = bbox(pts);
    const fit = (txt: string, max: number) => Math.min(max, ((rb.maxX - rb.minX) * 0.9) / (txt.length * 0.58));
    parts.push(g({ 'data-room': r.id }, [
      title(`${r.name}${r.formerName && r.formerName !== r.name ? ` (Bestand: ${r.formerName})` : ''} – ${fmt(roomArea(r), 2)} m²`),
      el('path', { d: pathOf(pts), class: 'wall', 'stroke-width': 3 * u }),
      el('path', { d: pathOf(pts), class: 'room', style: r.inScope ? undefined : 'opacity:.6' }),
      el('circle', { cx: pts[0].x, cy: pts[0].y, r: 1.5 * u, class: 'origin', 'stroke-width': 0.5 * u }),
      text(c.x, c.y - 1.8 * u, r.name, { class: 'ink', 'font-size': fit(r.name, 3 * u), 'font-weight': 700, 'text-anchor': 'middle' }),
      r.formerName && r.formerName !== r.name ? text(c.x, c.y + 2.2 * u, `Bestand: ${r.formerName}`, { class: 'muted', 'font-size': fit(`Bestand: ${r.formerName}`, 2.2 * u), 'text-anchor': 'middle' }) : '',
      text(c.x, c.y + 5.6 * u, `${fmt(roomArea(r), 1)} m²${r.inScope ? '' : ' · nicht geplant'}`, { class: 'muted', 'font-size': 2 * u, 'text-anchor': 'middle' }),
    ].join('')));
  }
  const size = opts.screen ? '' : `width="${n(mm(vb.w))}mm" height="${n(mm(vb.h))}mm"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ep" ${size} viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}">${parts.join('')}</svg>`;
}

export { esc };
