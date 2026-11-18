/** Maßstäbliche Wandabwicklung (Blick von innen auf die Wand) als SVG-String. */
import type { Project, Room } from '../model/schema';
import { boxCenters, futureBuildup, wallGeoms, fmt, zToFfb } from '../geometry/room';
import { outletKindLabel } from '../model/labels';
import { normValue } from '../rules/normValues';
import { PLAN_STYLE, attrs, defs, el, g, n, scaleInfo, text, title } from './svg';
import { outletClass, outletLayer, outletTooltip, ALL_LAYERS, type Layer } from './plan';

export interface ElevationOptions {
  scale?: number;
  layers?: Layer[];
  selectedOutletId?: string;
  screen?: boolean;
}

/** Projektion eines Grundriss-Rechtecks auf eine Wand → s-Bereich. */
function projectRect(room: Room, wi: number, r: { x: number; y: number; w: number; d: number }) {
  const w = wallGeoms(room)[wi];
  const corners = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.d }, { x: r.x + r.w, y: r.y + r.d },
  ];
  const ss = corners.map((c) => (c.x - w.a.x) * w.dir.x + (c.y - w.a.y) * w.dir.y);
  return { from: Math.max(0, Math.min(...ss)), to: Math.min(w.length, Math.max(...ss)) };
}

export function renderElevation(project: Project, room: Room, wallIndex: number, opts: ElevationOptions = {}): string {
  const scale = opts.scale ?? 25;
  const { unit: u, mm } = scaleInfo(scale);
  const layers = new Set(opts.layers ?? ALL_LAYERS);
  const wg = wallGeoms(room)[wallIndex];
  const wall = room.walls[wallIndex];
  const L = wg.length;
  const H = room.height;
  const fb = futureBuildup(room);
  const Y = (z: number) => H - z;
  const outlets = room.outlets.filter((o) => o.mount === 'wand' && o.wallIndex === wallIndex);
  const doors = room.doors.filter((d) => d.wallIndex === wallIndex);
  const windows = room.windows.filter((w) => w.wallIndex === wallIndex);

  const padL = 26 * u;
  const padR = 16 * u;
  const padT = 13 * u;
  const dimRows = 2;
  const padB = (8 + dimRows * 12) * u;
  const vb = { x: -padL, y: -padT, w: L + padL + padR, h: H + padT + padB };
  const parts: string[] = [`<style>${PLAN_STYLE}</style>`, defs(u)];
  parts.push(el('rect', { x: vb.x, y: vb.y, width: vb.w, height: vb.h, class: 'bg' }));
  parts.push(el('rect', { x: 0, y: 0, width: L, height: H, class: 'room' }));

  // Installationszonen
  if (layers.has('zonen') && room.installationType === 'unterputz') {
    const z: string[] = [];
    const hf = (v: number) => v + fb;
    const ceilFfb = H - fb;
    const bands: [number, number][] = [
      [hf(normValue(project, 'zone.h.unten.von')), hf(normValue(project, 'zone.h.unten.bis'))],
      [hf(ceilFfb - normValue(project, 'zone.h.oben.bis')), hf(ceilFfb - normValue(project, 'zone.h.oben.von'))],
    ];
    if (/küche|kueche|bad|wc|werk/i.test(`${room.name} ${room.usage}`)) bands.push([hf(normValue(project, 'zone.h.mitte.von')), hf(normValue(project, 'zone.h.mitte.bis'))]);
    for (const [a, b] of bands) z.push(el('rect', { x: 0, y: Y(b), width: L, height: b - a, class: 'izone' }));
    const vFrom = normValue(project, 'zone.v.von');
    const vTo = normValue(project, 'zone.v.bis');
    const edges = [0, L, ...doors.flatMap((d) => [d.s, d.s + d.width]), ...windows.flatMap((w) => [w.s, w.s + w.width])];
    for (const e of edges) for (const sg of [-1, 1]) {
      const lo = Math.max(0, Math.min(e + sg * vFrom, e + sg * vTo));
      const hi = Math.min(L, Math.max(e + sg * vFrom, e + sg * vTo));
      if (hi - lo > 1) z.push(el('rect', { x: lo, y: 0, width: hi - lo, height: H, class: 'izone' }));
    }
    parts.push(g({ class: 'ly-zonen' }, title('Installationszonen DIN 18015-3 (Werte konfigurierbar, vom Elektriker zu bestätigen)') + z.join('')));
  }

  // Möbel und Hindernisse an dieser Wand
  if (layers.has('moebel')) {
    for (const f of room.furniture.filter((f) => f.wallIndex === wallIndex)) {
      const { from, to } = projectRect(room, wallIndex, f);
      if (to - from < 1) continue;
      const h = f.height || 80;
      parts.push(g({ class: 'ly-moebel' }, title(`${f.label || f.kind}, Höhe ${fmt(h)} cm`) + el('rect', { x: from, y: Y(h + fb), width: to - from, height: h, class: 'furn', 'stroke-width': 0.25 * u }) +
        g({ class: 'ly-beschriftung' }, text((from + to) / 2, Y(h + fb) + 3 * u, f.label || f.kind, { class: 'muted', 'font-size': 1.8 * u, 'text-anchor': 'middle' }))));
    }
  }
  for (const ob of room.obstacles.filter((o) => o.wallIndex === wallIndex)) {
    const { from, to } = projectRect(room, wallIndex, ob);
    const zTo = ob.zTo ?? H;
    parts.push(g({}, title(ob.label || ob.kind) + el('rect', { x: from, y: Y(zTo), width: to - from, height: zTo - ob.zFrom, class: 'obst', 'stroke-width': 0.25 * u })));
  }

  // Vorwände
  for (const pw of wall.preWall) {
    const top = pw.height ?? H;
    parts.push(g({}, [
      title(`Vorwand ${pw.label}: ${fmt(pw.from)}–${fmt(pw.to)} cm, Höhe ${pw.height == null ? 'raumhoch' : fmt(top) + ' cm'}`),
      el('rect', { x: pw.from, y: Y(top), width: pw.to - pw.from, height: top, class: 'prewall', 'stroke-width': 0.3 * u, 'fill-opacity': 0.55 }),
      text((pw.from + pw.to) / 2, Y(top) + 3 * u, `${pw.label || 'Vorwand'} · ${pw.height == null ? 'raumhoch' : fmt(top)}`, { class: 'muted', 'font-size': 1.9 * u, 'text-anchor': 'middle' }),
    ].join('')));
  }
  // Tabuzonen
  for (const zn of wall.zones) {
    const zTo = zn.zTo ?? H;
    parts.push(g({}, title(`${zn.kind} – nicht schlitzen/bohren`) + el('rect', { x: zn.from, y: Y(zTo), width: zn.to - zn.from, height: zTo - zn.zFrom, class: zn.kind === 'brandwand' ? 'zone-brand' : 'zone-kamin', 'stroke-width': 0.3 * u, 'fill-opacity': 0.5 }) +
      text((zn.from + zn.to) / 2, Y(zTo) + 4 * u, zn.kind === 'kaminwange' ? 'Kaminwange' : zn.kind, { class: 'origint', 'font-size': 1.9 * u, 'text-anchor': 'middle' })));
  }

  // Türen/Fenster
  for (const d of doors) {
    parts.push(g({}, [
      title(`Tür ${d.width} × ${d.height}, Bänder ${d.hinge}, öffnet nach ${d.swing}${d.fireRating !== 'keine' ? ', ' + d.fireRating : ''}`),
      el('rect', { x: d.s, y: Y(d.height), width: d.width, height: d.height, class: 'thin', 'stroke-width': 0.4 * u, style: 'fill:var(--ep-bg,#fff)' }),
      // Öffnungssymbol: Spitze zeigt zur Bandseite
      el('path', { d: d.hinge === 'links' ? `M${n(d.s + d.width)} ${n(Y(d.height))}L${n(d.s)} ${n(Y(d.height / 2))}L${n(d.s + d.width)} ${n(Y(0))}` : `M${n(d.s)} ${n(Y(d.height))}L${n(d.s + d.width)} ${n(Y(d.height / 2))}L${n(d.s)} ${n(Y(0))}`, class: 'mutedline', 'stroke-width': 0.25 * u, 'stroke-dasharray': `${n(u)} ${n(u)}` }),
      text(d.s + d.width / 2, Y(d.height) + 3 * u, `Tür ${fmt(d.width)}${d.fireRating !== 'keine' ? ' ' + d.fireRating : ''}`, { class: 'muted', 'font-size': 1.9 * u, 'text-anchor': 'middle' }),
    ].join('')));
  }
  for (const w of windows) {
    parts.push(g({}, [
      title(`Fenster ${w.width} × ${w.height}, Brüstung ${w.sill}`),
      el('rect', { x: w.s, y: Y(w.sill + w.height), width: w.width, height: w.height, class: 'window', 'stroke-width': 0.4 * u }),
      text(w.s + w.width / 2, Y(w.sill) - 1.5 * u, `Fenster BRH ${fmt(w.sill)}`, { class: 'muted', 'font-size': 1.7 * u, 'text-anchor': 'middle' }),
    ].join('')));
  }

  // Wand, Boden, Decke
  parts.push(el('rect', { x: 0, y: 0, width: L, height: H, class: 'thin', 'stroke-width': 0.6 * u }));
  if (fb > 0) parts.push(el('line', { x1: 0, y1: Y(fb), x2: L, y2: Y(fb), class: 'ffb', 'stroke-width': 0.3 * u }));
  parts.push(text(-1.5 * u, Y(0), `±0 ${project.settings.heightReference.label}`, { class: 'muted', 'font-size': 1.7 * u, 'text-anchor': 'end', 'dominant-baseline': 'central' }));
  if (fb > 0) parts.push(text(-1.5 * u, Y(fb) - 2.2 * u, `FFB +${fmt(fb)}`, { class: 'muted', 'font-size': 1.7 * u, 'text-anchor': 'end', 'dominant-baseline': 'central' }));
  parts.push(text(-1.5 * u, Y(H), `Decke ${fmt(H)}`, { class: 'muted', 'font-size': 1.7 * u, 'text-anchor': 'end', 'dominant-baseline': 'central' }));

  // Kopfzeile: Blickrichtung und Ecken
  const nCorners = room.polygon.length;
  parts.push(text(0, -2 * u, `◀ links: Ecke ${wallIndex + 1} (Maßbezug)`, { class: 'origint', 'font-size': 2 * u }));
  parts.push(text(L, -2 * u, `rechts: Ecke ${((wallIndex + 1) % nCorners) + 1} ▶`, { class: 'origint', 'font-size': 2 * u, 'text-anchor': 'end' }));
  parts.push(text(L / 2, -8 * u, `Wand ${wallIndex + 1}${wall.label ? ' – ' + wall.label : ''} · Blick von innen · Länge ${fmt(L)} cm`, { class: 'ink', 'font-size': 2.4 * u, 'font-weight': 700, 'text-anchor': 'middle' }));

  // Dosen
  const boxR = project.settings.boxDrill / 2;
  const dimS = new Set<number>();
  for (const o of outlets) {
    if (!layers.has(outletLayer(o))) continue;
    const cls = outletClass(o);
    const cs = boxCenters(o, project.settings);
    cs.forEach((c) => dimS.add(c.s));
    const frames = cs.map((c) => el('rect', { x: c.s - 4, y: Y(c.z) - 4, width: 8, height: 8, class: `box ${cls}`, 'stroke-width': 0.3 * u, 'fill-opacity': 0.15 }) +
      el('circle', { cx: c.s, cy: Y(c.z), r: boxR, class: `box ${cls}`, 'stroke-width': 0.35 * u, 'stroke-dasharray': o.status !== 'neu' || o.boxType === 'aufputz' || o.boxType === 'aufputz_holz' ? `${n(0.8 * u)} ${n(0.5 * u)}` : undefined }) +
      el('circle', { cx: c.s, cy: Y(c.z), r: 0.5 * u, class: cls }));
    const top = Math.max(...cs.map((c) => c.z)) + 4;
    const sMid = cs.reduce((a, c) => a + c.s, 0) / cs.length;
    const zLabel = cs.length > 1 && o.orientation === 'senkrecht' ? cs.map((c) => fmt(c.z)).join('/') : fmt(o.z);
    parts.push(g({ 'data-outlet': o.id, class: `ly-${outletLayer(o)}${o.id === opts.selectedOutletId ? ' sel' : ''}` }, [
      title(outletTooltip(project, room, o)),
      ...frames,
      g({ class: 'ly-beschriftung' }, [
        text(sMid, Y(top) - 1.2 * u, o.label, { class: `lbl ${cls}`, 'font-size': 2.2 * u, 'text-anchor': 'middle', style: 'stroke:none' }),
        text(Math.max(...cs.map((c) => c.s)) + 5.5, Y(o.z!), `h ${zLabel}`, { class: 'dimt', 'font-size': 1.7 * u, 'dominant-baseline': 'central' }),
        text(Math.max(...cs.map((c) => c.s)) + 5.5, Y(o.z!) + 2.2 * u, `(${fmt(zToFfb(room, o.z!))} FFB)`, { class: 'muted', 'font-size': 1.4 * u, 'dominant-baseline': 'central' }),
      ].join('')),
    ].join('')));
  }

  // Maßketten ab linker Ecke
  if (layers.has('masse')) {
    const row = (i: number) => H + (8 + i * 12) * u;
    const chain = (values: number[], i: number, label: string) => {
      const vals = [...new Set(values.map((v) => Math.round(v * 10) / 10))].sort((a, b) => a - b);
      const y = row(i);
      const out = [el('line', { x1: 0, y1: y, x2: L, y2: y, class: 'dim', 'stroke-width': 0.2 * u })];
      out.push(text(-1.5 * u, y, label, { class: 'dimt', 'font-size': 1.6 * u, 'text-anchor': 'end', 'dominant-baseline': 'central' }));
      for (const v of [0, ...vals, L]) {
        out.push(el('line', { x1: v, y1: y - 1.2 * u, x2: v, y2: y + 1.2 * u, class: 'dim', 'stroke-width': 0.3 * u }));
        if (v > 0 && v < L) out.push(el('line', { x1: v, y1: H, x2: v, y2: y, class: 'dim', 'stroke-width': 0.1 * u, 'stroke-dasharray': `${n(0.5 * u)} ${n(0.5 * u)}` }));
      }
      // Dicht beieinanderliegende Maße versetzt nach unten schreiben
      let lastX = -Infinity;
      let stagger = 0;
      for (const v of vals) {
        stagger = v - lastX < 2 * u ? (stagger + 1) % 3 : 0;
        lastX = v;
        const ty = y + 1.6 * u;
        out.push(text(v, ty, fmt(v), { class: 'dimt', 'font-size': 1.6 * u, 'text-anchor': 'end', 'dominant-baseline': 'central', transform: `rotate(-90 ${n(v)} ${n(ty)})`, dx: -stagger * 3.5 * u }));
      }
      return out.join('');
    };
    const openingVals = [...doors.flatMap((d) => [d.s, d.s + d.width]), ...windows.flatMap((w) => [w.s, w.s + w.width]), ...wall.preWall.flatMap((p) => [p.from, p.to]), ...wall.zones.flatMap((z) => [z.from, z.to])].filter((v) => v > 0.05 && v < L - 0.05);
    parts.push(g({ class: 'ly-masse' }, chain([...dimS], 0, 'Dosen') + chain(openingVals, 1, 'Öffn./VW')));
  }

  const size = opts.screen ? '' : attrs({ width: `${n(mm(vb.w))}mm`, height: `${n(mm(vb.h))}mm` });
  const layerCss = ALL_LAYERS.filter((l) => !layers.has(l)).map((l) => `.ly-${l}{display:none}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ep" ${size} viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" data-scale="${scale}" data-wall="${wallIndex}">${layerCss ? `<style>${layerCss}</style>` : ''}${parts.join('')}</svg>`;
}

export function elevationLegendText(): string {
  return `Maße in cm. Abstände ab linker Wandecke beim Blick von innen auf die Wand. Höhen = Dosenmitte über Bezug; in Klammern über Fertigfußboden (FFB).`;
}

export { outletKindLabel };
