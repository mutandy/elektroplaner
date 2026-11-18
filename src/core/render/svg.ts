/** Kleine SVG-Hilfen (String-basiert, damit Browser und Node gleich rendern). */

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const n = (v: number) => (Math.round(v * 100) / 100).toString();

export type Attrs = Record<string, string | number | undefined | null | false>;

export function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${esc(typeof v === 'number' ? n(v) : v)}"`)
    .join(' ');
}

export const el = (tag: string, a: Attrs, inner = '') => (inner ? `<${tag} ${attrs(a)}>${inner}</${tag}>` : `<${tag} ${attrs(a)}/>`);

export const g = (a: Attrs, inner: string) => `<g ${attrs(a)}>${inner}</g>`;

export const title = (t: string) => `<title>${esc(t)}</title>`;

export function text(x: number, y: number, s: string, a: Attrs = {}) {
  return `<text ${attrs({ x, y, ...a })}>${esc(s)}</text>`;
}

/** Gemeinsames Stylesheet aller Pläne. Farben über CSS-Variablen (hell/dunkel). */
export const PLAN_STYLE = `
.ep{font-family:"Inter","Segoe UI",Arial,sans-serif}
.ep .bg{fill:var(--ep-bg,#fff)}
.ep .room{fill:var(--ep-room,#fff)}
.ep .wall{stroke:var(--ep-wall,#1f2328);fill:none;stroke-linejoin:miter}
.ep .wallfill{fill:var(--ep-wall,#1f2328)}
.ep .thin{stroke:var(--ep-ink,#1f2328);fill:none}
.ep .ink{fill:var(--ep-ink,#1f2328)}
.ep .muted{fill:var(--ep-muted,#5b636e)}
.ep .mutedline{stroke:var(--ep-muted,#5b636e);fill:none}
.ep .opening{fill:var(--ep-room,#fff);stroke:none}
.ep .door{stroke:var(--ep-ink,#1f2328);fill:none}
.ep .window{stroke:var(--ep-ink,#1f2328);fill:var(--ep-glass,#dbeafe)}
.ep .furn{fill:var(--ep-furn,#f3f4f6);stroke:var(--ep-furn-line,#9ca3af);stroke-dasharray:4 2}
.ep .obst{fill:url(#hatch);stroke:var(--ep-muted,#5b636e)}
.ep .prewall{fill:var(--ep-prewall,#fde68a);stroke:var(--ep-prewall-line,#b45309)}
.ep .zone-kamin{fill:url(#cross);stroke:var(--ep-err,#b91c1c)}
.ep .zone-brand{fill:none;stroke:var(--ep-err,#b91c1c);stroke-dasharray:6 3}
.ep .izone{fill:var(--ep-izone,#22c55e);opacity:.06}
.ep .ffb{stroke:var(--ep-muted,#5b636e);stroke-dasharray:6 3}
.ep .dim{stroke:var(--ep-dim,#2563eb);fill:none}
.ep .dimt{fill:var(--ep-dim,#2563eb)}
.ep .origin{stroke:var(--ep-err,#b91c1c);fill:none}
.ep .origint{fill:var(--ep-err,#b91c1c);font-weight:700}
.ep .o-230v{fill:var(--ep-230v,#dc2626);stroke:var(--ep-230v,#dc2626)}
.ep .o-daten{fill:var(--ep-daten,#2563eb);stroke:var(--ep-daten,#2563eb)}
.ep .o-licht{fill:var(--ep-licht,#d97706);stroke:var(--ep-licht,#d97706)}
.ep .o-bestand{fill:var(--ep-bestand,#6b7280);stroke:var(--ep-bestand,#6b7280)}
.ep .box{fill:var(--ep-room,#fff);stroke-width:var(--ep-boxw,1)}
.ep .sel .box,.ep .sel circle{stroke:var(--ep-sel,#7c3aed)!important}
.ep [data-outlet]{cursor:pointer}
.ep .lbl{font-weight:600}
.ep .slot{stroke:var(--ep-slot,#b45309);fill:none;stroke-linecap:butt}
.ep .slotfill{fill:var(--ep-slot,#b45309);fill-opacity:.35;stroke:var(--ep-slot,#b45309)}
.ep .slott{fill:var(--ep-slot,#b45309);font-weight:700}
.ep .cavity{stroke:var(--ep-slot,#b45309);fill:none;stroke-dasharray:3 2;opacity:.7}
.ep .ceil{stroke:var(--ep-ceil,#7c3aed);fill:none}
.ep .ceilt{fill:var(--ep-ceil,#7c3aed)}
.ep .ap{stroke:var(--ep-ap,#047857);fill:none}
.ep .apt{fill:var(--ep-ap,#047857)}
.ep .pen{fill:var(--ep-bg,#fff);stroke:var(--ep-slot,#b45309)}
.ep .pen.fire{stroke:var(--ep-err,#b91c1c)}
`;

export function defs(unit: number): string {
  const s = 6 * unit;
  return `<defs>
<pattern id="hatch" width="${n(s)}" height="${n(s)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${n(s)}" stroke="var(--ep-muted,#5b636e)" stroke-width="${n(unit * 0.5)}"/></pattern>
<pattern id="cross" width="${n(s)}" height="${n(s)}" patternUnits="userSpaceOnUse"><path d="M0 0L${n(s)} ${n(s)}M${n(s)} 0L0 ${n(s)}" stroke="var(--ep-err,#b91c1c)" stroke-width="${n(unit * 0.5)}"/></pattern>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ep-err,#b91c1c)"/></marker>
<marker id="tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M2 8L8 2" stroke="var(--ep-dim,#2563eb)" stroke-width="1.5"/></marker>
</defs>`;
}

/**
 * Maßstab für Druck: liefert SVG-Breite/-Höhe in mm.
 * `unit` = 1 mm Papier in cm Wirklichkeit (für Strichstärken/Schrift).
 */
export function scaleInfo(scale: number) {
  return { unit: scale / 10, mm: (cm: number) => (cm * 10) / scale };
}

export function pickScale(widthCm: number, heightCm: number, maxWmm: number, maxHmm: number, candidates = [20, 25, 50, 75, 100, 200]): number {
  for (const s of candidates) {
    if ((widthCm * 10) / s <= maxWmm && (heightCm * 10) / s <= maxHmm) return s;
  }
  return candidates[candidates.length - 1];
}
