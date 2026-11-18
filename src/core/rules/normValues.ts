/**
 * Normwerte und Praxiswerte – zentral, mit Quelle und Bestätigungs-Kennzeichen.
 *
 * WICHTIG: Die Werte sind nach bestem Wissen aus allgemein zugänglichen
 * Darstellungen der Normen übernommen. Normen ändern sich; die Volltexte sind
 * kostenpflichtig und hier nicht hinterlegt. Alle Werte mit
 * `confirm: true` muss die Elektrofachkraft bestätigen. Jeder Wert kann pro
 * Projekt über `settings.normOverrides[key]` überschrieben werden.
 */
import type { Project } from '../model/schema';

export interface NormValue {
  key: string;
  value: number;
  unit: string;
  label: string;
  source: string;
  confirm: boolean;
}

const v = (key: string, value: number, unit: string, label: string, source: string, confirm = true): NormValue => ({
  key, value, unit, label, source, confirm,
});

export const NORM_VALUES: NormValue[] = [
  // DIN 18015-3 Installationszonen (Maße ab Fertigfußboden / fertiger Decke / Rohbaukante)
  v('zone.h.oben.von', 15, 'cm', 'Obere waagerechte Zone: Beginn unter fertiger Decke', 'DIN 18015-3'),
  v('zone.h.oben.bis', 45, 'cm', 'Obere waagerechte Zone: Ende unter fertiger Decke', 'DIN 18015-3'),
  v('zone.h.unten.von', 15, 'cm', 'Untere waagerechte Zone: Beginn über FFB', 'DIN 18015-3'),
  v('zone.h.unten.bis', 45, 'cm', 'Untere waagerechte Zone: Ende über FFB', 'DIN 18015-3'),
  v('zone.h.mitte.von', 90, 'cm', 'Mittlere waagerechte Zone (Arbeitsflächen): Beginn über FFB', 'DIN 18015-3'),
  v('zone.h.mitte.bis', 120, 'cm', 'Mittlere waagerechte Zone (Arbeitsflächen): Ende über FFB', 'DIN 18015-3'),
  v('zone.v.von', 10, 'cm', 'Senkrechte Zone: Beginn neben Rohbauecke/-öffnung', 'DIN 18015-3'),
  v('zone.v.bis', 30, 'cm', 'Senkrechte Zone: Ende neben Rohbauecke/-öffnung', 'DIN 18015-3'),
  // Praxisregeln
  v('schalter.abstandZarge', 15, 'cm', 'Schaltermitte neben Türzarge (Griffseite)', 'Praxisregel', false),
  v('schalter.abstandOhneZarge', 18, 'cm', 'Schaltermitte neben Mauerkante ohne Zarge', 'Praxisregel', false),
  v('schalter.toleranz', 6, 'cm', 'Toleranz für Schalterabstand zur Tür', 'Praxisregel', false),
  v('schalter.suchradius', 80, 'cm', 'Schalter gilt als „Türschalter“ bis zu diesem Abstand von der Öffnung', 'Praxisregel', false),
  v('ecke.minAbstandDosenmitte', 15, 'cm', 'Mindestabstand Dosenmitte zur Raumecke (Rahmen + Putz)', 'Praxisregel', false),
  v('vorwand.randOben', 5, 'cm', 'Mindestabstand Dosenrand zur Oberkante Vorwand', 'Praxisregel', false),
  v('oeffnung.rand', 3, 'cm', 'Mindestabstand Dosenrand zu Tür-/Fensterlaibung', 'Praxisregel', false),
  v('boden.sicherheitZuFolie', 1, 'cm', 'Mindestabstand Schlitzgrund zur Folie/Dämmlage', 'Praxisregel', false),
  // Schlitze im Mauerwerk ohne statischen Nachweis (EC6, NA) – stark abhängig von Wanddicke und Material
  v('schlitz.senkrecht.maxTiefe', 3, 'cm', 'Senkrechte Schlitze ohne Nachweis: max. Tiefe (Wanddicke ≥ 17,5 cm)', 'DIN EN 1996-1-1/NA Tab. NA.19 – vereinfacht'),
  v('schlitz.senkrecht.maxBreite', 10, 'cm', 'Senkrechte Schlitze ohne Nachweis: max. Breite (Einzelschlitz)', 'DIN EN 1996-1-1/NA Tab. NA.19 – vereinfacht'),
  v('schlitz.waagerecht.maxTiefe', 1.5, 'cm', 'Waagerechte Schlitze ohne Nachweis: max. Tiefe (unbeschränkte Länge)', 'DIN EN 1996-1-1/NA Tab. NA.20 – vereinfacht'),
  v('schlitz.waagerecht.maxAbstandDecke', 40, 'cm', 'Waagerechte Schlitze nur in diesem Bereich unter/über Decke', 'DIN EN 1996-1-1/NA – vereinfacht'),
  // Leitungswege (Praxis)
  v('sturz.hoehe', 25, 'cm', 'Angenommene Sturzhöhe über Tür-/Fensteröffnungen (keine waagerechten Schlitze)', 'Praxisregel – vor Ort prüfen', true),
  v('trasse.zuschlag', 10, '%', 'Zuschlag auf berechnete Leitungslänge (Verschnitt, Bögen)', 'Praxisregel', false),
  v('trasse.anschlussreserve', 30, 'cm', 'Leitungsreserve je Dose (zum Anschließen)', 'Praxisregel', false),
  v('trasse.verteilerreserve', 100, 'cm', 'Leitungsreserve in der Verteilung', 'Praxisregel', false),
  v('trasse.kabelabstand', 5, 'mm', 'Abstand zwischen Kabeln im Schlitz (einlagig)', 'Praxisregel', false),
  v('trasse.schlitzzugabe', 10, 'mm', 'Zugabe zur Schlitzbreite (Werkzeug, Fixierung)', 'Praxisregel', false),
  v('trasse.ueberdeckung', 10, 'mm', 'Mindestüberdeckung des Kabels im Schlitz (Mörtel/Putz)', 'Praxisregel', false),
  v('spannungsfall.max', 3, '%', 'Max. Spannungsfall Zähler → Verbraucher (Empfehlung)', 'DIN 18015-1 / DIN VDE 0100-520 Anh. G', true),
  v('spannungsfall.kappa', 56, 'm/(Ω·mm²)', 'Leitfähigkeit Kupfer (bei 20 °C; warm ca. 48)', 'Physik', false),
  v('stromkreis.maxSteckdosen', 8, 'Plätze', 'Steckdosenplätze je Stromkreis (Richtwert)', 'Praxisregel / DIN 18015-2', false),
  v('stromkreis.maxJeRcd', 4, 'Stromkreise', 'Stromkreise je RCD (Fehlerfall: Ausfall begrenzen)', 'Praxisregel / DIN 18015-1', false),
  // Schutzmaßnahmen
  v('rcd.bemessungsdifferenzstrom', 30, 'mA', 'RCD für Steckdosen ≤ 32 A und Endstromkreise für Leuchten in Wohnungen', 'DIN VDE 0100-410:2018-10, 411.3.3'),
];

const byKey = new Map(NORM_VALUES.map((n) => [n.key, n]));

export function normValue(project: Project | undefined, key: string): number {
  const o = project?.settings.normOverrides?.[key];
  if (o != null) return o;
  const n = byKey.get(key);
  if (!n) throw new Error(`Unbekannter Normwert: ${key}`);
  return n.value;
}

export function normInfo(key: string): NormValue | undefined {
  return byKey.get(key);
}
