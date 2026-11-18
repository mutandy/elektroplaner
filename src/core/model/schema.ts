/**
 * Datenmodell des Elektroplaners – die EINZIGE Datenquelle.
 *
 * Alle Pläne, Tabellen und Listen werden aus einem `Project` berechnet und nie
 * gespeichert. Jede Änderung am Schema erhöht SCHEMA_VERSION und braucht eine
 * Migration in `migrate.ts`.
 *
 * Koordinaten und Bezugssystem (überall gleich):
 *  - Einheit: Zentimeter.
 *  - Raum-Koordinaten: Nullpunkt = erste Ecke des Raumpolygons, x nach rechts,
 *    y nach unten (Bildschirm-/Plan-Richtung).
 *  - Das Raumpolygon läuft im Plan IM UHRZEIGERSINN. Wand i geht von Ecke i zu
 *    Ecke i+1. Steht man im Raum und blickt auf diese Wand, liegt ihr Anfang
 *    LINKS. Alle Abstände auf einer Wand (`s`) werden ab diesem linken Ende
 *    gemessen („ab linker Ecke, Blick auf die Wand von innen“).
 *  - Höhen (`z`) werden immer über dem projektweiten Höhenbezug angegeben
 *    (z. B. „OK Rohboden“ oder „OK Estrich Bestand“). Der künftige
 *    Bodenaufbau des Raums wird eingerechnet, um „über Fertigfußboden (FFB)“
 *    anzuzeigen.
 */
import { z } from 'zod';
import { ROOM_TYPES } from './roomTypes';

export const SCHEMA_VERSION = 5;

const id = z.string().min(1);
const cm = z.number().finite();
const posCm = z.number().finite().nonnegative();

/** Kennzeichnung, ob ein Wert angenommen ist und noch geprüft werden muss. */
export const Provenance = z.enum(['gemessen', 'aus_plan', 'annahme']);

// ---------------------------------------------------------------------------
// Projekt-Rahmen
// ---------------------------------------------------------------------------

export const ProjectType = z.enum(['neubau', 'bestand_komplett', 'teilsanierung']);
export const BuildingType = z.enum(['efh', 'dhh', 'rh', 'mfh', 'einliegerwohnung', 'sonstiges']);
export const Bundesland = z.enum([
  'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH',
]);
export const NetForm = z.enum(['TN-C-S', 'TN-S', 'TT', 'unbekannt']);

export const InstallationType = z.enum([
  'unterputz',
  'aufputz_nym_schellen',
  'aufputz_rohr',
  'aufputz_kanal',
  'hohlwand',
  'vorwand',
]);

export const SmartHomeSystem = z.enum([
  'keines',
  'knx',
  'home_assistant',
  'shelly',
  'zigbee',
  'matter_thread',
  'homematic_ip',
  'gemischt',
]);

export const SmartHomeConfig = z.object({
  /** Soll Smart Home überhaupt eingeplant werden? */
  enabled: z.boolean().default(false),
  system: SmartHomeSystem.default('keines'),
  /** Zentrale/Server (z. B. Home Assistant auf Mini-PC), falls vorhanden. */
  central: z.string().default(''),
  /** Grundsätze, die in der Planung berücksichtigt werden. */
  neutralInSwitchBoxes: z.boolean().default(true),
  deepBoxesForActuators: z.boolean().default(true),
  /** KNX: Busleitung zu jeder Schaltstelle mitführen. */
  busCableToSwitches: z.boolean().default(false),
  /** Dimmen in der Leuchte statt Wanddimmer, Dauerstrom zur Leuchte. */
  dimInLuminaire: z.boolean().default(true),
  notes: z.string().default(''),
});

export const SwitchProgram = z.object({
  manufacturer: z.string().default('Merten (Schneider Electric)'),
  series: z.string().default('System M'),
  color: z.string().default('polarweiß glänzend'),
  /** Feuchtraum-/Aufputz-Programm für Keller und Garage. */
  wetRoomSeries: z.string().default('Merten Aquastar (AP, IP44)'),
});

export const DefaultHeights = z.object({
  /** Alle Werte: Dosenmitte über FERTIGFUSSBODEN. */
  steckdose: cm.default(30),
  schalter: cm.default(105),
  kuecheArbeitsflaeche: cm.default(115),
  nachttisch: cm.default(70),
  aufputzKeller: cm.default(105),
  lan: cm.default(30),
});

export const BoxConvention = z.enum([
  /** Erste Dose an der Position (z. B. unter dem Schalter), weitere weg von der Tür. */
  'erste_an_position',
  /** Die Position ist die Mitte der gesamten Kombination. */
  'mittig',
]);

export const HeightReference = z.object({
  label: z.string().default('OK Rohboden'),
  description: z.string().default('Alle Höhen beziehen sich auf die heutige Oberkante Rohboden.'),
});

export const Settings = z.object({
  heightReference: HeightReference.default({}),
  defaultHeights: DefaultHeights.default({}),
  boxConvention: BoxConvention.default('erste_an_position'),
  /** Achsabstand bei Mehrfachkombinationen (Normmaß 71 mm). */
  boxPitch: cm.default(7.1),
  /** Bohrdurchmesser für UP-/Hohlwanddosen. */
  boxDrill: cm.default(6.8),
  switchProgram: SwitchProgram.default({}),
  /** Vorgaben für neu angelegte Räume (aus dem Assistenten). */
  defaultInstallationType: InstallationType.default('unterputz'),
  defaultFutureBuildup: cm.nonnegative().default(0),
  /** Überschreibt Normwerte aus der Regelbasis (Schlüssel siehe rules/normValues.ts). */
  normOverrides: z.record(z.string(), z.number()).default({}),
  /** Normwerte, die die Elektrofachkraft bestätigt hat (Schlüssel → „Name, Datum“). */
  confirmedNorms: z.record(z.string(), z.string()).default({}),
  /** Regeln, die bewusst deaktiviert wurden (mit Begründung). */
  disabledRules: z.record(z.string(), z.string()).default({}),
});

// ---------------------------------------------------------------------------
// Verteilung
// ---------------------------------------------------------------------------

export const BreakerChar = z.enum(['B', 'C', 'D']);

export const BreakerGroup = z.object({
  id,
  characteristic: BreakerChar,
  ratedCurrent: z.number().positive(),
  poles: z.union([z.literal(1), z.literal(3)]).default(1),
  /** Anzahl vorhandener Geräte dieser Art. */
  count: z.number().int().nonnegative(),
  /** Davon frei verfügbar für diese Planung. */
  free: z.number().int().nonnegative(),
  rcdId: z.string().optional(),
  note: z.string().default(''),
});

export const Rcd = z.object({
  id,
  label: z.string(),
  ratedCurrent: z.number().positive().default(40),
  residualCurrent: z.number().positive().default(30), // mA
  type: z.enum(['A', 'F', 'B', 'EV']).default('A'),
  poles: z.union([z.literal(2), z.literal(4)]).default(4),
  existing: z.boolean().default(true),
});

export const Distribution = z.object({
  id,
  name: z.string(),
  kind: z.enum(['HV', 'UV', 'Zaehlerschrank']),
  roomId: z.string().optional(),
  /** Versorgt aus (bei UV). */
  feedFromId: z.string().optional(),
  feedCable: z.string().default(''),
  feedFuse: z.string().default(''),
  mainFuse: z.string().default(''),
  netForm: NetForm.default('unbekannt'),
  meter: z.string().default(''),
  freeModules: z.number().int().nonnegative().default(0),
  breakers: z.array(BreakerGroup).default([]),
  rcds: z.array(Rcd).default([]),
  hasSpd: z.boolean().default(false),
  photos: z.array(z.string()).default([]),
  note: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Raum, Wände, Öffnungen
// ---------------------------------------------------------------------------

export const WallMaterial = z.enum([
  'bims', 'kalksandstein', 'beton', 'ziegel', 'porenbeton', 'trockenbau', 'holz', 'unbekannt',
]);

export const WallZoneKind = z.enum([
  /** Kaminwange / Schornstein: niemals schlitzen, keine Dosen. */
  'kaminwange',
  /** Brandwand / Brandabschnitt: Durchführungen nur mit Abschottung. */
  'brandwand',
  /** Betonsturz o. Ä.: nicht schlitzen. */
  'sturz',
  /** Sonstiger Bereich ohne Schlitze. */
  'tabu',
]);

export const WallZone = z.object({
  id,
  kind: WallZoneKind,
  /** Bereich auf der Wand, ab linker Ecke. */
  from: posCm,
  to: posCm,
  zFrom: cm.default(0),
  zTo: cm.optional(),
  /** Bei Kaminwange: Vorsprung in den Raum. */
  depth: cm.default(0),
  note: z.string().default(''),
});

export const PreWallSection = z.object({
  id,
  from: posCm,
  to: posCm,
  /** Höhe über Bezug; `null` = raumhoch. */
  height: cm.nullable(),
  depth: cm.default(20),
  construction: z.enum(['trockenbau', 'installationsregister', 'holz', 'gemauert']).default('trockenbau'),
  label: z.string().default(''),
});

export const Wall = z.object({
  /** Index in der Polygonreihenfolge (Wand i: Ecke i → Ecke i+1). */
  index: z.number().int().nonnegative(),
  label: z.string().default(''),
  material: WallMaterial.default('unbekannt'),
  exterior: z.boolean().default(false),
  loadBearing: z.boolean().default(false),
  /** Waagerechte Schlitze in dieser Wand zulässig/gewollt? */
  horizontalSlotsAllowed: z.boolean().default(false),
  zones: z.array(WallZone).default([]),
  preWall: z.array(PreWallSection).default([]),
  note: z.string().default(''),
});

export const Door = z.object({
  id,
  wallIndex: z.number().int().nonnegative(),
  /** Linke Kante der Rohbauöffnung, ab linker Wandecke (Blick von innen). */
  s: posCm,
  width: cm.positive(),
  height: cm.positive().default(201),
  /** Bandseite, Blick von innen auf die Wand. */
  hinge: z.enum(['links', 'rechts']),
  swing: z.enum(['innen', 'aussen']),
  hasFrame: z.boolean().default(true),
  /** Brandschutz: z. B. T30 / FH-Tür → Wand ist Brandabschnitt. */
  fireRating: z.enum(['keine', 'T30', 'T60', 'T90', 'RS']).default('keine'),
  leadsToRoomId: z.string().optional(),
  leadsTo: z.string().default(''),
  isMainEntrance: z.boolean().default(false),
  provenance: Provenance.default('gemessen'),
});

export const Window = z.object({
  id,
  wallIndex: z.number().int().nonnegative(),
  s: posCm,
  width: cm.positive(),
  /** Brüstungshöhe über Bezug. */
  sill: cm.nonnegative(),
  height: cm.positive(),
  status: z.enum(['bleibt', 'wird_zugemauert', 'wird_ersetzt', 'neu']).default('bleibt'),
  lightWell: z.boolean().default(false),
  provenance: Provenance.default('gemessen'),
});

export const Obstacle = z.object({
  id,
  kind: z.enum(['heizkoerper', 'rohr', 'rohrkasten', 'schacht', 'stuetze', 'tor', 'torlaufschiene', 'sonstiges']),
  label: z.string().default(''),
  /** Grundriss-Rechteck in Raumkoordinaten. */
  x: cm, y: cm, w: cm.positive(), d: cm.positive(),
  zFrom: cm.default(0),
  zTo: cm.optional(),
  /** Liegt an Wand (für Abwicklungen). */
  wallIndex: z.number().int().nonnegative().optional(),
  note: z.string().default(''),
});

export const FloorLayer = z.object({
  name: z.string(),
  thickness: cm.nonnegative(),
});

export const Floor = z.object({
  /** Aufbau unterhalb des Höhenbezugs, von oben nach unten (Bestand). */
  existingBelowRef: z.array(FloorLayer).default([]),
  /** Künftiger Aufbau über dem Höhenbezug (Ausgleich, Belag …). */
  futureAboveRef: z.array(FloorLayer).default([]),
  /** Tiefe ab Bezug, in der Folie/Dämmung/FBH beginnt (nie anschneiden). */
  protectedLayerDepth: cm.nullable().default(null),
  /** Max. zulässige Bodenschlitztiefe ab Bezug. */
  maxSlotDepth: cm.default(0),
  underfloorHeating: z.boolean().default(false),
  slotsAllowed: z.boolean().default(false),
  note: z.string().default(''),
});

export const Ceiling = z.object({
  construction: z.enum(['stahlbeton', 'hourdis', 'holzbalken', 'abgehaengt', 'filigran', 'unbekannt']).default('unbekannt'),
  slotsAllowed: z.boolean().default(false),
  drillingAllowed: z.boolean().default(true),
  /** Abgehängte Decke / Paneele auf Lattung → Hohlraum als Kabelweg. */
  cavityDepth: cm.default(0),
  note: z.string().default(''),
});

export const Furniture = z.object({
  id,
  kind: z.string(), // freie Typen, Katalog in model/catalog.ts
  label: z.string().default(''),
  x: cm, y: cm, w: cm.positive(), d: cm.positive(),
  height: cm.default(0),
  /** An welcher Wand steht das Möbel (für Abwicklungen). */
  wallIndex: z.number().int().nonnegative().optional(),
  note: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Auslässe (Dosen, Deckenauslässe …)
// ---------------------------------------------------------------------------

export const OutletKind = z.enum([
  'steckdose',
  'schalter',
  'taster',
  'bewegungsmelder',
  'lan',
  'tv_sat',
  'lautsprecher',
  'anschlussdose',
  'herd',
  'licht_decke',
  'licht_wand',
  'rauchwarnmelder',
  'leerdose',
  'klingel',
  'starkstrom',
  'sonstiges',
]);

export const BoxType = z.enum([
  'up_tief',
  'up',
  'hohlwand',
  'aufputz',
  'aufputz_holz',
  'vorwand',
  'bestand',
  'decke_beton',
  'decke_hohl',
]);

export const InsertType = z.enum([
  'steckdose',
  'steckdose_usb',
  'steckdose_klappdeckel',
  'ausschalter',
  'wechselschalter',
  'kreuzschalter',
  'serienschalter',
  'taster',
  'jalousietaster',
  'dimmer',
  'smart_taster',
  'knx_taster',
  'aktor_unterputz',
  'lan_1fach',
  'lan_2fach',
  'tv_sat',
  'lautsprecher_klemme',
  'blind',
  'geraeteanschluss',
  'sonstiges',
]);

export const Outlet = z.object({
  id,
  /** Kurzbezeichnung im Plan, z. B. „B6“. */
  label: z.string(),
  kind: OutletKind,
  mount: z.enum(['wand', 'decke', 'boden']),
  wallIndex: z.number().int().nonnegative().optional(),
  /** Wand: Position ab linker Wandecke (siehe Settings.boxConvention). */
  s: cm.optional(),
  /** Dosenmitte über Bezug (Wand) bzw. Montagehöhe. */
  z: cm.optional(),
  /** Decke/Boden: Raumkoordinaten. */
  x: cm.optional(),
  y: cm.optional(),
  gangs: z.number().int().min(1).max(6).default(1),
  orientation: z.enum(['waagerecht', 'senkrecht']).default('waagerecht'),
  /** Wachstumsrichtung der Kombination (bei „erste_an_position“). */
  growth: z.enum(['rechts', 'links', 'oben', 'unten']).default('rechts'),
  /** Überschreibt die Projektkonvention für diesen Auslass. */
  convention: BoxConvention.optional(),
  boxType: BoxType.default('up_tief'),
  inserts: z.array(InsertType).default([]),
  circuitId: z.string().optional(),
  /** Schaltet welche(n) Auslass/Auslässe (für Schalter/Taster). */
  controls: z.array(z.string()).default([]),
  smart: z.boolean().default(false),
  status: z.enum(['neu', 'bestand_bleibt', 'bestand_wird_ersetzt', 'bestand_entfaellt']).default('neu'),
  note: z.string().default(''),
});

export const ExistingCable = z.object({
  id,
  label: z.string().default(''),
  description: z.string().default(''),
  cableType: z.string().default('unbekannt'),
  fromOutletId: z.string().optional(),
  goesTo: z.string().default(''),
  condition: z.enum(['unbekannt', 'gut', 'fraglich', 'defekt']).default('unbekannt'),
  reuse: z.enum(['pruefen', 'ja', 'nein']).default('pruefen'),
  note: z.string().default(''),
});

export const RoomType = z.enum(ROOM_TYPES);

/** Verbraucher im Raum (Leistungsbedarf). */
export const Load = z.object({
  id,
  label: z.string(),
  /** Leistung in W */
  power: z.number().nonnegative(),
  phases: z.union([z.literal(1), z.literal(3)]).default(1),
  /** eigener Stromkreis */
  dedicated: z.boolean().default(false),
  connection: z.enum(['steckdose', 'anschlussdose', 'herd', 'starkstrom']).default('steckdose'),
  /** Auslass, an dem der Verbraucher hängt (falls zugeordnet) */
  outletId: z.string().optional(),
  /** Montagehöhe über FFB für den Anschlussvorschlag */
  height: z.number().optional(),
});

/** Wie Leitungen im Raum geführt werden. */
export const RoutingStrategy = z.enum([
  /** Programm wählt: Aufputz → Bodenschlitz → Decke → waagerechte Wandschlitze. */
  'auto',
  /** Bodenschlitz-Trasse vor der Wand, Stiche senkrecht zu den Dosen. */
  'boden',
  /** Über Decke/Deckenhohlraum, senkrechte Wandschlitze von oben. */
  'decke',
  /** Waagerechte Wandschlitze in der oberen Installationszone. */
  'wand_waagerecht',
  /** Aufputz: Rohr/Kanal ca. 20 cm unter der Decke, senkrecht zu den Auslässen. */
  'aufputz',
]);

export const RoomRouting = z.object({
  strategy: RoutingStrategy.default('auto'),
  /** Abstand der Bodenschlitz-Trasse von der Wand (Achse). */
  floorOffset: cm.positive().default(12),
  /** Abstand der Aufputz-Trasse unter der Decke. */
  surfaceBelowCeiling: cm.positive().default(20),
  /** Wo die Leitungen in den Raum kommen (Standard: neben der Haupttür, Griffseite). */
  entry: z.object({ wallIndex: z.number().int().nonnegative(), s: cm }).optional(),
});

export const Room = z.object({
  id,
  floorId: z.string(),
  /** Neue Bezeichnung / Nutzung nach der Planung. */
  name: z.string(),
  /** Bezeichnung im Bestandsplan (bleibt erhalten, wenn der Raum umgenutzt wird). */
  formerName: z.string().default(''),
  usage: z.string().default(''),
  futureUsage: z.string().default(''),
  /** Raumtyp (bestimmt typische Verbraucher, Mindestausstattung, Regeln). */
  roomType: RoomType.optional(),
  /** Verbraucher mit Leistung. */
  loads: z.array(Load).default([]),
  /** Lage des Raum-Nullpunkts im Geschoss (für die Gesamtansicht). */
  originOnFloor: z.object({ x: cm, y: cm }).default({ x: 0, y: 0 }),
  /** Raumpolygon (Rohbaumaße), im Uhrzeigersinn, erste Ecke = Nullpunkt. */
  polygon: z.array(z.object({ x: cm, y: cm })).min(3),
  height: cm.positive(),
  walls: z.array(Wall),
  doors: z.array(Door).default([]),
  windows: z.array(Window).default([]),
  obstacles: z.array(Obstacle).default([]),
  furniture: z.array(Furniture).default([]),
  outlets: z.array(Outlet).default([]),
  existingCables: z.array(ExistingCable).default([]),
  floor: Floor.default({}),
  ceiling: Ceiling.default({}),
  installationType: InstallationType.default('unterputz'),
  wetRoom: z.boolean().default(false),
  /** Geplant in diesem Projekt (bei Teilsanierung können Räume nur Bestand sein). */
  inScope: z.boolean().default(true),
  /** Smart-Home-System für diesen Raum (überschreibt Projektvorgabe). */
  smartHome: SmartHomeSystem.optional(),
  /** Abweichende Standardhöhen für diesen Raum. */
  heightOverrides: DefaultHeights.partial().default({}),
  distributionId: z.string().optional(),
  routing: RoomRouting.default({}),
  /** Abgelehnte Auslass-Vorschläge (Schlüssel), damit sie nicht wiederkommen. */
  dismissedSuggestions: z.array(z.string()).default([]),
  /** Der Nutzer hat die Raum-Zusammenfassung bestätigt. */
  confirmed: z.boolean().default(false),
  provenance: Provenance.default('gemessen'),
  photos: z.array(z.string()).default([]),
  note: z.string().default(''),
});

export const FloorLevel = z.object({
  id,
  name: z.string(),
  level: z.number().int(),
  /** Hintergrund-Grundriss zum Nachzeichnen (Bild als Data-URL). */
  backgroundPlan: z.string().optional(),
  /** Bildgröße in Pixeln. */
  backgroundSize: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
  /** Maßstab des Hintergrunds: Zentimeter je Bildpixel (aus Kalibrierung). */
  backgroundScale: z.number().positive().optional(),
  backgroundOpacity: z.number().min(0).max(1).default(0.6),
  /** Geschosshöhe (OK Rohboden bis OK Rohboden darüber) – für Leitungswege zwischen Geschossen. */
  height: z.number().positive().default(275),
});

// ---------------------------------------------------------------------------
// Stromkreise
// ---------------------------------------------------------------------------

export const Circuit = z.object({
  id,
  /** Bezeichnung in der Verteilung, z. B. „F12“. */
  label: z.string(),
  name: z.string(),
  distributionId: z.string(),
  breakerGroupId: z.string().optional(),
  characteristic: BreakerChar.default('B'),
  ratedCurrent: z.number().positive().default(16),
  poles: z.union([z.literal(1), z.literal(3)]).default(1),
  rcdId: z.string().optional(),
  cable: z.string().default('NYM-J 3×1,5'),
  afdd: z.boolean().default(false),
  reason: z.string().default(''),
  note: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Projekt
// ---------------------------------------------------------------------------

/** Fortschritt des geführten Assistenten. */
export const WizardState = z.object({
  /** false = Projekt wird noch im Assistenten erfasst. */
  finished: z.boolean().default(false),
  /** Aktueller Schritt (z. B. „projekt.art“ oder „raum:<id>:tueren“). */
  step: z.string().default('start'),
  /** Erledigte bzw. bewusst übersprungene Schritte. */
  done: z.array(z.string()).default([]),
  skipped: z.array(z.string()).default([]),
});

export const ChangeLogEntry = z.object({
  at: z.string(),
  text: z.string(),
});

/** Material: Anpassungen des Nutzers an der berechneten Liste. */
export const MaterialState = z.object({
  /** Abgehakt (gekauft/vorhanden) je Positions-ID. */
  checked: z.record(z.string(), z.boolean()).default({}),
  /** Abweichende Bestellmenge je Positions-ID. */
  qtyOverrides: z.record(z.string(), z.number().nonnegative()).default({}),
  /** Abweichender Stückpreis (€) je Positions-ID. */
  priceOverrides: z.record(z.string(), z.number().nonnegative()).default({}),
  /** Eigene Positionen. */
  extras: z.array(z.object({
    id,
    group: z.string(),
    label: z.string(),
    unit: z.string().default('Stk'),
    qty: z.number().nonnegative().default(1),
    price: z.number().nonnegative().default(0),
    note: z.string().default(''),
  })).default([]),
});

export const CostSettings = z.object({
  /** Wer macht die Vorarbeiten (Schlitzen, Dosen, Kabel einziehen)? */
  mode: z.enum(['eigenleistung', 'handwerker']).default('eigenleistung'),
  /** Stundensätze (€/h, netto+MwSt. je nach Angebot) als Spanne. */
  rateHelperMin: z.number().nonnegative().default(50),
  rateHelperMax: z.number().nonnegative().default(70),
  rateElectricianMin: z.number().nonnegative().default(65),
  rateElectricianMax: z.number().nonnegative().default(95),
  /** Zuschlag für Unvorhergesehenes (%). */
  contingencyMin: z.number().nonnegative().default(10),
  contingencyMax: z.number().nonnegative().default(20),
});

export const TaskState = z.object({ done: z.boolean().default(false), note: z.string().default('') });

export const ProjectCore = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  name: z.string(),
  projectType: ProjectType,
  buildingType: BuildingType.default('efh'),
  bundesland: Bundesland.optional(),
  address: z.string().default(''),
  description: z.string().default(''),
  /** Bereits erledigte / unverändert bleibende Teile (Heizung, Wallbox …). */
  keepAsIs: z.array(z.string()).default([]),
  smartHome: SmartHomeConfig.default({}),
  network: z.object({
    rackLocation: z.string().default(''),
    poeAccessPoints: z.number().int().nonnegative().default(0),
    note: z.string().default(''),
  }).default({}),
  /** Ausstattungswert nach DIN 18015-2 / RAL-RG 678 (1–3, „1 Stern“ … „3 Sterne“). */
  equipmentLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  settings: Settings.default({}),
  floors: z.array(FloorLevel).min(1),
  rooms: z.array(Room),
  distributions: z.array(Distribution).default([]),
  circuits: z.array(Circuit).default([]),
  changeLog: z.array(ChangeLogEntry).default([]),
  wizard: WizardState.default({}),
  material: MaterialState.default({}),
  costs: CostSettings.default({}),
  tasks: z.record(z.string(), TaskState).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProjectVersion = z.object({
  name: z.string(),
  at: z.string(),
  snapshot: ProjectCore,
});

export const Project = ProjectCore.extend({
  /** Benannte Versionsstände („Stand 28.10.“). */
  versions: z.array(ProjectVersion).default([]),
});

export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof Project>;
export type Room = z.infer<typeof Room>;
export type RoomInput = z.input<typeof Room>;
export type Wall = z.infer<typeof Wall>;
export type Door = z.infer<typeof Door>;
export type Window = z.infer<typeof Window>;
export type Outlet = z.infer<typeof Outlet>;
export type OutletKind = z.infer<typeof OutletKind>;
export type BoxType = z.infer<typeof BoxType>;
export type InsertType = z.infer<typeof InsertType>;
export type Furniture = z.infer<typeof Furniture>;
export type Obstacle = z.infer<typeof Obstacle>;
export type PreWallSection = z.infer<typeof PreWallSection>;
export type WallZone = z.infer<typeof WallZone>;
export type Distribution = z.infer<typeof Distribution>;
export type Circuit = z.infer<typeof Circuit>;
export type Settings = z.infer<typeof Settings>;
export type SmartHomeConfig = z.infer<typeof SmartHomeConfig>;
export type SmartHomeSystem = z.infer<typeof SmartHomeSystem>;
export type InstallationType = z.infer<typeof InstallationType>;
export type WizardState = z.infer<typeof WizardState>;
export type RoutingStrategy = z.infer<typeof RoutingStrategy>;
export type FloorLevel = z.infer<typeof FloorLevel>;
export type CostSettings = z.infer<typeof CostSettings>;
export type Load = z.infer<typeof Load>;
