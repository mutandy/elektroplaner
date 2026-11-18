/**
 * Grobe Kostenschätzung nach Gewerken – ausdrücklich ein Richtwert mit Spanne.
 * Stunden sind Praxis-Erfahrungswerte; Stundensätze im Projekt änderbar.
 */
import type { Project } from '../model/schema';
import { computeLengths, type Lengths } from './circuits';
import { computeMaterial, type MaterialList } from './bom';
import { routeTotals } from './routes';

export interface CostRow {
  id: string;
  title: string;
  detail: string;
  who: 'Einkauf' | 'Eigenleistung' | 'Handwerker' | 'Elektrofachkraft' | 'Pauschale';
  hours: number;
  min: number;
  max: number;
}

export interface CostEstimate {
  rows: CostRow[];
  min: number;
  max: number;
  hoursOwn: number;
  hoursPro: number;
  mode: 'eigenleistung' | 'handwerker';
}

/** Aufwandsfaktor für Wandschlitze je Material (Bims = 1). */
const SLOT_FACTOR: Record<string, number> = { bims: 1, porenbeton: 0.7, ziegel: 1, kalksandstein: 1.3, beton: 2.5, trockenbau: 0.5, holz: 0.6, unbekannt: 1.2 };

const round = (v: number) => Math.round(v / 10) * 10;
const h1 = (v: number) => Math.round(v * 10) / 10;

export function estimateCosts(project: Project, lengths: Lengths = computeLengths(project), material: MaterialList = computeMaterial(project, lengths)): CostEstimate {
  const c = project.costs;
  const rows: CostRow[] = [];
  const rooms = project.rooms.filter((r) => r.inScope);

  // Mengen
  let wallM = 0, wallMw = 0, floorM = 0, up = 0, hollow = 0, apBoxes = 0, surfaceM = 0, pens = 0, fire = 0;
  for (const r of rooms) {
    const rr = lengths.routes.get(r.id);
    if (!rr) continue;
    const t = routeTotals(rr);
    for (const w of rr.wallSlots) {
      const len = (w.orientation === 'senkrecht' ? w.zTo - w.zFrom : w.sTo - w.s) / 100;
      wallM += len;
      wallMw += len * (SLOT_FACTOR[r.walls[w.wallIndex]?.material ?? 'unbekannt'] ?? 1);
    }
    floorM += t.floorSlotM;
    up += t.drillUP + t.drillCeiling;
    hollow += t.drillHollow;
    apBoxes += t.surfaceBoxes;
    surfaceM += t.surfaceM;
    pens += t.penetrations;
    fire += rr.penetrations.filter((p) => p.fireStop).length;
  }
  const cableM = lengths.runs.reduce((s, r) => s + r.length, 0);
  const inserts = rooms.reduce((s, r) => s + r.outlets.filter((o) => o.status === 'neu' || o.status === 'bestand_wird_ersetzt').reduce((a, o) => a + Math.max(1, o.inserts.length), 0), 0);
  const newLs = project.circuits.filter((x) => !x.breakerGroupId).length;
  const newRcd = project.distributions.reduce((s, d) => s + d.rcds.filter((r) => !r.existing).length, 0);
  const uvs = project.distributions.filter((d) => d.kind === 'UV').length;
  const existingCables = rooms.reduce((s, r) => s + r.existingCables.length, 0);

  // 1) Material
  rows.push({ id: 'material', title: 'Material laut Liste', detail: `${material.lines.length} Positionen, Richtpreise ±`, who: 'Einkauf', hours: 0, min: round(material.total * 0.9), max: round(material.total * 1.2) });

  // 2–5) Vorarbeiten
  const own = c.mode === 'eigenleistung';
  const prep = (id: string, title: string, detail: string, hours: number) => rows.push({ id, title, detail, who: own ? 'Eigenleistung' : 'Handwerker', hours: h1(hours), min: own ? 0 : round(hours * c.rateHelperMin), max: own ? 0 : round(hours * c.rateHelperMax) });
  prep('schlitzen', 'Schlitzen und Bohren', `${h1(wallM)} m Wand, ${h1(floorM)} m Boden, ${up} Bohrungen Ø 68, ${hollow} Hohlwand, ${pens} Durchbrüche`, wallMw * 0.3 + floorM * 0.45 + up * 0.25 + hollow * 0.15 + pens * 0.5);
  prep('dosen', 'Dosen setzen, Aufputz montieren', `${up + hollow} UP/Hohlwand, ${apBoxes} Aufputz, ${h1(surfaceM)} m Rohr`, (up + hollow) * 0.2 + apBoxes * 0.3 + surfaceM * 0.2);
  prep('kabel', 'Kabel einziehen und beschriften', `${Math.round(cableM)} m Leitung`, cableM * 0.04 + lengths.runs.length * 0.1);
  prep('schliessen', 'Schlitze schließen', `${h1(wallM + floorM)} m (Boden zementär, Wand Gips)`, (wallM + floorM) * 0.12);

  // 6) Elektrofachkraft (immer)
  const proHours = newLs * 0.4 + newRcd * 0.75 + uvs * 4 + inserts * 0.15 + 3 + project.circuits.length * 0.3 + existingCables * 0.5 + 2;
  rows.push({ id: 'elektro', title: 'Elektrofachkraft: Verteiler, Anschluss, Prüfung', detail: `${newLs} neue LS, ${newRcd} RCD, ${uvs} UV, ${inserts} Einsätze anschließen, Erstprüfung/Messung/Protokoll für ${project.circuits.length} Stromkreise, Bestandsleitungen prüfen, Abstimmung`, who: 'Elektrofachkraft', hours: h1(proHours), min: round(proHours * c.rateElectricianMin), max: round(proHours * c.rateElectricianMax) });
  if (fire) rows.push({ id: 'brandschutz', title: 'Brandschutz-Abschottungen (Fachbetrieb)', detail: `${fire} Durchführung(en)`, who: 'Handwerker', hours: 0, min: fire * 80, max: fire * 200 });

  // 7–8) Nebenarbeiten
  const slotM = wallM + floorM;
  rows.push({ id: 'putz', title: 'Putz/Spachtel/Maler ausbessern', detail: `${h1(slotM)} m Schlitz`, who: own ? 'Eigenleistung' : 'Handwerker', hours: own ? h1(slotM * 0.1) : 0, min: round(slotM * (own ? 0.5 : 4)), max: round(slotM * (own ? 1.5 : 10)) });
  rows.push({ id: 'entsorgung', title: 'Schutt und Entsorgung', detail: 'Bauschutt aus Schlitzen, Verpackung', who: 'Pauschale', hours: 0, min: slotM > 0 ? 30 : 0, max: slotM > 0 ? 150 : 0 });

  const subMin = rows.reduce((s, r) => s + r.min, 0);
  const subMax = rows.reduce((s, r) => s + r.max, 0);
  rows.push({ id: 'reserve', title: 'Unvorhergesehenes', detail: `${c.contingencyMin}–${c.contingencyMax} % (Bestand: Überraschungen hinter Putz, alte Leitungen)`, who: 'Pauschale', hours: 0, min: round((subMin * c.contingencyMin) / 100), max: round((subMax * c.contingencyMax) / 100) });

  return {
    rows,
    min: rows.reduce((s, r) => s + r.min, 0),
    max: rows.reduce((s, r) => s + r.max, 0),
    hoursOwn: h1(rows.filter((r) => r.who === 'Eigenleistung').reduce((s, r) => s + r.hours, 0)),
    hoursPro: h1(rows.filter((r) => r.who !== 'Eigenleistung').reduce((s, r) => s + r.hours, 0)),
    mode: c.mode,
  };
}
