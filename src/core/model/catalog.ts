/** Katalog: Möbel/Geräte mit Standardmaßen und Schalterprogramme (frei erweiterbar). */
export interface FurnitureType { kind: string; label: string; w: number; d: number; height: number }

export const FURNITURE_TYPES: FurnitureType[] = [
  { kind: 'bett', label: 'Bett', w: 180, d: 200, height: 45 },
  { kind: 'nachttisch', label: 'Nachttisch', w: 45, d: 40, height: 55 },
  { kind: 'schrank', label: 'Kleiderschrank', w: 200, d: 60, height: 220 },
  { kind: 'schreibtisch', label: 'Schreibtisch', w: 160, d: 80, height: 75 },
  { kind: 'sofa', label: 'Sofa', w: 220, d: 95, height: 85 },
  { kind: 'tv', label: 'TV-Board', w: 180, d: 45, height: 50 },
  { kind: 'tisch', label: 'Esstisch', w: 160, d: 90, height: 75 },
  { kind: 'kuechenzeile', label: 'Küchenzeile', w: 60, d: 240, height: 90 },
  { kind: 'kuehlschrank', label: 'Kühlschrank', w: 60, d: 65, height: 185 },
  { kind: 'side_by_side', label: 'Side-by-Side-Kühlschrank', w: 91, d: 72, height: 178 },
  { kind: 'backofen', label: 'Backofen (Hochschrank)', w: 60, d: 60, height: 200 },
  { kind: 'spuelmaschine', label: 'Spülmaschine', w: 60, d: 60, height: 82 },
  { kind: 'waschtisch', label: 'Waschtisch', w: 60, d: 50, height: 85 },
  { kind: 'wc', label: 'WC', w: 40, d: 56, height: 40 },
  { kind: 'dusche', label: 'Dusche', w: 90, d: 90, height: 200 },
  { kind: 'badewanne', label: 'Badewanne', w: 170, d: 75, height: 60 },
  { kind: 'waschmaschine', label: 'Waschmaschine', w: 60, d: 60, height: 85 },
  { kind: 'trockner', label: 'Trockner', w: 60, d: 60, height: 85 },
  { kind: 'rack', label: 'Rack / Netzwerkschrank', w: 60, d: 60, height: 120 },
  { kind: 'beamer', label: 'Beamer', w: 40, d: 35, height: 15 },
  { kind: 'lautsprecher', label: 'Lautsprecher', w: 25, d: 30, height: 100 },
  { kind: 'werkbank', label: 'Werkbank', w: 200, d: 70, height: 90 },
  { kind: 'regal', label: 'Regal', w: 100, d: 40, height: 200 },
  { kind: 'fitness', label: 'Fitnessgerät', w: 80, d: 180, height: 140 },
  { kind: 'auto', label: 'Auto', w: 185, d: 470, height: 150 },
  { kind: 'sonstiges', label: 'Sonstiges', w: 50, d: 50, height: 50 },
];

export const SWITCH_PROGRAMS = [
  'Merten (Schneider Electric) System M',
  'Merten (Schneider Electric) System Design / D-Life',
  'Gira E2 / Standard 55',
  'Jung LS 990 / A 550',
  'Busch-Jaeger future linear',
  'Berker S.1 / Q.1',
  'Siemens Delta',
  'Hager Kallysta',
];
