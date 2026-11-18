/**
 * Kabel- und Leerrohrkatalog. Außendurchmesser und Gebinde sind typische
 * Herstellerwerte (Richtwerte, je Fabrikat verschieden) – für Schlitzbreite und
 * Bestellmenge genügt das; maßgeblich ist das Datenblatt des gekauften Kabels.
 */

export interface CableType {
  id: string;
  label: string;
  /** Außendurchmesser in mm (Richtwert). */
  diameter: number;
  /** Querschnitt Außenleiter in mm² (für Spannungsfall); 0 = Daten/Signal. */
  crossSection: number;
  /** Übliche Gebinde in m (aufsteigend). */
  packs: number[];
  kind: 'energie' | 'erdkabel' | 'daten' | 'audio' | 'steuer' | 'video';
}

export const CABLES: CableType[] = [
  { id: 'NYM-J 3×1,5', label: 'NYM-J 3×1,5 mm²', diameter: 8.5, crossSection: 1.5, packs: [50, 100], kind: 'energie' },
  { id: 'NYM-J 3×2,5', label: 'NYM-J 3×2,5 mm²', diameter: 10, crossSection: 2.5, packs: [50, 100], kind: 'energie' },
  { id: 'NYM-J 5×1,5', label: 'NYM-J 5×1,5 mm²', diameter: 10, crossSection: 1.5, packs: [50, 100], kind: 'energie' },
  { id: 'NYM-J 5×2,5', label: 'NYM-J 5×2,5 mm²', diameter: 11.5, crossSection: 2.5, packs: [50, 100], kind: 'energie' },
  { id: 'NYM-J 5×4', label: 'NYM-J 5×4 mm²', diameter: 13.5, crossSection: 4, packs: [25, 50], kind: 'energie' },
  { id: 'NYM-J 5×6', label: 'NYM-J 5×6 mm²', diameter: 15, crossSection: 6, packs: [25, 50], kind: 'energie' },
  { id: 'NYM-J 5×10', label: 'NYM-J 5×10 mm²', diameter: 18.5, crossSection: 10, packs: [25, 50], kind: 'energie' },
  { id: 'NYY-J 3×2,5', label: 'NYY-J 3×2,5 mm² (Erdkabel)', diameter: 12, crossSection: 2.5, packs: [50], kind: 'erdkabel' },
  { id: 'NYY-J 5×4', label: 'NYY-J 5×4 mm² (Erdkabel)', diameter: 16, crossSection: 4, packs: [25, 50], kind: 'erdkabel' },
  { id: 'NYY-J 5×6', label: 'NYY-J 5×6 mm² (Erdkabel)', diameter: 17.5, crossSection: 6, packs: [25, 50], kind: 'erdkabel' },
  { id: 'Cat.7', label: 'Verlegekabel Cat.7 S/FTP', diameter: 7.5, crossSection: 0, packs: [50, 100, 500], kind: 'daten' },
  { id: 'LS 2×2,5', label: 'Lautsprecherkabel 2×2,5 mm²', diameter: 7, crossSection: 0, packs: [25, 50, 100], kind: 'audio' },
  { id: 'J-Y(St)Y 2×2×0,8', label: 'J-Y(St)Y 2×2×0,8 (Steuer/KNX)', diameter: 5, crossSection: 0, packs: [50, 100], kind: 'steuer' },
  { id: 'Koax', label: 'Koaxialkabel SAT (Klasse A+)', diameter: 7, crossSection: 0, packs: [50, 100], kind: 'video' },
  { id: 'HDMI optisch', label: 'HDMI-Glasfaserkabel (Länge nach Bedarf)', diameter: 5, crossSection: 0, packs: [5, 10, 15, 20, 25, 30], kind: 'video' },
];

export function cableById(id: string): CableType {
  return CABLES.find((c) => c.id === id) ?? CABLES.find((c) => id.replace(/\s/g, '').startsWith(c.id.replace(/\s/g, ''))) ?? { id, label: id, diameter: 10, crossSection: 1.5, packs: [50, 100], kind: 'energie' };
}

/** Bestellmenge: auf Gebinde aufrunden (kleinste Gebindekombination ≥ Bedarf). */
export function packsFor(cable: CableType, meters: number): { packs: number[]; total: number } {
  if (meters <= 0) return { packs: [], total: 0 };
  const sizes = [...cable.packs].sort((a, b) => b - a);
  const big = sizes[0];
  const out: number[] = [];
  let rest = meters;
  while (rest > big) { out.push(big); rest -= big; }
  const fit = [...sizes].reverse().find((s) => s >= rest) ?? big;
  out.push(fit);
  return { packs: out, total: out.reduce((a, b) => a + b, 0) };
}

/** Steckermaße (Breite × Höhe in mm) für die Leerrohr-Prüfung. */
export const CONNECTORS: Record<string, { w: number; h: number; label: string }> = {
  hdmi: { w: 21, h: 11, label: 'HDMI-Stecker' },
  hdmi_glasfaser_klein: { w: 9, h: 6, label: 'HDMI-Glasfaser mit abnehmbarem Stecker (Micro-Seite)' },
  rj45: { w: 12, h: 14, label: 'RJ45 mit Knickschutz' },
  usb_c: { w: 9, h: 4, label: 'USB-C' },
  schuko: { w: 37, h: 37, label: 'Schukostecker' },
};

/** Leerrohr-Innendurchmesser (mm, Richtwerte Wellrohr/Flexrohr). */
export const CONDUITS: Record<string, number> = { M16: 10.7, M20: 14.1, M25: 18.3, M32: 24.3, M40: 31.2, M50: 39.6 };

/** Passt ein Stecker durch das Leerrohr? Diagonale + 2 mm Luft gegen Innendurchmesser. */
export function connectorFits(connector: keyof typeof CONNECTORS, conduit: keyof typeof CONDUITS): { fits: boolean; need: number; inner: number } {
  const c = CONNECTORS[connector];
  const need = Math.round((Math.hypot(c.w, c.h) + 2) * 10) / 10;
  const inner = CONDUITS[conduit];
  return { fits: need <= inner, need, inner };
}
