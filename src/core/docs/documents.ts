/**
 * Druckdokumente (A4 quer) als vollständiges HTML. Wird im Browser (Druckvorschau)
 * und in Node (Playwright → PDF) identisch verwendet.
 */
import type { Project, Room } from '../model/schema';
import { bbox, fmt, futureBuildup, roomArea, wallGeoms, floorPolygon } from '../geometry/room';
import { ceilingLabel, installationTypeLabel, projectTypeLabel, smartHomeLabel, wallMaterialLabel } from '../model/labels';
import { renderRoomPlan, renderFloorOverview, type Layer } from '../render/plan';
import { renderElevation, elevationLegendText } from '../render/elevation';
import { pickScale, esc } from '../render/svg';
import { runRules, severityLabel } from '../rules/rules';
import { NORM_VALUES } from '../rules/normValues';
import { boxTable, circuitTable, insertBom } from './tables';
import { effectiveSmart } from '../rules/rules';
import { computeLengths, cableTotals, describeDrop } from '../planning/circuits';
import { routeTotals, type RoomRoutes } from '../planning/routes';
import { boxTypeLabel } from '../model/labels';
import { wallName, zToFfb } from '../geometry/room';
import { computeMaterial, euro } from '../planning/bom';
import { estimateCosts } from '../planning/costs';
import { buildTasks, PHASES } from '../planning/tasks';
import { RULES } from '../rules/rules';
import { projectDemand, kw, circuitPower } from '../planning/loads';
import { capacityChecks, LAYING_LABEL } from '../rules/norms';
import { ROOM_TYPE_INFO } from '../model/roomTypes';
import { routingFeasibility, routeOptionLabel } from '../planning/feasibility';

export type DocumentKind = 'raumlayout' | 'ausfuehrung' | 'schlitzplan' | 'material' | 'kosten' | 'aufgaben' | 'pruefprotokoll';

export const documentLabel: Record<DocumentKind, string> = {
  raumlayout: 'Raumlayouts (Kontrolle Bauherr)',
  schlitzplan: 'Schlitzplan (Fräsen und Bohren)',
  material: 'Material- und Bestellliste',
  kosten: 'Kostenschätzung (Richtwert)',
  aufgaben: 'Aufgaben- und Prüfliste Bauphase',
  pruefprotokoll: 'Prüfprotokoll (Planung + Erstprüfung)',
  ausfuehrung: 'Ausführungsplan (Elektrofachkraft)',
};

export const DISCLAIMER =
  'Planungsunterlage – ersetzt keine Elektrofachkraft. Anschluss, Prüfung, Messung und Inbetriebnahme ausschließlich durch eine eingetragene Elektrofachkraft. Normwerte mit ⚠ sind vom Elektriker zu bestätigen.';

const PAGE_W = 297;
const PAGE_H = 210;
const BODY_W = PAGE_W - 20; // mm
const BODY_H = PAGE_H - 16 - 22; // mm (Rand, Kopf, Fuß)

const DOC_CSS = `
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#e5e7eb;color:#111827;font-family:"Inter","Segoe UI",Arial,sans-serif;font-size:8.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:${PAGE_W}mm;height:${PAGE_H}mm;padding:8mm 10mm;background:#fff;margin:6mm auto;display:flex;flex-direction:column;overflow:hidden;page-break-after:always;break-after:page;position:relative}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
@media screen{.page{box-shadow:0 1px 4px rgba(0,0,0,.25)}}
.hd{display:flex;justify-content:space-between;align-items:baseline;border-bottom:.4mm solid #111827;padding-bottom:1.5mm;margin-bottom:3mm}
.hd h1{font-size:13pt;margin:0}
.hd .meta{font-size:8pt;color:#4b5563;text-align:right}
.body{flex:1;min-height:0;display:flex;gap:6mm}
.col{display:flex;flex-direction:column;gap:3mm;min-width:0}
.ft{border-top:.2mm solid #9ca3af;padding-top:1.2mm;margin-top:2mm;display:flex;justify-content:space-between;gap:6mm;font-size:6.8pt;color:#4b5563}
.ft .warn{color:#991b1b;font-weight:600}
table{border-collapse:collapse;width:100%}
th,td{border:.15mm solid #d1d5db;padding:.8mm 1.2mm;text-align:left;vertical-align:top}
th{background:#f3f4f6;font-weight:600;font-size:7.5pt}
td{font-size:7.6pt}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
h2{font-size:10.5pt;margin:0 0 1.5mm}
h3{font-size:9pt;margin:2mm 0 1mm}
.small{font-size:7pt;color:#4b5563}
.sev-fehler{color:#b91c1c;font-weight:700}
.sev-warnung{color:#b45309;font-weight:700}
.sev-hinweis{color:#1d4ed8}
.kv{display:grid;grid-template-columns:auto 1fr;gap:.6mm 3mm}
.kv dt{color:#4b5563}
.kv dd{margin:0}
.legend{display:flex;flex-wrap:wrap;gap:2mm 5mm;font-size:7pt}
.legend span::before{content:"";display:inline-block;width:2.6mm;height:2.6mm;border-radius:50%;margin-right:1mm;vertical-align:-.4mm;border:.35mm solid currentColor}
.lg-230v{color:#dc2626}.lg-daten{color:#2563eb}.lg-licht{color:#d97706}.lg-bestand{color:#6b7280}
.planbox{display:flex;align-items:flex-start;justify-content:center;min-height:0}
.planbox svg{max-width:100%;max-height:100%}
.cover h1{font-size:22pt;margin:10mm 0 2mm}
.badge{display:inline-block;border:.3mm solid #991b1b;color:#991b1b;padding:1mm 2mm;border-radius:1mm;font-weight:600}
.confirm{color:#b45309}
.photos{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:4mm;flex:1;min-height:0;width:100%}
.photos figure{margin:0;display:flex;flex-direction:column;min-height:0}
.photos img{flex:1;min-height:0;object-fit:contain;border:.2mm solid #d1d5db}
.photos figcaption{font-size:7.5pt;padding-top:1mm}
`;

interface Page { title: string; subtitle?: string; body: string }

function wrapPages(project: Project, kind: DocumentKind, pages: Page[]): string {
  const date = new Date(project.updatedAt).toLocaleDateString('de-DE');
  const total = pages.length;
  const html = pages.map((p, i) => `
<section class="page">
  <div class="hd"><h1>${esc(p.title)}${p.subtitle ? ` <span class="small">${esc(p.subtitle)}</span>` : ''}</h1>
  <div class="meta">${esc(project.name)}<br>${esc(documentLabel[kind])} · Stand ${esc(date)}</div></div>
  <div class="body">${p.body}</div>
  <div class="ft"><span class="warn">⚡ ${esc(DISCLAIMER)}</span><span style="white-space:nowrap">Seite ${i + 1} / ${total}</span></div>
</section>`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(project.name)} – ${esc(documentLabel[kind])}</title><style>${DOC_CSS}</style></head><body>${html}</body></html>`;
}

const legendHtml = `<div class="legend"><span class="lg-230v">230 V</span><span class="lg-daten">LAN/Audio/TV</span><span class="lg-licht">Licht/Decke/RWM</span><span class="lg-bestand">Bestand (gestrichelt)</span><span style="color:#b91c1c">● Nullpunkt mit Achsen x/y</span><span style="color:#5b636e">W1…Wn: Wände, Pfeil = Messrichtung</span></div>`;

function planFor(project: Project, room: Room, maxW: number, maxH: number, layers?: Layer[]) {
  const bb = bbox(room.polygon);
  const scale = pickScale(bb.maxX - bb.minX + 60, bb.maxY - bb.minY + 60, maxW, maxH, [25, 50, 75, 100]);
  return { svg: renderRoomPlan(project, room, { scale, layers }), scale };
}

function roomTitle(room: Room) {
  return room.formerName && room.formerName !== room.name ? `${room.name}` : room.name;
}
function roomSubtitle(room: Room) {
  return room.formerName && room.formerName !== room.name ? `(Bestandsplan: ${room.formerName})` : '';
}

function boxTableHtml(project: Project, room: Room, rows = boxTable(project, room), full = true): string {
  const head = full
    ? '<tr><th>Nr.</th><th>Art</th><th>Wand / Ort</th><th class="num">ab l. Ecke</th><th class="num">Höhe Bezug</th><th class="num">ü. FFB</th><th class="num">Pl.</th><th>Dosenmitten (s / h)</th><th>Dose</th><th>Bestückung</th><th>SK</th><th>Status / Hinweis</th></tr>'
    : '<tr><th>Nr.</th><th>Art</th><th>Wand / Ort</th><th class="num">ab l. Ecke</th><th class="num">ü. FFB</th><th>Hinweis</th></tr>';
  const body = rows.map((r) => full
    ? `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.kind)}</td><td>${esc(r.where)}</td><td class="num">${esc(r.s)}</td><td class="num">${esc(r.z)}</td><td class="num">${esc(r.zFfb)}</td><td class="num">${r.gangs}${r.gangs > 1 ? (r.orientation === 'senkrecht' ? ' ↕' : ' ↔') : ''}</td><td>${r.centers.length > 1 ? r.centers.map((c) => `${c.n}: ${c.s}/${c.z}`).join('<br>') : '–'}</td><td>${esc(r.boxType)}</td><td>${esc(r.inserts)}</td><td>${esc(r.circuit)}</td><td>${esc(r.status)}${r.note ? ' – ' + esc(r.note) : ''}</td></tr>`
    : `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.kind)}${r.gangs > 1 ? ` ${r.gangs}-fach` : ''}</td><td>${esc(r.where)}</td><td class="num">${esc(r.s)}</td><td class="num">${esc(r.zFfb)}</td><td>${esc(r.note)}</td></tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

function findingsHtml(items: ReturnType<typeof runRules>['findings'], limit = 40): string {
  if (!items.length) return '<p class="small">Keine Auffälligkeiten.</p>';
  const rows = items.slice(0, limit).map((f) => `<tr><td class="sev-${f.severity}">${severityLabel[f.severity]}</td><td>${esc(f.message)}</td><td class="small">${esc(f.source)}${f.confirm ? ' <span class="confirm">⚠ bestätigen</span>' : ''}</td></tr>`).join('');
  const more = items.length > limit ? `<p class="small">… und ${items.length - limit} weitere (siehe Prüfprotokoll in der Anwendung).</p>` : '';
  return `<table><thead><tr><th>Status</th><th>Meldung</th><th>Quelle</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function roomDataHtml(project: Project, room: Room): string {
  const walls = wallGeoms(room).map((w) => {
    const wall = room.walls[w.index];
    const extra = [
      wall.exterior ? 'Außenwand' : 'Innenwand',
      wall.loadBearing ? 'tragend' : '',
      wall.preWall.length ? `Vorwand: ${wall.preWall.map((p) => `${fmt(p.from)}–${fmt(p.to)} (${p.height == null ? 'rh' : fmt(p.height)})`).join(', ')}` : '',
      wall.zones.length ? wall.zones.map((z) => `${z.kind} ${fmt(z.from)}–${fmt(z.to)}`).join(', ') : '',
    ].filter(Boolean).join(' · ');
    return `<tr><td><b>W${w.index + 1}</b>${wall.label ? ' ' + esc(wall.label) : ''}</td><td class="num">${fmt(w.length)}</td><td>${esc(wallMaterialLabel[wall.material])}</td><td>${esc(extra)}</td></tr>`;
  }).join('');
  const fb = futureBuildup(room);
  return `
<dl class="kv">
<dt>Nutzung</dt><dd>${esc(room.usage || '–')}${room.futureUsage ? ` (künftig: ${esc(room.futureUsage)})` : ''}</dd>
${room.formerName ? `<dt>Bestandsplan</dt><dd>${esc(room.formerName)}</dd>` : ''}
<dt>Fläche / Höhe</dt><dd>${fmt(roomArea(room), 2)} m² · lichte Höhe ${fmt(room.height)} cm über Bezug</dd>
<dt>Installation</dt><dd>${esc(installationTypeLabel[room.installationType])}${room.wetRoom ? ' · Feuchtraum' : ''}</dd>
<dt>Smart Home</dt><dd>${esc(smartHomeLabel[effectiveSmart(project, room)])}</dd>
<dt>Höhenbezug</dt><dd>${esc(project.settings.heightReference.label)}; künftiger Bodenaufbau +${fmt(fb)} cm</dd>
<dt>Boden</dt><dd>${room.floor.slotsAllowed ? `Bodenschlitze bis ${fmt(room.floor.maxSlotDepth)} cm; Folie/Dämmung ab ${fmt(room.floor.protectedLayerDepth)} cm` : 'keine Bodenschlitze'}${room.floor.note ? ' – ' + esc(room.floor.note) : ''}</dd>
<dt>Decke</dt><dd>${esc(ceilingLabel[room.ceiling.construction])}: ${room.ceiling.slotsAllowed ? 'schlitzbar' : 'nicht schlitzen'}, ${room.ceiling.drillingAllowed ? 'bohren erlaubt' : 'nicht bohren'}${room.ceiling.note ? ' – ' + esc(room.ceiling.note) : ''}</dd>
</dl>
<h3>Wände (Uhrzeigersinn ab Nullpunkt)</h3>
<table><thead><tr><th>Wand</th><th class="num">Länge</th><th>Material</th><th>Besonderheiten</th></tr></thead><tbody>${walls}</tbody></table>`;
}

export function buildDocument(project: Project, kind: DocumentKind): string {
  const rooms = project.rooms.filter((r) => r.inScope);
  const pages: Page[] = [];
  const report = runRules(project);

  // Deckblatt
  pages.push({
    title: documentLabel[kind],
    body: `<div class="col cover" style="flex:1">
<h1>${esc(project.name)}</h1>
<p>${esc(projectTypeLabel[project.projectType])}${project.address ? ' · ' + esc(project.address) : ''}${project.bundesland ? ' · ' + esc(project.bundesland) : ''}</p>
<p>${esc(project.description)}</p>
<p><span class="badge">⚡ ${esc(DISCLAIMER)}</span></p>
<dl class="kv" style="max-width:180mm">
<dt>Höhenbezug</dt><dd>${esc(project.settings.heightReference.label)} – ${esc(project.settings.heightReference.description)}</dd>
<dt>Bezugssystem</dt><dd>Jeder Raum hat einen Nullpunkt (Ecke 1, rot markiert). Wände sind im Uhrzeigersinn nummeriert. Alle Maße auf einer Wand gelten ab ihrer <b>linken Ecke beim Blick von innen auf die Wand</b>.</dd>
<dt>Schalterprogramm</dt><dd>${esc(project.settings.switchProgram.manufacturer)} ${esc(project.settings.switchProgram.series)}, ${esc(project.settings.switchProgram.color)}; Feuchtraum/AP: ${esc(project.settings.switchProgram.wetRoomSeries)}</dd>
<dt>Smart Home</dt><dd>${project.smartHome.enabled ? esc(smartHomeLabel[project.smartHome.system]) + (project.smartHome.central ? ' – ' + esc(project.smartHome.central) : '') : 'nicht vorgesehen'}${project.smartHome.notes ? '<br>' + esc(project.smartHome.notes) : ''}</dd>
<dt>Mehrfachdosen</dt><dd>Achsabstand ${fmt(project.settings.boxPitch * 10, 0)} mm; Konvention: ${project.settings.boxConvention === 'mittig' ? 'Position = Mitte der Kombination' : 'Position = erste Dose, weitere weg von der Tür'}</dd>
<dt>Räume</dt><dd>${rooms.map((r) => esc(r.name) + (r.formerName && r.formerName !== r.name ? ` <span class="small">(Bestand: ${esc(r.formerName)})</span>` : '')).join(' · ')}</dd>
${project.keepAsIs.length ? `<dt>Bleibt unverändert</dt><dd>${project.keepAsIs.map(esc).join(' · ')}</dd>` : ''}
</dl></div>`,
  });

  // Gesamtansichten
  for (const f of project.floors) {
    const fr = project.rooms.filter((r) => r.floorId === f.id);
    if (!fr.length) continue;
    const all = fr.flatMap((r) => floorPolygon(r));
    const bb = bbox(all);
    const scale = pickScale(bb.maxX - bb.minX + 40, bb.maxY - bb.minY + 40, BODY_W, BODY_H - 10, [50, 75, 100, 150, 200]);
    pages.push({
      title: `Übersicht ${f.name}`,
      subtitle: `M 1:${scale}`,
      body: `<div class="col" style="flex:1"><div class="planbox" style="flex:1">${renderFloorOverview(project, f.id, { scale })}</div><p class="small">Lage der Räume zueinander nur zur Orientierung. Rote Punkte = Raum-Nullpunkte. Neue Raumnamen groß, Bezeichnung im Bestandsplan klein.</p></div>`,
    });
  }

  if (kind === 'ausfuehrung') {
    // Verteilungen + Stromkreisliste
    const ct = circuitTable(project);
    const lengths = computeLengths(project);
    const calc = (id: string) => lengths.circuits.find((c) => c.circuitId === id);
    const dists = project.distributions.map((d) => `<h3>${esc(d.name)}</h3><p class="small">${d.kind}${d.feedCable ? ` · Zuleitung ${esc(d.feedCable)} ${esc(d.feedFuse)}` : ''}${d.mainFuse ? ` · Hauptsicherung ${esc(d.mainFuse)}` : ''} · Netzform ${esc(d.netForm)} · ${d.freeModules} TE frei${d.hasSpd ? ' · SPD vorgesehen' : ''}<br>
Freie LS: ${d.breakers.map((b) => `${b.free}× ${b.characteristic}${b.ratedCurrent}`).join(', ') || '–'} · RCD: ${d.rcds.map((r) => esc(r.label) + (r.existing ? '' : ' (neu)')).join(', ') || '–'}${d.note ? '<br>' + esc(d.note) : ''}</p>`).join('');
    for (const [i, part] of chunk(ct, 18).entries()) {
      pages.push({
        title: 'Stromkreisliste',
        subtitle: i ? '(Fortsetzung)' : '',
        body: `<div class="col" style="flex:1">${i === 0 ? dists : ''}<table><thead><tr><th>SK</th><th>Bezeichnung</th><th>Verteilung</th><th>LS</th><th>LS vorh.?</th><th>RCD</th><th>Leitung</th><th class="num">Länge</th><th class="num">ΔU</th><th>Räume</th><th>Auslässe</th><th>Begründung</th></tr></thead><tbody>${part.map((c) => `<tr><td><b>${esc(c.label)}</b></td><td>${esc(c.name)}</td><td>${esc(c.distribution)}</td><td>${esc(c.breaker)}</td><td>${esc(c.existingBreaker)}</td><td>${esc(c.rcd)}</td><td>${esc(c.cable)}</td><td class="num">${calc(c.id)?.lengthM ? fmt(calc(c.id)!.lengthM) + ' m' : '–'}</td><td class="num">${esc(describeDrop(calc(c.id)))}</td><td>${esc(c.rooms)}</td><td class="small">${esc(c.outlets)}</td><td class="small">${esc(c.reason)}</td></tr>`).join('')}</tbody></table>
<p class="small">Absicherung, Querschnitt und Selektivität bestimmt die Elektrofachkraft (Leitungslänge, Verlegeart, Spannungsfall nach DIN VDE 0100-520). Längen aus den berechneten Leitungswegen inkl. Zuschlag; Wege zwischen Räumen sind Schätzungen über die Lage im Geschoss. ΔU konservativ mit Nennstrom am Kreisende.</p></div>`,
      });
    }
    // Leitungsliste
    const totals = cableTotals(lengths);
    for (const [i, part] of chunk(lengths.runs, 26).entries()) {
      pages.push({
        title: 'Leitungsliste',
        subtitle: i ? '(Fortsetzung)' : `${lengths.runs.length} Leitungen`,
        body: `<div class="col" style="flex:1"><table><thead><tr><th>Nr.</th><th>Leitung</th><th>SK</th><th>von</th><th>nach</th><th class="num">Länge</th><th>Art</th></tr></thead><tbody>${part.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.cable)}</td><td>${esc(project.circuits.find((c) => c.id === r.circuitId)?.label ?? '')}</td><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td class="num">${fmt(r.length)} m</td><td class="small">${r.kind}${r.estimate ? ' (Schätzung)' : ''}</td></tr>`).join('')}</tbody></table>
${i === Math.ceil(lengths.runs.length / 26) - 1 ? `<h3>Summe je Kabeltyp (inkl. Reserven, ohne Gebinde-Aufrundung)</h3><table style="width:120mm"><tbody>${totals.map((t) => `<tr><td>${esc(t.cable)}</td><td class="num">${fmt(t.meters)} m</td></tr>`).join('')}</tbody></table>` : ''}</div>`,
      });
    }

    // Einsatz-Stückliste
    const bom = insertBom(project);
    pages.push({
      title: 'Einsatz-Stückliste',
      subtitle: `${project.settings.switchProgram.manufacturer} ${project.settings.switchProgram.series}`,
      body: `<div class="col" style="flex:1"><table style="width:120mm"><thead><tr><th>Einsatz</th><th class="num">Anzahl</th></tr></thead><tbody>${bom.inserts.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table></div>
<div class="col" style="flex:1"><h2>Rahmen (UP/Hohlwand)</h2><table style="width:80mm"><thead><tr><th>Rahmen</th><th class="num">Anzahl</th></tr></thead><tbody>${bom.frames.map(([k, v]) => `<tr><td>${k}-fach</td><td class="num">${v}</td></tr>`).join('')}</tbody></table>
<p class="small">Ohne Bestandsauslässe, die bleiben. Aufputz-Kombinationen (Feuchtraumprogramm) sind ohne Rahmen gezählt. Vollständige Materialliste mit Dosen, Kabeln und Gebinden folgt in Etappe 3.</p></div>`,
    });
    // Prüfprotokoll Projekt
    const projectFindings = report.findings.filter((f) => f.severity !== 'ok');
    for (const [i, part] of chunk(projectFindings, 22).entries()) {
      pages.push({
        title: 'Hinweise und offene Prüfpunkte',
        subtitle: i ? '(Fortsetzung)' : `${report.counts.fehler} Fehler · ${report.counts.warnung} Warnungen · ${report.counts.hinweis} Hinweise`,
        body: `<div class="col" style="flex:1">${findingsHtml(part, 22)}</div>`,
      });
    }
    pages.push({
      title: 'Verwendete Norm- und Praxiswerte',
      body: `<div class="col" style="flex:1"><table><thead><tr><th>Schlüssel</th><th>Bedeutung</th><th class="num">Wert</th><th>Quelle</th><th>Status</th></tr></thead><tbody>${NORM_VALUES.map((v) => {
        const o = project.settings.normOverrides[v.key];
        return `<tr><td class="small">${esc(v.key)}</td><td>${esc(v.label)}</td><td class="num">${fmt(o ?? v.value)} ${esc(v.unit)}${o != null ? ' (angepasst)' : ''}</td><td class="small">${esc(v.source)}</td><td>${v.confirm ? (project.settings.confirmedNorms[v.key] ? `✔ ${esc(project.settings.confirmedNorms[v.key])}` : '<span class="confirm">⚠ vom Elektriker zu bestätigen</span>') : 'Praxiswert'}</td></tr>`;
      }).join('')}</tbody></table></div>`,
    });
  }

  if (kind === 'pruefprotokoll') {
    buildProtocolPages(project, report, pages);
    return wrapPages(project, kind, pages);
  }

  if (kind === 'material' || kind === 'kosten' || kind === 'aufgaben') {
    const lengths = computeLengths(project);
    if (kind === 'material') buildMaterialPages(project, computeMaterial(project, lengths), pages);
    if (kind === 'kosten') buildCostPages(project, estimateCosts(project, lengths), pages);
    if (kind === 'aufgaben') buildTaskPages(buildTasks(project, lengths.routes), pages);
    return wrapPages(project, kind, pages);
  }

  if (kind === 'schlitzplan') {
    buildSlotPlanPages(project, pages);
    return wrapPages(project, kind, pages);
  }

  // Raumseiten
  for (const room of rooms) {
    const rows = boxTable(project, room);
    if (kind === 'raumlayout') {
      const { svg, scale } = planFor(project, room, 165, BODY_H - 8);
      pages.push({
        title: roomTitle(room),
        subtitle: `${roomSubtitle(room)} · Draufsicht M 1:${scale}`,
        body: `<div class="col" style="width:170mm"><div class="planbox" style="flex:1">${svg}</div>${legendHtml}</div>
<div class="col" style="flex:1"><h2>Auslässe (${rows.length})</h2>${boxTableHtml(project, room, rows.slice(0, 26), false)}${rows.length > 26 ? '<p class="small">Weitere Auslässe siehe Ausführungsplan.</p>' : ''}
<p class="small">${esc(elevationLegendText())}</p></div>`,
      });
      continue;
    }
    // Ausführung: Draufsicht + Raumdaten
    const { svg, scale } = planFor(project, room, 160, BODY_H - 8);
    const rf = report.findings.filter((f) => f.roomId === room.id && f.severity !== 'ok');
    pages.push({
      title: roomTitle(room),
      subtitle: `${roomSubtitle(room)} · Draufsicht M 1:${scale}`,
      body: `<div class="col" style="width:165mm"><div class="planbox" style="flex:1">${svg}</div>${legendHtml}</div>
<div class="col" style="flex:1">${roomDataHtml(project, room)}<h3>Prüfpunkte</h3>${findingsHtml(rf, 4)}</div>`,
    });
    for (const [i, part] of chunk(rows, 20).entries()) {
      pages.push({
        title: `${roomTitle(room)} – Dosentabelle`,
        subtitle: i ? '(Fortsetzung)' : roomSubtitle(room),
        body: `<div class="col" style="flex:1">${boxTableHtml(project, room, part, true)}<p class="small">${esc(elevationLegendText())} „Pl.“ = Dosenplätze (↔ waagerecht, ↕ senkrecht, Achsabstand ${fmt(project.settings.boxPitch * 10, 0)} mm). Bohrung Ø ${fmt(project.settings.boxDrill * 10, 0)} mm.</p></div>`,
      });
    }
    // Fotos (4 je Seite)
    for (const [i, part] of chunk(room.photos, 4).entries()) {
      if (!part.length) break;
      pages.push({
        title: `${roomTitle(room)} – Fotos`,
        subtitle: i ? '(Fortsetzung)' : roomSubtitle(room),
        body: `<div class="photos">${part.map((ph) => `<figure><img src="${ph.dataUrl}"><figcaption>${ph.wallIndex != null ? `<b>W${ph.wallIndex + 1}</b> ` : ''}${esc(ph.caption)}</figcaption></figure>`).join('')}</div>`,
      });
    }
    // Wandabwicklungen: bevorzugt M 1:25; zwei kurze/niedrige Wände je Seite, sonst eine
    const walls = wallGeoms(room);
    const elevH = (len: number, sc: number) => ({ w: ((len + 42 * (sc / 10)) * 10) / sc, h: ((room.height + 45 * (sc / 10)) * 10) / sc });
    const pickElevScale = (len: number, maxH: number) => [20, 25, 50, 75, 100].find((sc) => elevH(len, sc).w <= BODY_W && elevH(len, sc).h <= maxH) ?? 100;
    let i = 0;
    while (i < walls.length) {
      const a = walls[i];
      const b = walls[i + 1];
      const half = (BODY_H - 8) / 2;
      const twoFit = b && pickElevScale(a.length, half) <= 25 && pickElevScale(b.length, half) <= 25;
      const group = twoFit ? [a, b] : [a];
      const maxH = twoFit ? half : BODY_H - 6;
      const svgs = group.map((w) => {
        const sc = pickElevScale(w.length, maxH);
        return `<div class="planbox" style="height:${maxH}mm"><div style="display:flex;flex-direction:column;align-items:center">${renderElevation(project, room, w.index, { scale: sc })}<span class="small">M 1:${sc} · ${esc(elevationLegendText())}</span></div></div>`;
      });
      pages.push({
        title: `${roomTitle(room)} – Wandabwicklung`,
        subtitle: `Wand ${group.map((w) => w.index + 1).join(' und ')} · ${roomSubtitle(room)}`,
        body: `<div class="col" style="flex:1">${svgs.join('')}</div>`,
      });
      i += group.length;
    }
  }

  return wrapPages(project, kind, pages);
}

// ===========================================================================
// Schlitzplan
// ===========================================================================

const SLOT_RULES = [
  'Vor dem Schlitzen: Leitungssucher über jede Trasse, auf Betonstürze und alte Leitungen prüfen. Keine Schlitze über Türstürzen, in Kaminwangen oder Hohlkörperdecken (Hourdis).',
  'Wandschlitze senkrecht in den Installationszonen (DIN 18015-3); waagerecht nur, wo im Plan freigegeben. Tiefe und Breite laut Tabelle nicht überschreiten.',
  'Bodenschlitze: maximal die angegebene Tiefe (Folie/Dämmung/Fußbodenheizung nie anschneiden), einlagig, Kabel nebeneinander, keine Dübel im Boden – Fixierung mit Schnellzement-Batzen.',
  'Bodenschlitze mit zementärem Reparaturmörtel verfüllen (nicht Gips), danach Ausgleichsmasse. Wandschlitze mit Gips/Haftputz schließen.',
  'Dosen bündig zur Rohwand setzen; Putzausgleichsringe nur bei späterem Putz > 5 mm. Dosenmitte = Bohrmitte (Ø 68 mm).',
  'Vor dem Verschließen: jede Trasse mit Zollstock fotografieren. Isolationsmessung durch die Elektrofachkraft vor dem Einmörteln.',
  'Durchbrüche in Brandwänden/an Brandschutztüren nur mit zugelassener Abschottung (MLAR) – vom Fachbetrieb.',
];
const TOOLS = [
  'Mauernutfräse mit Absaugung (Staubklasse M), Diamantscheiben passend zum Material',
  'Bohrhammer mit Dosensenker Ø 68 mm (Hartmetall/Diamant), Fliesen-/Hohlwandsenker für Vorwände',
  'Leitungssucher / Ortungsgerät, Laser-Linienlaser, Zollstock, Wasserwaage, Bleistift',
  'Flachmeißel/Stemmeisen für Schlitzgrund, Staubsauger (Klasse M), Gehör-/Augenschutz, FFP2-Maske',
  'Schnellzement, zementärer Reparaturmörtel, Gips/Haftputz, Dosenmörtel',
];

function slotPlanRoomPages(project: Project, room: Room, rr: RoomRoutes, pages: Page[]) {
  const layers: Layer[] = ['230v', 'daten', 'licht', 'beschriftung', 'masse', 'trassen'];
  const { svg, scale } = planFor(project, room, 150, BODY_H - 8, layers);
  const t = routeTotals(rr);
  const fsRows = rr.floorSlots.map((f) => `<tr><td><b>${f.id}</b></td><td>W${f.wallIndex + 1}</td><td class="num">${fmt(f.sFrom)} → ${fmt(f.sTo)}</td><td class="num">${fmt(room.routing.floorOffset)}</td><td class="num">${fmt(f.length)}</td><td class="num">${f.inCavity ? '–' : `${f.width} × ${f.depth}`}</td><td>${f.duct ? 'im Sockelleistenkanal' : f.inCavity ? 'im Vorwand-Hohlraum, kein Schlitz' : f.crossesDoor ? 'quert Türöffnung (Schwelle)' : ''}</td><td class="small">${esc(f.cables.join(', '))}</td></tr>`).join('');
  const wsRows = rr.wallSlots.map((w) => `<tr><td><b>${w.id}</b></td><td>W${w.wallIndex + 1}</td><td>${w.orientation}</td><td class="num">${w.orientation === 'senkrecht' ? fmt(w.s) : `${fmt(w.s)} → ${fmt(w.sTo)}`}</td><td class="num">${fmt(w.zFrom)} – ${fmt(w.zTo)}</td><td class="num">${w.width} × ${w.depth}</td><td>${w.inVerticalZone ? '✔' : 'außerhalb'}</td><td class="small">${esc(w.cables.join(', '))}</td></tr>`).join('');
  const strat: Record<string, string> = { boden: 'Bodenschlitz-Trasse vor der Wand, senkrechte Stiche', decke: 'über Decke/Deckenhohlraum, Stiche von oben', wand_waagerecht: 'waagerechte Wandschlitze in der oberen Zone', aufputz: 'Aufputz (Rohr/Kanal) unter der Decke', sockelleiste: 'Sockelleisten-Kabelkanal, Stiche ab Kanaloberkante', keine: 'kein Leitungsweg möglich' };
  pages.push({
    title: `${room.name} – Schlitzplan`,
    subtitle: `${roomSubtitle(room)} · M 1:${scale}`,
    body: `<div class="col" style="width:155mm"><div class="planbox" style="flex:1">${svg}</div><div class="legend"><span style="color:#b45309">▬ Bodenschlitz (Breite maßstäblich)</span><span style="color:#b45309">■ Wandschlitz</span><span style="color:#7c3aed">┄ Decke</span><span style="color:#047857">▬ Aufputz</span><span style="color:#b45309">⊗ Durchbruch</span></div></div>
<div class="col" style="flex:1"><dl class="kv"><dt>Leitungsweg</dt><dd>${esc(strat[rr.strategy])} (${esc(rr.strategyReason)})</dd>
<dt>Abwägung</dt><dd class="small">${routingFeasibility(project, room).options.map((o) => `${o.verdict === 'ja' ? '✔' : o.verdict === 'nein' ? '✖' : '?'} ${esc(routeOptionLabel[o.option])}${o.verdict === 'nein' ? ` (${esc(o.reasons[0])})` : ''}`).join('<br>')}</dd>
<dt>Höhenbezug</dt><dd>${esc(project.settings.heightReference.label)}; Bodenaufbau +${fmt(futureBuildup(room))} cm</dd>
<dt>Boden</dt><dd>${room.floor.slotsAllowed ? `Schlitztiefe max. ${fmt(room.floor.maxSlotDepth * 10, 0)} mm (Folie ab ${fmt(room.floor.protectedLayerDepth)} cm)` : 'keine Bodenschlitze'}</dd>
<dt>Summen</dt><dd>${fmt(t.floorSlotM, 2)} m Bodenschlitz · ${fmt(t.wallSlotM, 2)} m Wandschlitz${t.surfaceM ? ` · ${fmt(t.surfaceM, 1)} m Aufputz` : ''} · ${t.drillUP} UP-Bohrungen · ${t.drillHollow} Hohlwand · ${t.surfaceBoxes} Aufputzdosen · ${t.drillCeiling} Decke · ${t.penetrations} Durchbruch</dd></dl>
${rr.floorSlots.length ? `<h3>Bodenschlitze (s ab linker Ecke der Wand)</h3><table><thead><tr><th>Nr.</th><th>Wand</th><th class="num">von → bis</th><th class="num">vor Wand</th><th class="num">Länge</th><th class="num">B × T mm</th><th>Hinweis</th><th>Kabel</th></tr></thead><tbody>${fsRows}</tbody></table>` : ''}
${rr.wallSlots.length ? `<h3>Wandschlitze</h3><table><thead><tr><th>Nr.</th><th>Wand</th><th>Richtung</th><th class="num">Position</th><th class="num">Höhe von – bis</th><th class="num">B × T mm</th><th>Zone</th><th>Kabel</th></tr></thead><tbody>${wsRows}</tbody></table>` : ''}
${rr.issues.length ? `<h3>Achtung (${rr.issues.length})</h3>${rr.issues.slice(0, 2).map((i) => `<p class="small sev-${i.severity}">${esc(i.message)}</p>`).join('')}${rr.issues.length > 2 ? `<p class="small">… weitere ${rr.issues.length - 2} im Prüfprotokoll des Ausführungsplans.</p>` : ''}` : ''}</div>`,
  });
  const kinds: [string, string][] = [['UP', 'UP-Dosen bohren Ø 68'], ['Hohlwand', 'Hohlwand-/Vorwanddosen'], ['Aufputz', 'Aufputzdosen (nicht bohren)'], ['Decke', 'Deckendosen'], ['Bestand', 'Bestandsdosen (bleiben)']];
  const drillRows = rr.drillings.map((d) => {
    const z = d.z != null ? `${fmt(d.z)} (${fmt(zToFfb(room, d.z))})` : '–';
    return `<tr><td><b>${esc(d.label)}</b></td><td>${d.wallIndex != null ? `W${d.wallIndex + 1}` : 'Decke'}</td><td class="num">${d.s != null ? fmt(d.s) : `x ${fmt(d.x)} / y ${fmt(d.y)}`}</td><td class="num">${z}</td><td>${esc(kinds.find((k) => k[0] === d.kind)?.[1] ?? d.kind)}</td></tr>`;
  });
  const half = Math.ceil(drillRows.length / 2);
  const tbl = (rows: string[]) => `<table><thead><tr><th>Dose</th><th>Wand</th><th class="num">ab l. Ecke</th><th class="num">Höhe Bezug (FFB)</th><th>Art</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  pages.push({
    title: `${room.name} – Bohrungen und Durchbrüche`,
    subtitle: roomSubtitle(room),
    body: `<div class="col" style="flex:1">${tbl(drillRows.slice(0, half))}</div><div class="col" style="flex:1">${tbl(drillRows.slice(half))}
${rr.penetrations.length ? `<h3>Durchbrüche</h3><table><thead><tr><th>Nr.</th><th>Wand</th><th class="num">Position</th><th class="num">Höhe</th><th class="num">Ø mm</th><th>Hinweis</th></tr></thead><tbody>${rr.penetrations.map((p) => `<tr><td>${p.id}</td><td>W${p.wallIndex + 1}</td><td class="num">${fmt(p.s)}</td><td class="num">${fmt(p.z)}</td><td class="num">${p.diameter}</td><td class="${p.fireStop ? 'sev-fehler' : ''}">${esc(p.note)}</td></tr>`).join('')}</tbody></table>` : ''}
<p class="small">Dosenmitte = Bohrmitte. Höhe über ${esc(project.settings.heightReference.label)}, in Klammern über Fertigfußboden. Mehrfachdosen: jede Dose einzeln (Nr. .1, .2 …).</p></div>`,
  });
  // Wandabwicklungen nur für Wände mit Arbeit
  const work = wallGeoms(room).filter((w) => rr.wallSlots.some((x) => x.wallIndex === w.index) || rr.drillings.some((d) => d.wallIndex === w.index && d.kind !== 'Bestand') || rr.penetrations.some((p) => p.wallIndex === w.index) || rr.surfaceRuns.some((a) => a.wallIndex === w.index));
  for (const w of work) {
    const sc = [20, 25, 50, 75, 100].find((x) => ((w.length + 42 * (x / 10)) * 10) / x <= BODY_W && ((room.height + 45 * (x / 10)) * 10) / x <= BODY_H - 6) ?? 100;
    pages.push({
      title: `${room.name} – Wand ${w.index + 1} (Schlitze/Bohrungen)`,
      subtitle: `${wallName(room, w.index)} · M 1:${sc}`,
      body: `<div class="col" style="flex:1;align-items:center">${renderElevation(project, room, w.index, { scale: sc, layers: ['230v', 'daten', 'licht', 'beschriftung', 'masse', 'trassen'], routes: rr })}<span class="small">${esc(elevationLegendText())}</span></div>`,
    });
  }
}

function buildSlotPlanPages(project: Project, pages: Page[]) {
  const l = computeLengths(project);
  const rooms = project.rooms.filter((r) => r.inScope);
  const sums = rooms.map((r) => ({ r, t: routeTotals(l.routes.get(r.id)!) }));
  const tot = sums.reduce((a, { t }) => ({ f: a.f + t.floorSlotM, w: a.w + t.wallSlotM, up: a.up + t.drillUP, h: a.h + t.drillHollow, ap: a.ap + t.surfaceBoxes, d: a.d + t.drillCeiling, p: a.p + t.penetrations, s: a.s + t.surfaceM }), { f: 0, w: 0, up: 0, h: 0, ap: 0, d: 0, p: 0, s: 0 });
  pages.push({
    title: 'Schlitzplan – Regeln, Werkzeug, Summen',
    body: `<div class="col" style="flex:1.2"><h2>Regeln für die Ausführung</h2><ol>${SLOT_RULES.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
<h2>Werkzeug / Miete</h2><ul>${TOOLS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
<div class="col" style="flex:1"><h2>Summen</h2><table><thead><tr><th>Raum</th><th class="num">Boden m</th><th class="num">Wand m</th><th class="num">UP</th><th class="num">Hohlw.</th><th class="num">AP</th><th class="num">Decke</th><th class="num">Durchbr.</th></tr></thead><tbody>
${sums.map(({ r, t }) => `<tr><td>${esc(r.name)}</td><td class="num">${fmt(t.floorSlotM, 1)}</td><td class="num">${fmt(t.wallSlotM, 1)}</td><td class="num">${t.drillUP}</td><td class="num">${t.drillHollow}</td><td class="num">${t.surfaceBoxes}</td><td class="num">${t.drillCeiling}</td><td class="num">${t.penetrations}</td></tr>`).join('')}
<tr><td><b>Summe</b></td><td class="num"><b>${fmt(tot.f, 1)}</b></td><td class="num"><b>${fmt(tot.w, 1)}</b></td><td class="num"><b>${tot.up}</b></td><td class="num"><b>${tot.h}</b></td><td class="num"><b>${tot.ap}</b></td><td class="num"><b>${tot.d}</b></td><td class="num"><b>${tot.p}</b></td></tr></tbody></table>
${tot.s ? `<p>Aufputz-Trassen gesamt: ${fmt(tot.s, 1)} m</p>` : ''}
<p class="badge">Vor dem Schlitzen auf Betonstürze, alte Leitungen und Rohre prüfen. Maße ab Nullpunkt / linker Wandecke – vor Ort anzeichnen und mit dem Plan vergleichen.</p></div>`,
  });
  for (const { r } of sums) slotPlanRoomPages(project, r, l.routes.get(r.id)!, pages);
}

export { boxTypeLabel };

// ===========================================================================
// Material, Kosten, Aufgaben
// ===========================================================================

function buildMaterialPages(project: Project, list: ReturnType<typeof computeMaterial>, pages: Page[]) {
  type Row = { kind: 'head'; text: string } | { kind: 'line'; l: (typeof list.lines)[number] } | { kind: 'sum'; text: string; total: number };
  const rows: Row[] = [];
  for (const g of list.groups) {
    rows.push({ kind: 'head', text: g.group });
    g.lines.forEach((l) => rows.push({ kind: 'line', l }));
    rows.push({ kind: 'sum', text: `Summe ${g.group}`, total: g.total });
  }
  const parts = chunk(rows, 30);
  parts.forEach((part, i) => {
    const body = part.map((r) => r.kind === 'head' ? `<tr><th colspan="8" style="background:#e5e7eb">${esc(r.text)}</th></tr>`
      : r.kind === 'sum' ? `<tr><td></td><td colspan="5"><b>${esc(r.text)}</b></td><td class="num"><b>${euro(r.total)}</b></td><td></td></tr>`
      : `<tr><td style="font-size:11pt">${r.l.checked ? '☑' : '☐'}</td><td>${esc(r.l.label)}${r.l.note ? `<div class="small">${esc(r.l.note)}</div>` : ''}</td><td class="num">${fmt(r.l.need)}</td><td>${esc(r.l.unit)}</td><td>${esc(r.l.orderText)}</td><td class="num">${euro(r.l.unitPrice)}</td><td class="num">${euro(r.l.total)}</td><td style="width:22mm"></td></tr>`).join('');
    pages.push({
      title: 'Material- und Bestellliste',
      subtitle: i ? '(Fortsetzung)' : `Richtpreise, Stand ${new Date().getFullYear()} – ohne Gewähr`,
      body: `<div class="col" style="flex:1"><table><thead><tr><th>✓</th><th>Position</th><th class="num">Bedarf</th><th>Einh.</th><th>Bestellung (Gebinde)</th><th class="num">Einzelpreis</th><th class="num">Summe</th><th>Notiz</th></tr></thead><tbody>${body}</tbody></table>
${i === parts.length - 1 ? `<p><b>Gesamt (Richtwert): ${euro(list.total)}</b> · davon noch offen: ${euro(list.openTotal)}</p><p class="small">Mengen aus Plan, Leitungswegen und Leitungslängen berechnet (inkl. Reserven); Bestellmenge auf handelsübliche Gebinde aufgerundet. Schalterprogramm: ${esc(project.settings.switchProgram.manufacturer)} ${esc(project.settings.switchProgram.series)} – je nach Serie werden Einsatz und Abdeckung getrennt bestellt.</p>` : ''}</div>`,
    });
  });
}

function buildCostPages(project: Project, c: ReturnType<typeof estimateCosts>, pages: Page[]) {
  pages.push({
    title: 'Kostenschätzung',
    subtitle: `Vorarbeiten: ${c.mode === 'eigenleistung' ? 'Eigenleistung' : 'durch Handwerker'}`,
    body: `<div class="col" style="flex:1"><table><thead><tr><th>Gewerk</th><th>Umfang</th><th>Wer</th><th class="num">Stunden</th><th class="num">von</th><th class="num">bis</th></tr></thead><tbody>
${c.rows.map((r) => `<tr><td><b>${esc(r.title)}</b></td><td class="small">${esc(r.detail)}</td><td>${esc(r.who)}</td><td class="num">${r.hours ? fmt(r.hours) : '–'}</td><td class="num">${euro(r.min)}</td><td class="num">${euro(r.max)}</td></tr>`).join('')}
<tr><td colspan="4"><b>Summe (Richtwert)</b></td><td class="num"><b>${euro(c.min)}</b></td><td class="num"><b>${euro(c.max)}</b></td></tr></tbody></table>
<p>Eigene Arbeitszeit: ca. <b>${fmt(c.hoursOwn)} h</b> · Fachkraft/Handwerker: ca. <b>${fmt(c.hoursPro)} h</b></p>
<p class="small">Stundensätze: Handwerker ${euro(project.costs.rateHelperMin)}–${euro(project.costs.rateHelperMax)}/h, Elektrofachkraft ${euro(project.costs.rateElectricianMin)}–${euro(project.costs.rateElectricianMax)}/h; Unvorhergesehenes ${project.costs.contingencyMin}–${project.costs.contingencyMax} %. Aufwände sind Erfahrungswerte (Schlitzen je Meter nach Wandmaterial, Dosen, Kabelmeter, Verteilerarbeiten, Erstprüfung). Grobe Schätzung – ersetzt kein Angebot. Anschluss, Prüfung und Abnahme sind immer Sache der Elektrofachkraft.</p></div>`,
  });
}

function buildTaskPages(tasks: ReturnType<typeof buildTasks>, pages: Page[]) {
  type Row = { head?: string; t?: (typeof tasks)[number] };
  const rows: Row[] = [];
  for (const ph of PHASES) {
    const ts = tasks.filter((t) => t.phase === ph);
    if (!ts.length) continue;
    rows.push({ head: ph });
    ts.forEach((t) => rows.push({ t }));
  }
  const parts = chunk(rows, 24);
  parts.forEach((part, i) => pages.push({
    title: 'Aufgaben- und Prüfliste',
    subtitle: i ? '(Fortsetzung)' : 'Reihenfolge der Arbeiten · ⛔ = Haltepunkt (erst erledigen, dann weiter)',
    body: `<div class="col" style="flex:1"><table><thead><tr><th>✓</th><th>Aufgabe</th><th>Wer</th><th>Datum / Kürzel</th></tr></thead><tbody>${part.map((r) => r.head ? `<tr><th colspan="4" style="background:#e5e7eb">${esc(r.head)}</th></tr>` : `<tr><td style="font-size:11pt">${r.t!.done ? '☑' : '☐'}</td><td>${r.t!.hold ? '⛔ ' : ''}${esc(r.t!.text)}</td><td class="small">${esc(r.t!.who)}</td><td style="width:30mm"></td></tr>`).join('')}</tbody></table></div>`,
  }));
}

// ===========================================================================
// Prüfprotokoll
// ===========================================================================

function buildProtocolPages(project: Project, report: ReturnType<typeof runRules>, pages: Page[]) {
  const d = projectDemand(project);
  const lengths = computeLengths(project);
  const cap = capacityChecks(project, lengths.routes);
  const sig = (who: string) => `<div style="flex:1;border-top:.3mm solid #111;padding-top:1mm;margin-top:14mm" class="small">${esc(who)}<br>Name, Firma/Eintragung, Datum, Unterschrift</div>`;
  const rooms = project.rooms.filter((r) => r.inScope);

  // 1) Anlagendaten
  pages.push({
    title: 'Prüfprotokoll – Anlagendaten und Leistungsbilanz',
    body: `<div class="col" style="flex:1"><dl class="kv">
<dt>Projekt</dt><dd>${esc(project.name)}${project.address ? ', ' + esc(project.address) : ''} (${esc(projectTypeLabel[project.projectType])})</dd>
<dt>Geschosse</dt><dd>${project.floors.map((f) => `${esc(f.name)} (Ebene ${f.level}, ${fmt(f.height)} cm, ${project.rooms.filter((r) => r.floorId === f.id).length} Räume)`).join(' · ')}</dd>
<dt>Verteilungen</dt><dd>${project.distributions.map((x) => `${esc(x.name)} – ${x.netForm}${x.mainFuse ? `, Hauptsicherung ${esc(x.mainFuse)}` : ''}${x.feedCable ? `, Zuleitung ${esc(x.feedCable)} ${esc(x.feedFuse)}` : ''}${x.hasSpd ? ', SPD' : ''}; RCD: ${x.rcds.map((r) => esc(r.label)).join(', ') || '–'}`).join('<br>')}</dd>
<dt>Stromkreise</dt><dd>${project.circuits.length}</dd>
<dt>Leistung</dt><dd>installiert ${kw(d.installed)}, gleichzeitig geschätzt ${kw(d.simultaneous)}${d.mainFuse ? ` (${fmt(d.ratio! * 100, 0)} % der Hauptsicherung)` : ''}</dd>
</dl>
<h3>Leistungsbedarf je Raum</h3><table><thead><tr><th>Raum</th><th>Nutzung</th><th>Verbraucher</th><th class="num">Summe</th></tr></thead><tbody>${rooms.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.roomType ? esc(ROOM_TYPE_INFO[r.roomType].label) : '–'}</td><td class="small">${r.loads.map((l) => `${esc(l.label)} ${kw(l.power)}${l.dedicated ? ' (eigener Kreis)' : ''}`).join(', ') || '–'}</td><td class="num">${kw(r.loads.reduce((a, l) => a + l.power, 0))}</td></tr>`).join('')}</tbody></table></div>`,
  });

  // 2) Planungsprüfung je Regel
  const ruleRows = RULES.map((r) => {
    const fs = report.findings.filter((f) => f.ruleId === r.id);
    const off = project.settings.disabledRules[r.id];
    const st = off ? `deaktiviert: ${esc(off)}` : fs.some((f) => f.severity === 'fehler') ? '<span class="sev-fehler">Fehler</span>' : fs.some((f) => f.severity === 'warnung') ? '<span class="sev-warnung">Warnung</span>' : fs.length ? '<span class="sev-hinweis">Hinweis</span>' : 'OK';
    return `<tr><td>${st}${fs.length ? ` (${fs.length})` : ''}</td><td>${esc(r.title)}</td><td class="small">${esc(r.source)}${r.confirm ? ' ⚠' : ''}</td><td style="width:30mm"></td></tr>`;
  });
  for (const [i, part] of chunk(ruleRows, 24).entries()) {
    pages.push({ title: 'Prüfprotokoll – Planungsprüfung', subtitle: i ? '(Fortsetzung)' : `${report.counts.fehler} Fehler · ${report.counts.warnung} Warnungen · ${report.counts.hinweis} Hinweise`, body: `<div class="col" style="flex:1"><table><thead><tr><th>Ergebnis</th><th>Prüfpunkt</th><th>Quelle</th><th>geprüft (Kürzel)</th></tr></thead><tbody>${part.join('')}</tbody></table><p class="small">Einzelmeldungen siehe Ausführungsplan („Hinweise und offene Prüfpunkte“). ⚠ = Werte/Regel von der Elektrofachkraft zu bestätigen.</p></div>` });
  }

  // 3) Belastbarkeit und Normwerte
  pages.push({
    title: 'Prüfprotokoll – Leitungsdimensionierung',
    body: `<div class="col" style="flex:1"><table><thead><tr><th>SK</th><th>Bezeichnung</th><th>LS</th><th>Leitung</th><th>Verlegeart (ungünstigster Abschnitt)</th><th class="num">Häufung</th><th class="num">Iz red.</th><th class="num">Last</th><th class="num">ΔU</th><th>bestätigt</th></tr></thead><tbody>
${cap.map((k) => { const c = k.circuit; const calc = lengths.circuits.find((x) => x.circuitId === c.id); const pw = circuitPower(project, c); return `<tr><td><b>${esc(c.label)}</b></td><td>${esc(c.name)}</td><td>${c.poles === 3 ? '3× ' : ''}${c.characteristic}${c.ratedCurrent}</td><td>${esc(c.cable)}</td><td class="small">${esc(LAYING_LABEL[k.method])}</td><td class="num">${k.grouped}</td><td class="num ${k.izReduced != null && c.ratedCurrent > k.izReduced ? 'sev-fehler' : ''}">${k.izReduced != null ? fmt(k.izReduced) + ' A' : '–'}</td><td class="num">${pw ? kw(pw) : '–'}</td><td class="num">${esc(describeDrop(calc))}</td><td style="width:18mm"></td></tr>`; }).join('')}
</tbody></table><p class="small">Iz nach DIN VDE 0298-4 (Cu, PVC, 30 °C) mit Häufungsfaktor für den ungünstigsten Abschnitt der berechneten Leitungswege. Umgebungstemperatur, Wärmedämmung und Selektivität beurteilt die Elektrofachkraft.</p></div>`,
  });

  // 4) Messprotokoll (leer)
  const meas = project.circuits.map((c) => `<tr><td><b>${esc(c.label)}</b></td><td class="small">${esc(c.name)}</td><td>${c.poles === 3 ? '3× ' : ''}${c.characteristic}${c.ratedCurrent}</td><td class="small">${esc(project.distributions.flatMap((x) => x.rcds).find((r) => r.id === c.rcdId)?.label ?? '–')}</td><td>☐</td><td></td><td></td><td></td><td></td><td></td><td>☐</td></tr>`);
  for (const [i, part] of chunk(meas, 18).entries()) {
    pages.push({
      title: 'Messprotokoll Erstprüfung (DIN VDE 0100-600)',
      subtitle: i ? '(Fortsetzung)' : 'von der Elektrofachkraft auszufüllen',
      body: `<div class="col" style="flex:1"><table><thead><tr><th>SK</th><th>Bezeichnung</th><th>LS</th><th>RCD</th><th>Schutzleiter durchgängig</th><th>R<sub>iso</sub> MΩ</th><th>Z<sub>s</sub> Ω</th><th>I<sub>k</sub> A</th><th>RCD I<sub>Δ</sub> mA</th><th>RCD t<sub>a</sub> ms</th><th>Funktion</th></tr></thead><tbody>${part.join('')}</tbody></table>
${i === Math.ceil(meas.length / 18) - 1 ? `<p class="small">Besichtigen ☐ · Erproben ☐ · Messen ☐ · Drehfeld ☐ · Überspannungsschutz ☐ · Stromkreisliste in der Verteilung ☐ · Dokumentation übergeben ☐</p>
<div style="display:flex;gap:10mm">${sig('Planung / Bauherr')}${sig('Elektrofachkraft (Errichter)')}</div>
<p class="small">Dieses Blatt ersetzt nicht das Prüfprotokoll der Elektrofachkraft (z. B. ZVEH-Vordruck); es fasst die Planungsprüfung zusammen und dient als Vorlage.</p>` : ''}</div>`,
    });
  }
}
