/**
 * Welche Leitungswege sind in einem Raum möglich? Bewertet jede Variante mit
 * Begründung und schlägt den sinnvollsten Weg vor. Grundlage sind die
 * Antworten zu Decke, Boden, Wänden und Optik (room.routingOptions).
 */
import type { Project, Room, RoutingStrategy } from '../model/schema';
import { fmt, futureBuildup } from '../geometry/room';
import { normValue } from '../rules/normValues';
import { ceilingLabel } from '../model/labels';

export type Verdict = 'ja' | 'bedingt' | 'nein';
export type RouteOption = 'aufputz' | 'boden' | 'decke' | 'decke_abhaengen' | 'sockelleiste' | 'wand_waagerecht';

export const routeOptionLabel: Record<RouteOption, string> = {
  boden: 'Bodenschlitz im Estrich',
  decke: 'Über die vorhandene Decke (Hohlraum/Schlitz)',
  decke_abhaengen: 'Decke abhängen (neuer Hohlraum)',
  sockelleiste: 'Sockelleisten-Kabelkanal',
  wand_waagerecht: 'Waagerechte Wandschlitze oben',
  aufputz: 'Aufputz (Rohr/Kanal sichtbar)',
};

export interface OptionResult {
  option: RouteOption;
  strategy: Exclude<RoutingStrategy, 'auto'>;
  verdict: Verdict;
  reasons: string[];
}

export interface Feasibility {
  options: OptionResult[];
  recommended: OptionResult | null;
  /** Lichte Höhe heute über künftigem Fertigfußboden */
  clearHeight: number;
  minHeight: number;
}

const LIVING = ['wohnen', 'schlafen', 'kind', 'gaeste', 'kueche', 'essen', 'buero', 'heimkino', 'hobby', 'fitness'];

/** Mindest-Bodenschlitztiefe: dickstes übliches Kabel (NYM-J 3×2,5 ≈ 10 mm) + Überdeckung. */
export function requiredFloorSlotDepth(project: Project): number {
  return 10 + normValue(project, 'boden.minUeberdeckungKabel');
}

export function routingFeasibility(project: Project, room: Room): Feasibility {
  const o = room.routingOptions;
  const fb = futureBuildup(room);
  const clear = room.height - fb;
  const living = room.roomType ? LIVING.includes(room.roomType) : !room.installationType.startsWith('aufputz');
  const minH = normValue(project, living ? 'raum.minHoeheAufenthalt' : 'raum.minHoeheNebenraum');
  const res: OptionResult[] = [];
  const add = (option: RouteOption, strategy: OptionResult['strategy'], verdict: Verdict, ...reasons: string[]) => res.push({ option, strategy, verdict, reasons });

  // Boden
  const f = room.floor;
  const estrich = f.existingBelowRef.find((l) => /estrich/i.test(l.name));
  const need = requiredFloorSlotDepth(project);
  const estrichTxt = estrich ? `Estrich ${fmt(estrich.thickness)} cm` : 'Estrichdicke unbekannt';
  if (f.underfloorHeating) add('boden', 'boden', 'nein', 'Fußbodenheizung – Bodenschlitze ausgeschlossen.');
  else if (!f.slotsAllowed) add('boden', 'boden', 'nein', `Bodenschlitze nicht freigegeben (${estrichTxt}).`);
  else if (f.maxSlotDepth * 10 < need) add('boden', 'boden', 'nein', `Erlaubte Schlitztiefe ${fmt(f.maxSlotDepth * 10, 0)} mm, nötig ca. ${need} mm (Kabel + Überdeckung).`);
  else if (f.protectedLayerDepth == null) add('boden', 'boden', 'bedingt', `${estrichTxt}; Lage von Folie/Dämmung unbekannt – Probebohrung, dann Schlitztiefe festlegen.`);
  else add('boden', 'boden', 'ja', `${estrichTxt}, Folie/Dämmung ab ${fmt(f.protectedLayerDepth)} cm → Schlitz bis ${fmt(f.maxSlotDepth * 10, 0)} mm möglich (nötig ca. ${need} mm).`, 'Wände bleiben waagerecht ungeschlitzt, Decke unberührt.');

  // Vorhandene Decke
  const c = room.ceiling;
  if (c.construction === 'abgehaengt' || c.cavityDepth >= 10) add('decke', 'decke', 'ja', `Deckenhohlraum vorhanden (${fmt(c.cavityDepth)} cm).`);
  else if (c.cavityDepth > 0) add('decke', 'decke', 'bedingt', `Hohlraum nur ${fmt(c.cavityDepth)} cm (z. B. Lattung): gut für Deckenauslässe; für Wanddosen wären lange senkrechte Schlitze von oben nötig.`);
  else if (c.slotsAllowed) add('decke', 'decke', 'ja', `${ceilingLabel[c.construction]}: Deckenschlitze erlaubt.`);
  else if (c.construction === 'holzbalken') add('decke', 'decke', 'bedingt', 'Holzbalkendecke: Leitungen zwischen den Balken, Querungen durch Bohrungen (Statik beachten).');
  else add('decke', 'decke', 'nein', c.construction === 'unbekannt' ? 'Deckenbauart unbekannt.' : `${ceilingLabel[c.construction]}: nicht schlitzen${c.construction === 'hourdis' ? ' (Hohlkörper)' : ''}, kein Hohlraum.`);

  // Decke abhängen
  const after = clear - o.suspendDepth;
  if (o.ceilingSuspend === 'nein') add('decke_abhaengen', 'decke', 'nein', 'Abhängen nicht gewünscht/möglich.');
  else if (after < minH) add('decke_abhaengen', 'decke', 'nein', `Lichte Höhe danach ${fmt(after)} cm < ${fmt(minH)} cm (${living ? 'Aufenthaltsraum' : 'Nebenraum'}) – Raum wird zu niedrig.`);
  else if (o.ceilingSuspend === 'ja') add('decke_abhaengen', 'decke', 'ja', `Abhängung ${fmt(o.suspendDepth)} cm, lichte Höhe danach ${fmt(after)} cm.`);
  else add('decke_abhaengen', 'decke', 'bedingt', `Möglich (lichte Höhe danach ${fmt(after)} cm) – gewünscht? Kosten/Aufwand Trockenbau beachten.`);

  // Sockelleiste
  if (o.skirtingAccepted === 'ja') add('sockelleiste', 'sockelleiste', 'ja', 'Sockelleisten-Kabelkanal, nur kurze senkrechte Stiche zu den Dosen.');
  else if (o.skirtingAccepted === 'nein') add('sockelleiste', 'sockelleiste', 'nein', 'Sockelleistenkanal nicht gewünscht.');
  else add('sockelleiste', 'sockelleiste', 'bedingt', 'Möglich, wenn ein Kanal an der Wand optisch passt (nicht hinter Küchenzeile/Möbeln mit Sockel).');

  // Waagerechte Wandschlitze
  const allowed = room.walls.filter((w) => w.horizontalSlotsAllowed);
  if (!allowed.length) add('wand_waagerecht', 'wand_waagerecht', 'nein', 'Keine Wand für waagerechte Schlitze freigegeben (Statik).');
  else {
    const max = normValue(project, 'schlitz.waagerecht.maxTiefe') * 10;
    add('wand_waagerecht', 'wand_waagerecht', max < need ? 'bedingt' : 'ja', `${allowed.length} Wand/Wände freigegeben; ohne statischen Nachweis nur ca. ${fmt(max, 0)} mm tief – ${max < need ? 'für NYM meist zu wenig, Statiker fragen' : 'ausreichend'}.`, 'Nicht über Türstürze.');
  }

  // Aufputz
  const apRoom = room.installationType.startsWith('aufputz');
  if (apRoom || o.surfaceAccepted === 'ja') add('aufputz', 'aufputz', 'ja', apRoom ? 'Aufputz-Installation vorgesehen.' : 'Sichtbare Leitungen akzeptiert.');
  else if (o.surfaceAccepted === 'nein') add('aufputz', 'aufputz', 'nein', 'Sichtbare Leitungen nicht gewünscht.');
  else add('aufputz', 'aufputz', 'bedingt', 'Technisch immer möglich – sichtbar (Rohr/Kanal). Optik klären.');

  // Reihenfolge: in Aufputz-Räumen Aufputz zuerst; sonst unsichtbare Wege zuerst
  const order: RouteOption[] = apRoom
    ? ['aufputz', 'decke', 'boden', 'sockelleiste', 'decke_abhaengen', 'wand_waagerecht']
    : ['decke', 'boden', 'decke_abhaengen', 'sockelleiste', 'wand_waagerecht', 'aufputz'];
  res.sort((a, b) => order.indexOf(a.option) - order.indexOf(b.option));
  const recommended = res.find((r) => r.verdict === 'ja') ?? res.find((r) => r.verdict === 'bedingt') ?? null;
  return { options: res, recommended, clearHeight: clear, minHeight: minH };
}
