/**
 * Raumtypen mit typischen Verbrauchern (Leistungsbedarf), Mindestausstattung
 * und Besonderheiten. Werte sind Praxis-/Richtwerte; die Mindestanzahl
 * Steckdosen/Lichtauslässe orientiert sich an DIN 18015-2 (Ausstattungswert 1)
 * und steigt mit dem Ausstattungswert (RAL-RG 678) – vom Elektriker zu bestätigen.
 */

export const ROOM_TYPES = [
  'wohnen', 'schlafen', 'kind', 'gaeste', 'kueche', 'essen', 'bad', 'wc', 'flur', 'buero', 'hwr',
  'heimkino', 'hobby', 'fitness', 'keller', 'technik', 'werkstatt', 'garage', 'abstell', 'aussen', 'sonstiges',
] as const;
export type RoomTypeId = (typeof ROOM_TYPES)[number];

export interface LoadTemplate {
  label: string;
  /** Leistung in W */
  power: number;
  phases: 1 | 3;
  /** Eigener Stromkreis empfohlen */
  dedicated: boolean;
  /** standardmäßig ausgewählt */
  default: boolean;
  /** Art des Anschlusses (für Vorschläge) */
  connection: 'steckdose' | 'anschlussdose' | 'festanschluss' | 'herd' | 'starkstrom';
  /** Montagehöhe über FFB für den Vorschlag */
  height?: number;
}

export interface RoomTypeInfo {
  id: RoomTypeId;
  label: string;
  hint: string;
  /** Mindestanzahl Steckdosen (Einsätze) nach Fläche, Ausstattungswert 1 */
  minSockets: (areaM2: number) => number;
  /** Mindestanzahl Lichtauslässe */
  minLights: (areaM2: number) => number;
  /** Beleuchtungsstärke-Ziel (lx), für spätere Leuchtenplanung */
  lux: number;
  wetRoom?: boolean;
  smokeDetector?: boolean;
  /** AFDD-Empfehlung (Schlafräume) */
  afdd?: boolean;
  installation?: 'unterputz' | 'aufputz_rohr';
  loads: LoadTemplate[];
}

const L = (label: string, power: number, opt: Partial<LoadTemplate> = {}): LoadTemplate => ({ label, power, phases: 1, dedicated: false, default: true, connection: 'steckdose', ...opt });
const step = (pairs: [number, number][], fallback: number) => (a: number) => (pairs.find(([max]) => a <= max)?.[1] ?? fallback);

export const ROOM_TYPE_INFO: Record<RoomTypeId, RoomTypeInfo> = {
  wohnen: { id: 'wohnen', label: 'Wohnzimmer', hint: 'TV, Sofa, Leselampe', minSockets: step([[12, 3], [20, 4]], 5), minLights: step([[20, 1]], 2), lux: 200,
    loads: [L('TV / AV-Anlage', 400), L('Stehleuchten, Laden, Kleingeräte', 300), L('Heizlüfter / Infrarotheizung (gelegentlich)', 1500, { default: false })] },
  schlafen: { id: 'schlafen', label: 'Schlafzimmer', hint: 'Bett, Nachttische, Schrank', minSockets: step([[12, 3], [20, 4]], 5), minLights: () => 1, lux: 150, smokeDetector: true, afdd: true,
    loads: [L('Nachttischlampen, Laden', 100), L('TV', 150, { default: false })] },
  kind: { id: 'kind', label: 'Kinderzimmer', hint: 'Schreibtisch, Bett, Spielen', minSockets: step([[12, 3], [20, 4]], 5), minLights: () => 1, lux: 300, smokeDetector: true, afdd: true,
    loads: [L('Schreibtisch / PC', 300), L('Leselampe, Laden', 100)] },
  gaeste: { id: 'gaeste', label: 'Gästezimmer', hint: 'Bett, evtl. Arbeitsplatz', minSockets: step([[12, 3]], 4), minLights: () => 1, lux: 150, smokeDetector: true, afdd: true,
    loads: [L('Laden, Leselampe', 100), L('Schreibtisch / PC', 300, { default: false })] },
  kueche: { id: 'kueche', label: 'Küche', hint: 'Herd, Spülmaschine, Kühlschrank, Arbeitsfläche', minSockets: () => 5, minLights: () => 2, lux: 500,
    loads: [
      L('Kochfeld / Herd', 11000, { phases: 3, dedicated: true, connection: 'herd', height: 40 }),
      L('Backofen', 3500, { dedicated: true, default: false, connection: 'steckdose', height: 40 }),
      L('Spülmaschine', 2200, { dedicated: true, height: 40 }),
      L('Kühlschrank', 150, { dedicated: true, height: 200 }),
      L('Mikrowelle', 1200, { default: false, height: 115 }),
      L('Wasserkocher / Kaffeemaschine (Arbeitsfläche)', 2200, { height: 115 }),
      L('Dunstabzug', 250, { height: 205 }),
      L('Gefrierschrank', 150, { dedicated: true, default: false }),
    ] },
  essen: { id: 'essen', label: 'Esszimmer', hint: 'Tisch, Pendelleuchte', minSockets: step([[12, 3]], 4), minLights: () => 1, lux: 200, loads: [L('Kleingeräte (Raclette, Fondue)', 1500, { default: false })] },
  bad: { id: 'bad', label: 'Bad', hint: 'Dusche/Wanne, Waschtisch, Lüfter', minSockets: () => 2, minLights: () => 2, lux: 300, wetRoom: true,
    loads: [L('Föhn', 2000, { height: 105 }), L('Lüfter mit Nachlauf', 30, { connection: 'anschlussdose' }), L('Handtuchheizkörper elektrisch', 600, { default: false, connection: 'anschlussdose' }), L('Dusch-WC', 1500, { default: false, height: 40 }), L('Waschmaschine', 2200, { dedicated: true, default: false, height: 105 }), L('Durchlauferhitzer', 21000, { phases: 3, dedicated: true, default: false, connection: 'anschlussdose' })] },
  wc: { id: 'wc', label: 'WC / Gäste-WC', hint: 'Waschbecken, Lüfter', minSockets: () => 1, minLights: () => 1, lux: 200, wetRoom: true,
    loads: [L('Lüfter mit Nachlauf', 30, { connection: 'anschlussdose' }), L('Kleindurchlauferhitzer', 3500, { dedicated: true, default: false, connection: 'anschlussdose' })] },
  flur: { id: 'flur', label: 'Flur / Diele', hint: 'mehrere Türen, Taster', minSockets: step([[3, 1]], 2), minLights: step([[4, 1]], 2), lux: 100, smokeDetector: true,
    loads: [L('Staubsauger', 1200)] },
  buero: { id: 'buero', label: 'Büro / Arbeitszimmer', hint: 'Schreibtisch, Monitore, Drucker, LAN', minSockets: step([[12, 4]], 6), minLights: () => 1, lux: 500,
    loads: [L('PC, Monitore', 400), L('Drucker', 50), L('Höhenverstellbarer Tisch', 150, { default: false }), L('Klimagerät mobil', 1000, { default: false })] },
  hwr: { id: 'hwr', label: 'Hauswirtschaftsraum', hint: 'Waschmaschine, Trockner, Bügeln', minSockets: () => 3, minLights: () => 1, lux: 300, wetRoom: true,
    loads: [L('Waschmaschine', 2200, { dedicated: true, height: 105 }), L('Trockner (Wärmepumpe)', 1000, { dedicated: true, height: 105 }), L('Bügeleisen', 2200), L('Gefriertruhe', 150, { dedicated: true, default: false })] },
  heimkino: { id: 'heimkino', label: 'Heimkino / Medienraum', hint: 'Beamer, AV-Rack, Lautsprecher', minSockets: step([[20, 4]], 6), minLights: () => 1, lux: 50,
    loads: [L('AV-Receiver / Verstärker', 800, { dedicated: true }), L('Beamer', 350), L('Subwoofer', 500), L('Spielekonsole / Streaming', 200)] },
  hobby: { id: 'hobby', label: 'Hobby- / Partyraum', hint: 'Musik, Bar, Spielen', minSockets: step([[20, 4]], 6), minLights: () => 1, lux: 200,
    loads: [L('Musikanlage', 500), L('Kühlschrank / Getränke', 150, { dedicated: false }), L('Heizlüfter (gelegentlich)', 2000, { default: false })] },
  fitness: { id: 'fitness', label: 'Fitnessraum', hint: 'Laufband, Ergometer', minSockets: () => 3, minLights: () => 1, lux: 300,
    loads: [L('Laufband', 2000, { dedicated: true }), L('Ergometer, TV', 300)] },
  keller: { id: 'keller', label: 'Kellerraum / Lager', hint: 'Regale, Gefriertruhe', minSockets: () => 1, minLights: () => 1, lux: 100, installation: 'aufputz_rohr',
    loads: [L('Gefriertruhe', 150, { dedicated: true, default: false, height: 105 }), L('Luftentfeuchter', 400, { default: false, height: 105 })] },
  technik: { id: 'technik', label: 'Technik / Hausanschluss', hint: 'Heizung, Verteilung, Netzwerk', minSockets: () => 2, minLights: () => 1, lux: 200, installation: 'aufputz_rohr',
    loads: [L('Heizung / Wärmepumpe (Steuerung)', 300, { dedicated: true, connection: 'anschlussdose' }), L('Netzwerk / Server', 150), L('Wärmepumpe Außengerät', 5000, { phases: 3, dedicated: true, default: false, connection: 'anschlussdose' })] },
  werkstatt: { id: 'werkstatt', label: 'Werkstatt', hint: 'Werkbank, Elektrowerkzeuge', minSockets: () => 3, minLights: () => 2, lux: 500, installation: 'aufputz_rohr',
    loads: [L('Elektrowerkzeuge', 2000, { height: 105 }), L('Kompressor', 1500, { default: false, height: 105 }), L('Kreissäge / Maschinen (Drehstrom)', 4000, { phases: 3, dedicated: true, default: false, connection: 'starkstrom', height: 105 })] },
  garage: { id: 'garage', label: 'Garage / Carport', hint: 'Wallbox, Torantrieb', minSockets: () => 1, minLights: () => 1, lux: 100, installation: 'aufputz_rohr',
    loads: [L('Wallbox 11 kW', 11000, { phases: 3, dedicated: true, connection: 'festanschluss', height: 125 }), L('Torantrieb', 300, { connection: 'steckdose' }), L('CEE-Steckdose 16 A', 11000, { phases: 3, dedicated: true, default: false, connection: 'starkstrom', height: 105 }), L('Werkzeuge, Staubsauger', 2000, { height: 105 })] },
  abstell: { id: 'abstell', label: 'Abstellraum', hint: 'Regale', minSockets: () => 1, minLights: () => 1, lux: 100, loads: [L('Staubsauger-Ladestation', 100, { default: false })] },
  aussen: { id: 'aussen', label: 'Außenbereich / Garten', hint: 'Terrasse, Garten, Pumpe', minSockets: () => 1, minLights: () => 1, lux: 20,
    loads: [L('Rasenmäher, Gartengeräte', 1500), L('Teich-/Brunnenpumpe', 500, { default: false }), L('Außenbeleuchtung', 100)] },
  sonstiges: { id: 'sonstiges', label: 'Sonstiges', hint: 'frei', minSockets: () => 2, minLights: () => 1, lux: 200, loads: [] },
};

/** Raumtyp aus Name/Nutzung erraten (für Bestandsprojekte ohne Typ). */
export function guessRoomType(text: string): RoomTypeId | undefined {
  const t = text.toLowerCase();
  const pairs: [RegExp, RoomTypeId][] = [
    [/heimkino|kino|medien/, 'heimkino'], [/küche|kueche/, 'kueche'], [/gäste-?wc|^wc|\bwc\b/, 'wc'], [/bad|dusche/, 'bad'],
    [/kind/, 'kind'], [/gäst|gaest/, 'gaeste'], [/schlaf/, 'schlafen'], [/büro|buero|arbeit/, 'buero'], [/party|hobby|spiel/, 'hobby'],
    [/fitness|sport/, 'fitness'], [/flur|diele|gang/, 'flur'], [/hwr|hauswirtschaft|wasch/, 'hwr'], [/garage|carport/, 'garage'],
    [/werkstatt/, 'werkstatt'], [/technik|heizung|hausanschluss/, 'technik'], [/abstell/, 'abstell'], [/garten|terrasse|außen/, 'aussen'],
    [/wohn/, 'wohnen'], [/ess/, 'essen'], [/keller|lager/, 'keller'],
  ];
  return pairs.find(([re]) => re.test(t))?.[1];
}
