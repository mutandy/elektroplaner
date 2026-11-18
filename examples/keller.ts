/**
 * Beispielprojekt „Kellerwohnung“ (Bestand, Teilsanierung).
 *
 * Raummaße = Aufmaß. Lage, Öffnungen und Bestandsbezeichnungen nach dem
 * Bestandsplan Kellergeschoss ('aus_plan'). Noch angenommen ('annahme'):
 * Treppenhaus-/Partyraumtür, Standort HV, Kellerraum mit UV, Garage.
 */
import { createProject, createRectRoom, createPolygonRoom } from '../src/core/model/factory';
import type { Project, Room } from '../src/core/model/schema';
import { Project as ProjectSchema } from '../src/core/model/schema';
import { loadsForType } from '../src/core/planning/loads';
import type { RoomTypeId } from '../src/core/model/roomTypes';

const REF = 1.5; // künftiger Bodenaufbau über Bezug (Ausgleich 0,5 + Belag 1,0)
const SD = 30 + REF; // Steckdose über Bezug
const SW = 105 + REF; // Schalter über Bezug

const kellerFloor = {
  existingBelowRef: [
    { name: 'Zementestrich (Bestand)', thickness: 5.5 },
    { name: 'PE-Folie / Trennlage', thickness: 0.2 },
    { name: 'Rohbetonsohle', thickness: 15 },
  ],
  futureAboveRef: [
    { name: 'Ausgleichsmasse', thickness: 0.5 },
    { name: 'Vinyl-Klick inkl. Trittschall', thickness: 1.0 },
  ],
  protectedLayerDepth: 5,
  maxSlotDepth: 2.5,
  slotsAllowed: true,
  note: 'Folie liegt in 5–6 cm Tiefe; Bodenschlitze max. 2,5 cm. Keine Dübel im Boden.',
};

const hourdis = {
  construction: 'hourdis' as const,
  slotsAllowed: false,
  drillingAllowed: false,
  note: 'Hohlkörperdecke – nicht schlitzen, nicht bohren. Bestands-Deckenauslässe weiterverwenden.',
};

const bims = { material: 'bims' as const };
const A = 'annahme' as const;

export function buildKellerProject(): Project {
  const KG = 'geschoss_kg';
  const p = createProject({
    id: 'beispiel_kellerwohnung',
    name: 'Beispiel: Kellerwohnung mit Garage',
    projectType: 'teilsanierung',
    wizard: { finished: true },
    buildingType: 'efh',
    bundesland: 'NW',
    description: 'Sanierung der Kellerwohnung (UP), Garage und Kellerraum in Aufputz, Unterverteilungen für Garage und Garten.',
    keepAsIs: ['Heizung (eigener Stromkreis, bleibt)', 'Treppenhausbeleuchtung (Allgemeinstrom)'],
    smartHome: {
      enabled: true,
      system: 'home_assistant',
      central: 'Home Assistant auf Mini-PC im Netzwerkschrank',
      neutralInSwitchBoxes: true,
      deepBoxesForActuators: true,
      dimInLuminaire: true,
      notes: 'Smart nur im Heimkino und Partyraum; Rest konventionell, aber vorbereitet (N in jeder Schalterdose).',
    },
    network: { rackLocation: 'Heimkino, AV-Rack', poeAccessPoints: 1 },
    floors: [
      { id: KG, name: 'Kellergeschoss', level: -1 },
    ],
    settings: {
      heightReference: { label: 'OK Estrich (Bestand)', description: 'Alle Höhen ab heutiger Oberkante Estrich. Künftiger Aufbau (1,5 cm) ist je Raum eingerechnet.' },
      defaultHeights: { steckdose: 30, schalter: 105, kuecheArbeitsflaeche: 115, nachttisch: 70, aufputzKeller: 105, lan: 30 },
    },
    distributions: [
      {
        id: 'hv', name: 'Hauptverteilung (HV)', kind: 'HV', roomId: 'technik', netForm: 'TN-C-S', mainFuse: '3× 63 A NH (Annahme)',
        meter: 'Eigener Zähler Wohnung', freeModules: 12,
        breakers: [
          { id: 'hv_b16', characteristic: 'B', ratedCurrent: 16, count: 9, free: 9, note: 'frei laut Bestand' },
          { id: 'hv_b10', characteristic: 'B', ratedCurrent: 10, count: 3, free: 3, note: 'frei laut Bestand' },
        ],
        rcds: [
          { id: 'fi1', label: 'FI 1 (40 A / 30 mA, Typ A)', existing: true },
          { id: 'fi2', label: 'FI 2 (40 A / 30 mA, Typ A)', existing: true },
          { id: 'fi3', label: 'FI 3 neu (40 A / 30 mA, Typ A)', existing: false },
        ],
        note: 'Belegung der FI und freie Plätze vor Ort bestätigen (Foto der Verteilung).',
      },
      {
        id: 'uv_garage', name: 'UV Garage', kind: 'UV', roomId: 'garage', feedFromId: 'hv', feedCable: 'NYM-J 5×10', feedFuse: '3× B32 (Selektivität prüfen)',
        freeModules: 12, hasSpd: true, note: 'Wallbox 11 kW, Torantrieb, CEE 16 A, Licht.',
        rcds: [{ id: 'uv_ga_fi', label: 'FI Garage (40 A / 30 mA, Typ A)', existing: false }],
      },
      {
        id: 'uv_keller', name: 'UV Kellerraum / Garten', kind: 'UV', roomId: 'kellerraum', feedFromId: 'hv', feedCable: 'NYM-J 5×6', feedFuse: '3× B25',
        freeModules: 24, hasSpd: true, note: 'Werkstatt und Außenbereich; großzügige Reserve für Garten.',
        rcds: [{ id: 'uv_kr_fi', label: 'FI Keller/Garten (40 A / 30 mA, Typ A)', existing: false }],
      },
    ],
    circuits: [
      { id: 'c1', label: 'F1', name: 'Licht Flur, Bad, Küche', distributionId: 'hv', breakerGroupId: 'hv_b10', ratedCurrent: 10, rcdId: 'fi1', cable: 'NYM-J 3×1,5', reason: 'Licht getrennt von Steckdosen' },
      { id: 'c2', label: 'F2', name: 'Steckdosen Flur + Bad', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi1', cable: 'NYM-J 3×2,5', reason: 'Bad mit eigenem Kreis inkl. Flur' },
      { id: 'c3', label: 'F3', name: 'Küche Arbeitsfläche', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi2', cable: 'NYM-J 3×2,5', reason: 'Küche aufgeteilt' },
      { id: 'c4', label: 'F4', name: 'Küche Spülmaschine', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi2', cable: 'NYM-J 3×2,5', reason: 'Großgerät eigener Kreis' },
      { id: 'c5', label: 'F5', name: 'Küche Kühlschrank + Dunstabzug', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi3', cable: 'NYM-J 3×2,5', reason: 'Kühlgerät auf anderem FI als Küche' },
      { id: 'c6', label: 'F6', name: 'Küche Herd/Backofen', distributionId: 'hv', characteristic: 'B', ratedCurrent: 16, poles: 3, rcdId: 'fi2', cable: 'NYM-J 5×2,5', reason: 'Drehstrom, eigener Kreis – neuer 3-poliger LS nötig' },
      { id: 'c7', label: 'F7', name: 'Heimkino AV/Technik', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi3', cable: 'NYM-J 3×2,5', reason: 'Technik/AV getrennt' },
      { id: 'c8', label: 'F8', name: 'Licht Heimkino, Partyraum, Büro', distributionId: 'hv', breakerGroupId: 'hv_b10', ratedCurrent: 10, rcdId: 'fi1', cable: 'NYM-J 3×1,5' },
      { id: 'c9', label: 'F9', name: 'Steckdosen Partyraum', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi1', cable: 'NYM-J 3×2,5' },
      { id: 'c10', label: 'F10', name: 'Steckdosen Büro/Gäste', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi3', cable: 'NYM-J 3×2,5' },
      { id: 'c11', label: 'F11', name: 'Steckdosen Heimkino (Raum)', distributionId: 'hv', breakerGroupId: 'hv_b16', rcdId: 'fi2', cable: 'NYM-J 3×2,5' },
      { id: 'c12', label: 'F12', name: 'Zuleitung UV Garage', distributionId: 'hv', characteristic: 'B', ratedCurrent: 32, poles: 3, cable: 'NYM-J 5×10', reason: 'Zuleitung, RCD in der UV' },
      { id: 'c13', label: 'F13', name: 'Zuleitung UV Keller/Garten', distributionId: 'hv', characteristic: 'B', ratedCurrent: 25, poles: 3, cable: 'NYM-J 5×6', reason: 'Zuleitung, RCD in der UV' },
      { id: 'g1', label: 'G1', name: 'Wallbox 11 kW', distributionId: 'uv_garage', characteristic: 'C', ratedCurrent: 16, poles: 3, rcdId: 'uv_ga_fi', cable: 'NYM-J 5×6', reason: 'E-Mobilität, VDE 0100-722; RCD-Typ je Wallbox (DC-Fehlerstromerkennung)' },
      { id: 'g2', label: 'G2', name: 'Garage Licht + Torantrieb', distributionId: 'uv_garage', ratedCurrent: 10, rcdId: 'uv_ga_fi', cable: 'NYM-J 3×1,5' },
      { id: 'g3', label: 'G3', name: 'Garage Steckdosen + CEE', distributionId: 'uv_garage', ratedCurrent: 16, poles: 3, rcdId: 'uv_ga_fi', cable: 'NYM-J 5×2,5' },
      { id: 'k1', label: 'K1', name: 'Kellerraum Steckdosen + Licht', distributionId: 'uv_keller', rcdId: 'uv_kr_fi', cable: 'NYM-J 3×2,5' },
      { id: 'k2', label: 'K2', name: 'Garten Zuleitung Außenverteiler', distributionId: 'uv_keller', ratedCurrent: 16, poles: 3, rcdId: 'uv_kr_fi', cable: 'NYY-J 5×4', reason: 'Erdkabel, Reserve-Leerrohr DN50 mitlegen' },
    ],
  });

  const rooms: Room[] = [];
  /*
   * Lage nach Bestandsplan Kellergeschoss (Außenmaß 18,00 × 10,50 m; Nullpunkt
   * des Geschosses = Außenecke oben links, Außenwände 30 cm, Innenwände 12/24 cm).
   * Raummaße = Aufmaß vor Ort; Lage im Geschoss daraus abgeleitet.
   */
  const PLAN = 'aus_plan' as const;

  // ---------------- Flur 438 × 125 × 225 (Plan: FLUR, schraffiert) ----------------
  rooms.push(createRectRoom({
    id: 'flur', floorId: KG, name: 'Flur', formerName: 'FLUR', usage: 'Flur (führt zu Gästezimmer)',
    width: 438, depth: 125, height: 225, originOnFloor: { x: 975, y: 380 },
    wallDefaults: bims, floor: kellerFloor, ceiling: hourdis, provenance: 'gemessen',
    walls: [{ index: 0, label: 'zu Bad/Küche' }, { index: 1, label: 'zu Heimkino' }, { index: 2, label: 'zu Treppenhaus/Büro' }, { index: 3 }],
    doors: [
      { id: 'flur_t_treppe', wallIndex: 2, s: 330, width: 88, hinge: 'rechts', swing: 'aussen', leadsTo: 'Treppenhaus', isMainEntrance: true, provenance: A },
      { id: 'flur_t_bad', wallIndex: 0, s: 102, width: 76, hinge: 'rechts', swing: 'aussen', leadsToRoomId: 'bad', provenance: PLAN },
      { id: 'flur_t_kueche', wallIndex: 0, s: 309, width: 86, hinge: 'links', swing: 'aussen', leadsToRoomId: 'kueche', provenance: PLAN },
      { id: 'flur_t_kino', wallIndex: 1, s: 20, width: 86, hinge: 'links', swing: 'aussen', leadsToRoomId: 'heimkino', provenance: PLAN },
      { id: 'flur_t_buero', wallIndex: 2, s: 120, width: 86, hinge: 'rechts', swing: 'aussen', leadsToRoomId: 'buero', provenance: A },
    ],
    outlets: [
      { id: 'f1', label: 'F1', kind: 'taster', mount: 'wand', wallIndex: 2, s: 315, z: SW, inserts: ['taster'], circuitId: 'c1', note: 'Taster + Stromstoßschalter (3 Schaltstellen)' },
      { id: 'f2', label: 'F2', kind: 'taster', mount: 'wand', wallIndex: 0, s: 420, z: SW, inserts: ['taster'], circuitId: 'c1', note: 'am Flurende (Heimkino)' },
      { id: 'f3', label: 'F3', kind: 'taster', mount: 'wand', wallIndex: 2, s: 105, z: SW, inserts: ['taster'], circuitId: 'c1', note: 'an der Tür Büro/Gäste' },
      { id: 'f4', label: 'F4', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 240, z: SD, inserts: ['steckdose'], circuitId: 'c2', note: 'Staubsauger' },
      { id: 'f5', label: 'F5', kind: 'licht_decke', mount: 'decke', x: 110, y: 62.5, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c1' },
      { id: 'f6', label: 'F6', kind: 'licht_decke', mount: 'decke', x: 330, y: 62.5, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c1' },
      { id: 'f7', label: 'F7', kind: 'rauchwarnmelder', mount: 'decke', x: 219, y: 62.5, boxType: 'aufputz', note: 'Batteriegerät, keine Leitung' },
    ],
    existingCables: [
      { id: 'flur_bc1', label: 'Bestand Decke F5', cableType: 'NYM 3×1,5 (vermutet)', fromOutletId: 'f5', goesTo: 'Schalterdose Treppenhaus (alt)', reuse: 'pruefen' },
    ],
  }));

  // ---------------- Bad 182 × 317 (Plan: KELLER ④) ----------------
  rooms.push(createRectRoom({
    id: 'bad', floorId: KG, name: 'Bad', formerName: 'KELLER ④', usage: 'Duschbad',
    width: 182, depth: 317, height: 225, originOnFloor: { x: 981, y: 30 }, wetRoom: true,
    wallDefaults: bims, floor: kellerFloor, ceiling: hourdis, provenance: 'gemessen',
    walls: [
      { index: 0, label: 'Außenwand (Lichtschacht)', exterior: true },
      {
        index: 1, label: 'zur Küche',
        preWall: [
          { id: 'bad_vw_dusche', from: 0, to: 95, height: null, depth: 20, label: 'Dusche (raumhoch)' },
          { id: 'bad_vw_wc', from: 95, to: 200, height: 120, depth: 20, label: 'WC' },
          { id: 'bad_vw_wt', from: 200, to: 300, height: 120, depth: 20, label: 'Waschtisch' },
        ],
      },
      { index: 2, label: 'Flurwand' },
      { index: 3, label: 'zu Keller (Nachbar)' },
    ],
    doors: [{ id: 'bad_t', wallIndex: 2, s: 6, width: 76, hinge: 'links', swing: 'innen', leadsToRoomId: 'flur', provenance: PLAN }],
    windows: [{ id: 'bad_f', wallIndex: 0, s: 41, width: 100, sill: 160, height: 45, lightWell: true, provenance: PLAN }],
    furniture: [
      { id: 'bad_dusche', kind: 'dusche', label: 'Dusche', x: 92, y: 0, w: 90, d: 95, wallIndex: 1 },
      { id: 'bad_wc', kind: 'wc', label: 'WC', x: 106, y: 125, w: 56, d: 40, wallIndex: 1 },
      { id: 'bad_wt', kind: 'waschtisch', label: 'Waschtisch', x: 132, y: 215, w: 50, d: 70, height: 85, wallIndex: 1 },
    ],
    outlets: [
      { id: 'b1', label: 'B1', kind: 'schalter', mount: 'wand', wallIndex: 2, s: 6 + 76 + 15, z: SW, gangs: 2, orientation: 'senkrecht', growth: 'unten', inserts: ['ausschalter', 'ausschalter'], circuitId: 'c1', note: 'oben Licht, unten Spiegel' },
      { id: 'b2', label: 'B2', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 250, z: SW, gangs: 2, boxType: 'vorwand', growth: 'links', convention: 'mittig', inserts: ['steckdose', 'steckdose'], circuitId: 'c2', note: 'neben Waschtisch, in Vorwand (120 hoch)' },
      { id: 'b3', label: 'B3', kind: 'licht_wand', mount: 'wand', wallIndex: 1, s: 250, z: 185, boxType: 'up_tief', inserts: ['geraeteanschluss'], circuitId: 'c1', note: 'Spiegelleuchte – über der Vorwand im Mauerwerk' },
      { id: 'b4', label: 'B4', kind: 'licht_decke', mount: 'decke', x: 91, y: 160, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c1', note: 'Bestand, Zugtest; ggf. Leuchte Schutzklasse II' },
      { id: 'b5', label: 'B5', kind: 'anschlussdose', mount: 'wand', wallIndex: 3, s: 60, z: 205, boxType: 'up_tief', inserts: ['geraeteanschluss'], circuitId: 'c1', note: 'Lüfter mit Nachlauf, Dauerstrom + geschaltete Phase (5×1,5)' },
      { id: 'b6', label: 'B6', kind: 'anschlussdose', mount: 'wand', wallIndex: 1, s: 150, z: 40, boxType: 'vorwand', inserts: ['geraeteanschluss'], circuitId: 'c2', note: 'Dusch-WC fest angeschlossen (Schutzbereich 2: keine Steckdose), hinter Vorwand' },
    ],
  }));

  // ---------------- Küche 235 × 331, Kaminwange 54 × 38 unten links (Plan: WASCH.+TROCKNEN ③) ----------------
  rooms.push(createPolygonRoom({
    id: 'kueche', floorId: KG, name: 'Küche', formerName: 'WASCH.+TROCKNEN ③', usage: 'Küche',
    polygon: [{ x: 0, y: 0 }, { x: 235, y: 0 }, { x: 235, y: 331 }, { x: 54, y: 331 }, { x: 54, y: 293 }, { x: 0, y: 293 }],
    height: 225, originOnFloor: { x: 1175, y: 30 },
    wallDefaults: bims, floor: kellerFloor, ceiling: hourdis, provenance: 'gemessen',
    walls: [
      { index: 0, label: 'Außenwand (Lichtschacht)', exterior: true },
      { index: 1, label: 'zum Heimkino' },
      { index: 2, label: 'Flurwand' },
      { index: 3, label: 'Kaminwange vorn', zones: [{ id: 'k_kw1', kind: 'kaminwange', from: 0, to: 38, note: 'Kamin nicht im Bestandsplan eingezeichnet' }] },
      { index: 4, label: 'Kaminwange oben', zones: [{ id: 'k_kw2', kind: 'kaminwange', from: 0, to: 54 }] },
      { index: 5, label: 'Küchenzeile (zum Bad)', preWall: [{ id: 'k_vw', from: 140, to: 230, height: 82, depth: 15, label: 'Installationsvorwand Spüle' }] },
    ],
    doors: [{ id: 'kue_t', wallIndex: 2, s: 40, width: 86, hinge: 'rechts', swing: 'innen', leadsToRoomId: 'flur', provenance: PLAN }],
    windows: [{ id: 'kue_f', wallIndex: 0, s: 67, width: 100, sill: 160, height: 50, lightWell: true, provenance: PLAN }],
    furniture: [
      { id: 'kue_zeile', kind: 'kuechenzeile', label: 'Küchenzeile (Unterschränke, AF 90)', x: 0, y: 5, w: 60, d: 280, height: 90, wallIndex: 5 },
      { id: 'kue_ks', kind: 'kuehlschrank', label: 'Kühlschrank hoch', x: 175, y: 0, w: 60, d: 60, height: 200, wallIndex: 1 },
    ],
    outlets: [
      { id: 'k1', label: 'K1', kind: 'schalter', mount: 'wand', wallIndex: 2, s: 40 - 15, z: SW, inserts: ['ausschalter'], circuitId: 'c1' },
      { id: 'k2', label: 'K2', kind: 'steckdose', mount: 'wand', wallIndex: 5, s: 100, z: 115 + REF, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c3', note: 'Arbeitsfläche' },
      { id: 'k3', label: 'K3', kind: 'steckdose', mount: 'wand', wallIndex: 5, s: 250, z: 115 + REF, gangs: 3, growth: 'links', inserts: ['steckdose', 'steckdose', 'steckdose'], circuitId: 'c3', note: 'Arbeitsfläche, weg von der Ecke' },
      { id: 'k4', label: 'K4', kind: 'steckdose', mount: 'wand', wallIndex: 5, s: 160, z: 40, boxType: 'vorwand', inserts: ['steckdose'], circuitId: 'c4', note: 'Spülmaschine, hinter Unterschrank' },
      { id: 'k5', label: 'K5', kind: 'herd', mount: 'wand', wallIndex: 5, s: 60, z: 45, inserts: ['geraeteanschluss'], circuitId: 'c6', note: 'Herdanschlussdose 5×2,5' },
      { id: 'k6', label: 'K6', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 30, z: 200, inserts: ['steckdose'], circuitId: 'c5', note: 'Kühlschrank, über dem Gerät' },
      { id: 'k7', label: 'K7', kind: 'steckdose', mount: 'wand', wallIndex: 5, s: 60, z: 205, inserts: ['steckdose'], circuitId: 'c5', note: 'Dunstabzug' },
      { id: 'k8', label: 'K8', kind: 'licht_wand', mount: 'wand', wallIndex: 5, s: 180, z: 150, inserts: ['geraeteanschluss'], circuitId: 'c1', note: 'Unterbauleuchte, Auslass hinter Oberschrank' },
      { id: 'k9', label: 'K9', kind: 'licht_decke', mount: 'decke', x: 140, y: 170, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c1' },
    ],
  }));

  // ---------------- Heimkino 347,7 × 486,2 × 223,4 (Plan: KELLER ③ oben rechts) ----------------
  const kinoW = 347.7, kinoD = 486.2;
  rooms.push(createRectRoom({
    id: 'heimkino', floorId: KG, name: 'Heimkino', formerName: 'KELLER ③ (oben rechts)', usage: 'Heimkino 7.1.4',
    width: kinoW, depth: kinoD, height: 223.4, originOnFloor: { x: 1422.3, y: 30 },
    wallDefaults: bims, floor: kellerFloor, provenance: 'gemessen', smartHome: 'home_assistant',
    ceiling: { ...hourdis, cavityDepth: 6, note: 'Hourdis; Akustikpaneele auf Lattung (6 cm Hohlraum) als Kabelweg für Atmos und Beamer.' },
    walls: [
      { index: 0, label: 'Rückwand außen (Lichtschacht)', exterior: true, note: 'Außenwand: keine Dämmung direkt an der Wand, Feuchte beachten.' },
      { index: 1, label: 'Seite rechts (außen)', exterior: true },
      { index: 2, label: 'Leinwand/Baffle (zum Partyraum)', preWall: [{ id: 'kino_baffle', from: 0, to: kinoW, height: null, depth: 60, construction: 'holz', label: 'Baffle-Wall 60 cm' }], note: 'Luftspalt hinter der Baffle-Wall.' },
      { index: 3, label: 'Seite links (Küche/Flur)' },
    ],
    doors: [{ id: 'kino_t', wallIndex: 3, s: 20, width: 86, hinge: 'links', swing: 'innen', leadsToRoomId: 'flur', provenance: PLAN }],
    windows: [{ id: 'kino_f', wallIndex: 0, s: 124, width: 100, sill: 160, height: 45, lightWell: true, provenance: PLAN, status: 'bleibt' }],
    furniture: [
      { id: 'kino_sofa', kind: 'sofa', label: 'Sofa (Hörplatz)', x: 74, y: 150, w: 200, d: 95, height: 85 },
      { id: 'kino_rack', kind: 'rack', label: 'AV-Rack', x: 0, y: 270, w: 60, d: 60, height: 120, wallIndex: 3 },
    ],
    outlets: [
      { id: 'h1', label: 'H1', kind: 'taster', mount: 'wand', wallIndex: 3, s: 20 + 86 + 15, z: SW, gangs: 2, orientation: 'senkrecht', growth: 'unten', inserts: ['smart_taster', 'blind'], smart: true, circuitId: 'c8', note: 'Smart-Taster, Szenen' },
      { id: 'h2', label: 'H2', kind: 'steckdose', mount: 'wand', wallIndex: 2, s: 173.85, z: 25, boxType: 'aufputz_holz', gangs: 3, convention: 'mittig', inserts: ['steckdose', 'steckdose', 'steckdose'], circuitId: 'c7', note: 'Subwoofer/Center in Baffle' },
      { id: 'h3', label: 'H3', kind: 'lautsprecher', mount: 'wand', wallIndex: 2, s: 60, z: 110, boxType: 'aufputz_holz', inserts: ['lautsprecher_klemme'], note: 'Front L (Baffle)' },
      { id: 'h4', label: 'H4', kind: 'lautsprecher', mount: 'wand', wallIndex: 2, s: 173.85, z: 60, boxType: 'aufputz_holz', inserts: ['lautsprecher_klemme'], note: 'Center (Baffle)' },
      { id: 'h5', label: 'H5', kind: 'lautsprecher', mount: 'wand', wallIndex: 2, s: kinoW - 60, z: 110, boxType: 'aufputz_holz', inserts: ['lautsprecher_klemme'], note: 'Front R (Baffle)' },
      { id: 'h6', label: 'H6', kind: 'lautsprecher', mount: 'wand', wallIndex: 1, s: 165, z: 121.5, inserts: ['lautsprecher_klemme'], note: 'Surround (rechts), leicht hinter Hörplatz' },
      { id: 'h7', label: 'H7', kind: 'lautsprecher', mount: 'wand', wallIndex: 3, s: kinoD - 165, z: 121.5, inserts: ['lautsprecher_klemme'], note: 'Surround (links), leicht hinter Hörplatz' },
      { id: 'h8', label: 'H8', kind: 'lautsprecher', mount: 'wand', wallIndex: 0, s: 103.85, z: 150, inserts: ['lautsprecher_klemme'], note: 'Rear Surround' },
      { id: 'h9', label: 'H9', kind: 'lautsprecher', mount: 'wand', wallIndex: 0, s: 243.85, z: 150, inserts: ['lautsprecher_klemme'], note: 'Rear Surround' },
      { id: 'h10', label: 'H10', kind: 'lautsprecher', mount: 'decke', x: kinoW - 60, y: 280, boxType: 'decke_hohl', note: 'Atmos Top Front (in Linie mit Front L)' },
      { id: 'h11', label: 'H11', kind: 'lautsprecher', mount: 'decke', x: 60, y: 280, boxType: 'decke_hohl', note: 'Atmos Top Front (in Linie mit Front R)' },
      { id: 'h12', label: 'H12', kind: 'lautsprecher', mount: 'decke', x: kinoW - 60, y: 100, boxType: 'decke_hohl', note: 'Atmos Top Rear' },
      { id: 'h13', label: 'H13', kind: 'lautsprecher', mount: 'decke', x: 60, y: 100, boxType: 'decke_hohl', note: 'Atmos Top Rear' },
      { id: 'h14', label: 'H14', kind: 'steckdose', mount: 'decke', x: kinoW / 2, y: 120, boxType: 'decke_hohl', inserts: ['steckdose'], circuitId: 'c7', note: 'Beamer; Abstand aus Throw Ratio (Etappe 5). HDMI-Glasfaser' },
      { id: 'h15', label: 'H15', kind: 'steckdose', mount: 'wand', wallIndex: 3, s: kinoD - 300, z: SD, gangs: 4, convention: 'mittig', inserts: ['steckdose', 'steckdose', 'steckdose', 'steckdose'], circuitId: 'c7', note: 'AV-Rack' },
      { id: 'h16', label: 'H16', kind: 'lan', mount: 'wand', wallIndex: 3, s: kinoD - 300, z: SD + 15, gangs: 1, inserts: ['lan_2fach'], note: 'AV-Rack Uplink' },
      { id: 'h17', label: 'H17', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 40, z: SD, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c11' },
      { id: 'h18', label: 'H18', kind: 'licht_decke', mount: 'decke', x: kinoW / 2, y: 240, boxType: 'decke_hohl', circuitId: 'c8', smart: true, note: 'LED-Spots in Paneelen, Dimmen im Treiber (Dauerstrom)' },
    ],
  }));

  // ---------------- Partyraum/Büro 341 × 472,5 (Plan: KELLER ③ unten rechts) ----------------
  rooms.push(createRectRoom({
    id: 'partyraum', floorId: KG, name: 'Partyraum / Spielzimmer', formerName: 'KELLER ③ (unten rechts)', usage: 'Partyraum, Spielzimmer', futureUsage: 'vielleicht Büro',
    width: 341, depth: 472.5, height: 225, originOnFloor: { x: 1429, y: 547.5 }, smartHome: 'home_assistant',
    wallDefaults: bims, floor: kellerFloor, ceiling: hourdis, provenance: 'gemessen',
    walls: [{ index: 0, label: 'zum Heimkino' }, { index: 1, label: 'Außenwand rechts', exterior: true }, { index: 2, label: 'Außenwand unten', exterior: true }, { index: 3, label: 'zum Büro/Gäste' }],
    doors: [{ id: 'party_t', wallIndex: 0, s: 10, width: 86, hinge: 'links', swing: 'innen', leadsTo: 'Flur/Vorraum', provenance: A }],
    windows: [
      { id: 'party_f1', wallIndex: 1, s: 180, width: 100, sill: 155, height: 55, lightWell: true, provenance: PLAN },
      { id: 'party_f2', wallIndex: 2, s: 60, width: 100, sill: 155, height: 55, lightWell: true, provenance: PLAN },
    ],
    outlets: [
      { id: 'p1', label: 'P1', kind: 'schalter', mount: 'wand', wallIndex: 0, s: 10 + 86 + 15, z: SW, inserts: ['ausschalter'], circuitId: 'c8' },
      { id: 'p2', label: 'P2', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 200, z: SD, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c9' },
      { id: 'p3', label: 'P3', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 80, z: SD, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c9' },
      { id: 'p4', label: 'P4', kind: 'steckdose', mount: 'wand', wallIndex: 2, s: 230, z: SD, gangs: 3, convention: 'mittig', inserts: ['steckdose', 'steckdose', 'steckdose'], circuitId: 'c9', note: 'später Schreibtisch' },
      { id: 'p5', label: 'P5', kind: 'lan', mount: 'wand', wallIndex: 2, s: 260, z: SD, inserts: ['lan_2fach'] },
      { id: 'p6', label: 'P6', kind: 'steckdose', mount: 'wand', wallIndex: 3, s: 240, z: SD, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c9' },
      { id: 'p7', label: 'P7', kind: 'licht_decke', mount: 'decke', x: 170, y: 236, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c8' },
    ],
  }));

  // ---------------- Büro/Gäste 283,7 × 471,9 (Plan: KELLER ①) ----------------
  rooms.push(createRectRoom({
    id: 'buero', floorId: KG, name: 'Büro / Gäste', formerName: 'KELLER ①', usage: 'Büro, Gästezimmer (Schlafen)',
    width: 283.7, depth: 471.9, height: 225, originOnFloor: { x: 1133.3, y: 548 },
    wallDefaults: bims, floor: kellerFloor, ceiling: hourdis, provenance: 'gemessen',
    walls: [{ index: 0, label: 'Flurseite' }, { index: 1, label: 'zum Partyraum' }, { index: 2, label: 'Außenwand (Fenster)', exterior: true }, { index: 3, label: 'zum Treppenhaus' }],
    doors: [{ id: 'buero_t', wallIndex: 0, s: 74, width: 86, hinge: 'links', swing: 'innen', leadsToRoomId: 'flur', provenance: PLAN }],
    windows: [{ id: 'buero_f', wallIndex: 2, s: 90, width: 100, sill: 155, height: 55, lightWell: true, provenance: PLAN }],
    furniture: [
      { id: 'buero_tisch', kind: 'schreibtisch', label: 'Schreibtisch (elektrisch, 2 Monitore)', x: 60, y: 391.9, w: 160, d: 80, height: 75, wallIndex: 2 },
      { id: 'buero_bett', kind: 'bett', label: 'Gästebett / Schlafsofa', x: 183.7, y: 120, w: 100, d: 200, height: 45, wallIndex: 1 },
    ],
    outlets: [
      { id: 'g1', label: 'G1', kind: 'schalter', mount: 'wand', wallIndex: 0, s: 74 + 86 + 15, z: SW, inserts: ['ausschalter'], circuitId: 'c8' },
      { id: 'g2', label: 'G2', kind: 'steckdose', mount: 'wand', wallIndex: 2, s: 70, z: SD, gangs: 3, inserts: ['steckdose', 'steckdose', 'steckdose'], circuitId: 'c10', note: 'Schreibtisch' },
      { id: 'g3', label: 'G3', kind: 'lan', mount: 'wand', wallIndex: 2, s: 210, z: SD, inserts: ['lan_2fach'], note: 'Schreibtisch' },
      { id: 'g4', label: 'G4', kind: 'steckdose', mount: 'wand', wallIndex: 1, s: 100, z: 70 + REF, inserts: ['steckdose_usb'], circuitId: 'c10', note: 'Nachttisch' },
      { id: 'g5', label: 'G5', kind: 'steckdose', mount: 'wand', wallIndex: 3, s: 140, z: SD, gangs: 2, inserts: ['steckdose', 'steckdose'], circuitId: 'c10' },
      { id: 'g6', label: 'G6', kind: 'licht_decke', mount: 'decke', x: 141.85, y: 236, status: 'bestand_bleibt', boxType: 'bestand', circuitId: 'c8' },
      { id: 'g7', label: 'G7', kind: 'rauchwarnmelder', mount: 'decke', x: 141.85, y: 160, boxType: 'aufputz', note: 'Pflicht (Schlafraum)' },
    ],
  }));

  // ---------------- Heizung mit HV (Plan: HEIZUNG; HV-Standort angenommen) ----------------
  const apCeiling = { construction: 'hourdis' as const, slotsAllowed: false, drillingAllowed: true, note: 'Annahme: Hourdis wie im ganzen Keller – nicht schlitzen, Befestigung nur mit Hohlraumdübeln.' };
  rooms.push(createRectRoom({
    id: 'technik', floorId: KG, name: 'Heizung / HV', formerName: 'HEIZUNG', usage: 'Heizung, Hauptverteilung (Standort angenommen)',
    width: 240, depth: 338, height: 225, originOnFloor: { x: 537, y: 30 }, installationType: 'aufputz_rohr',
    wallDefaults: bims, ceiling: apCeiling, provenance: PLAN, inScope: false,
    floor: { slotsAllowed: false },
    doors: [{ id: 'tech_t', wallIndex: 3, s: 30, width: 88.5, hinge: 'links', swing: 'innen', leadsTo: 'Flur', fireRating: 'T30', provenance: PLAN }],
    note: 'Bestand, nicht Teil der Planung. Tür im Plan als FHT eingezeichnet.',
  }));

  // ---------------- Kellerraum mit UV und Gartenanschluss (Plan: KELLER neben HEIZUNG; Annahme) ----------------
  rooms.push(createRectRoom({
    id: 'kellerraum', floorId: KG, name: 'Kellerraum / Werkstatt', formerName: 'KELLER (1,80 × 3,38)', usage: 'Werkstatt, Lager',
    width: 180, depth: 338, height: 225, originOnFloor: { x: 789, y: 30 }, installationType: 'aufputz_rohr',
    wallDefaults: bims, ceiling: apCeiling, provenance: A,
    floor: { slotsAllowed: false, note: 'kein künftiger Aufbau' },
    walls: [{ index: 0, label: 'Außenwand (Lichtschacht, Garten)', exterior: true }, { index: 1 }, { index: 2, label: 'Tür' }, { index: 3 }],
    doors: [{ id: 'kr_t', wallIndex: 2, s: 20, width: 86, hinge: 'links', swing: 'innen', leadsTo: 'Flur', provenance: PLAN }],
    windows: [{ id: 'kr_f', wallIndex: 0, s: 40, width: 100, sill: 160, height: 45, lightWell: true, provenance: PLAN }],
    furniture: [
      { id: 'kr_werkbank', kind: 'werkbank', label: 'Werkbank', x: 0, y: 0, w: 70, d: 160, height: 90, wallIndex: 3 },
      { id: 'kr_regal', kind: 'regal', label: 'Regal', x: 140, y: 40, w: 40, d: 200, height: 200, wallIndex: 1 },
    ],
    outlets: [
      { id: 'kr1', label: 'KR1', kind: 'schalter', mount: 'wand', wallIndex: 2, s: 20 + 86 + 18, z: 105, boxType: 'aufputz', inserts: ['ausschalter'], circuitId: 'k1' },
      { id: 'kr2', label: 'KR2', kind: 'steckdose', mount: 'wand', wallIndex: 3, s: 260, z: 105, gangs: 3, boxType: 'aufputz', inserts: ['steckdose_klappdeckel', 'steckdose_klappdeckel', 'steckdose_klappdeckel'], circuitId: 'k1', note: 'über Werkbank' },
      { id: 'kr3', label: 'KR3', kind: 'licht_decke', mount: 'decke', x: 90, y: 169, boxType: 'aufputz', circuitId: 'k1', note: 'Feuchtraum-Wannenleuchte IP65' },
      { id: 'kr4', label: 'KR4', kind: 'anschlussdose', mount: 'wand', wallIndex: 0, s: 160, z: 150, boxType: 'aufputz', inserts: ['geraeteanschluss'], circuitId: 'k2', note: 'Durchführung Erdkabel zum Garten (Außenverteiler), Abdichtung gegen Wasser' },
    ],
  }));

  // ---------------- Garage (Plan: GARAGE ②; Zuordnung angenommen) ----------------
  rooms.push(createRectRoom({
    id: 'garage', floorId: KG, name: 'Garage', formerName: 'GARAGE ②', usage: 'Garage mit Wallbox',
    width: 368, depth: 628, height: 250, originOnFloor: { x: 419, y: 392 }, installationType: 'aufputz_rohr', wetRoom: true,
    wallDefaults: bims, ceiling: apCeiling, provenance: A,
    floor: { slotsAllowed: false },
    walls: [{ index: 0, label: 'zum Keller ②' }, { index: 1, label: 'zu Waschen+Trocknen ②' }, { index: 2, label: 'Torwand', exterior: true }, { index: 3, label: 'zur Doppelgarage' }],
    doors: [
      { id: 'ga_t_haus', wallIndex: 0, s: 60, width: 88.5, hinge: 'links', swing: 'innen', fireRating: 'T30', leadsTo: 'KELLER ② (FHT)', provenance: PLAN },
      { id: 'ga_tor', wallIndex: 2, s: 59, width: 250, height: 212, hinge: 'links', swing: 'aussen', hasFrame: false, leadsTo: 'Sektionaltor', provenance: A },
    ],
    obstacles: [
      { id: 'ga_tor_offen', kind: 'tor', label: 'Sektionaltor geöffnet', x: 59, y: 358, w: 250, d: 270, zFrom: 212, zTo: 250 },
      { id: 'ga_schiene', kind: 'torlaufschiene', label: 'Laufschiene Antrieb', x: 179, y: 300, w: 10, d: 328, zFrom: 235, zTo: 250 },
    ],
    outlets: [
      { id: 'ga1', label: 'GA1', kind: 'schalter', mount: 'wand', wallIndex: 0, s: 60 + 88.5 + 15, z: 105, gangs: 2, orientation: 'senkrecht', growth: 'unten', boxType: 'aufputz', inserts: ['ausschalter', 'taster'], circuitId: 'g2', note: 'oben Licht, unten Tortaster' },
      { id: 'ga2', label: 'GA2', kind: 'steckdose', mount: 'decke', x: 184, y: 285, boxType: 'aufputz', inserts: ['steckdose'], circuitId: 'g2', note: 'Deckensteckdose Torantrieb, hinter Schienenende' },
      { id: 'ga3', label: 'GA3', kind: 'anschlussdose', mount: 'wand', wallIndex: 3, s: 200, z: 125, boxType: 'aufputz', inserts: ['geraeteanschluss'], circuitId: 'g1', note: 'Wallbox 11 kW (NYM-J 5×6), Anfahrschutz' },
      { id: 'ga4', label: 'GA4', kind: 'starkstrom', mount: 'wand', wallIndex: 0, s: 260, z: 105, boxType: 'aufputz', inserts: ['sonstiges'], circuitId: 'g3', note: 'CEE 16 A' },
      { id: 'ga5', label: 'GA5', kind: 'steckdose', mount: 'wand', wallIndex: 0, s: 300, z: 105, gangs: 2, boxType: 'aufputz', inserts: ['steckdose_klappdeckel', 'steckdose_klappdeckel'], circuitId: 'g3' },
      { id: 'ga6', label: 'GA6', kind: 'licht_decke', mount: 'decke', x: 184, y: 120, boxType: 'aufputz', circuitId: 'g2', note: 'Feuchtraum-Wannenleuchte' },
      { id: 'ga7', label: 'GA7', kind: 'licht_decke', mount: 'decke', x: 80, y: 320, boxType: 'aufputz', circuitId: 'g2', note: 'Wannenleuchte vor dem Torbereich' },
    ],
  }));
  // Raumtypen und Verbraucher; Verbraucher werden mit passenden Auslässen verknüpft
  const types: Record<string, RoomTypeId> = { flur: 'flur', bad: 'bad', kueche: 'kueche', heimkino: 'heimkino', partyraum: 'hobby', buero: 'gaeste', technik: 'technik', kellerraum: 'werkstatt', garage: 'garage' };
  const manual: Record<string, string> = { 'AV-Receiver / Verstärker': 'h15' };
  for (const r of rooms) {
    r.roomType = types[r.id];
    if (!r.roomType) continue;
    r.loads = loadsForType(r.roomType).map((l, i) => {
      const words = l.label.toLowerCase().split(/[\s/()]+/).filter((w) => w.length >= 4);
      const hit = manual[l.label] ?? r.outlets.find((o) => words.some((w) => o.note.toLowerCase().includes(w)))?.id;
      return { ...l, id: `${r.id}_last${i + 1}`, outletId: hit };
    });
  }
  return ProjectSchema.parse({ ...p, rooms });
}
