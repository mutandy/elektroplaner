/**
 * Richtpreise (Endkunde, brutto, Stand Ende 2026, Baumarkt/Elektrogroßhandel-Online).
 * Nur Orientierung – Preise schwanken stark nach Händler, Marke und Menge.
 * Jeder Preis ist im Projekt überschreibbar (material.priceOverrides).
 */

export interface PriceItem {
  /** Stabile ID (auch Schlüssel für Abhaken/Überschreiben). */
  id: string;
  group: MaterialGroup;
  label: string;
  unit: string;
  /** Preis je Einheit in € */
  price: number;
  /** Verkaufseinheit (z. B. Ring 50 m, Packung 50 Stk) – 1 = einzeln */
  pack?: number;
  note?: string;
}

export type MaterialGroup =
  | 'Kabel und Leitungen'
  | 'Dosen'
  | 'Schalterprogramm'
  | 'Klemmen und Kleinmaterial'
  | 'Verteiler und Schutzgeräte'
  | 'Netzwerk, Multimedia, Smart Home'
  | 'Leuchten und Geräte'
  | 'Werkzeug und Miete'
  | 'Eigene Positionen';

export const GROUP_ORDER: MaterialGroup[] = [
  'Kabel und Leitungen', 'Dosen', 'Schalterprogramm', 'Klemmen und Kleinmaterial', 'Verteiler und Schutzgeräte',
  'Netzwerk, Multimedia, Smart Home', 'Leuchten und Geräte', 'Werkzeug und Miete', 'Eigene Positionen',
];

/** €/m je Kabeltyp */
export const CABLE_PRICE: Record<string, number> = {
  'NYM-J 3×1,5': 0.75, 'NYM-J 3×2,5': 1.1, 'NYM-J 5×1,5': 1.2, 'NYM-J 5×2,5': 1.8, 'NYM-J 5×4': 2.8, 'NYM-J 5×6': 4.0, 'NYM-J 5×10': 6.5,
  'NYY-J 3×2,5': 1.6, 'NYY-J 5×4': 3.5, 'NYY-J 5×6': 4.8, 'Cat.7': 0.8, 'LS 2×2,5': 0.9, 'J-Y(St)Y 2×2×0,8': 0.45, 'Koax': 0.6, 'HDMI optisch': 6,
};

const P = (id: string, group: MaterialGroup, label: string, unit: string, price: number, pack?: number, note?: string): PriceItem => ({ id, group, label, unit, price, pack, note });

export const PRICES: PriceItem[] = [
  // Dosen
  P('dose.up', 'Dosen', 'UP-Gerätedose Ø 68, 47 mm', 'Stk', 0.5, 25),
  P('dose.up_tief', 'Dosen', 'UP-Geräte-/Elektronikdose tief Ø 68, 61 mm', 'Stk', 1.1, 25, 'Platz für Klemmen/UP-Aktoren'),
  P('dose.hohlwand', 'Dosen', 'Hohlwanddose Ø 68 (luftdicht)', 'Stk', 0.9, 25),
  P('dose.decke_beton', 'Dosen', 'Deckendose Beton mit Haken', 'Stk', 3),
  P('dose.decke_hohl', 'Dosen', 'Hohlwand-Deckendose / Geräteeinbaudose', 'Stk', 2.5),
  P('dose.ap_gehaeuse1', 'Dosen', 'AP-Feuchtraumgehäuse 1-fach (IP44)', 'Stk', 4.5),
  P('dose.ap_gehaeuse2', 'Dosen', 'AP-Feuchtraumgehäuse 2-fach (IP44)', 'Stk', 7),
  P('dose.ap_gehaeuse3', 'Dosen', 'AP-Feuchtraumgehäuse 3-fach (IP44)', 'Stk', 10),
  P('dose.abzweig_ap', 'Dosen', 'AP-Abzweigdose IP65 (Aufputz/Decke)', 'Stk', 2.5),
  P('dose.holz', 'Dosen', 'AP-Dose für Holzwand (Baffle) bzw. Montageplatte', 'Stk', 2),
  P('dose.ring', 'Dosen', 'Putzausgleichsring (nur bei Putz > 5 mm)', 'Stk', 0.6, 10, 'nur falls später Putz > 5 mm'),
  // Schalterprogramm (Merten System M als Standard – je Serie anpassen)
  P('sp.rahmen1', 'Schalterprogramm', 'Rahmen 1-fach', 'Stk', 3.5),
  P('sp.rahmen2', 'Schalterprogramm', 'Rahmen 2-fach', 'Stk', 6.5),
  P('sp.rahmen3', 'Schalterprogramm', 'Rahmen 3-fach', 'Stk', 9.5),
  P('sp.rahmen4', 'Schalterprogramm', 'Rahmen 4-fach', 'Stk', 13),
  P('sp.rahmen5', 'Schalterprogramm', 'Rahmen 5-fach', 'Stk', 17),
  P('sp.steckdose', 'Schalterprogramm', 'SCHUKO-Steckdoseneinsatz mit Zentralplatte', 'Stk', 8),
  P('sp.steckdose_usb', 'Schalterprogramm', 'SCHUKO-Steckdose mit USB A/C', 'Stk', 38),
  P('sp.steckdose_klappdeckel', 'Schalterprogramm', 'SCHUKO-Steckdose mit Klappdeckel', 'Stk', 14),
  P('sp.ausschalter', 'Schalterprogramm', 'Aus-/Wechselschalter-Einsatz + Wippe', 'Stk', 12),
  P('sp.wechselschalter', 'Schalterprogramm', 'Wechselschalter-Einsatz + Wippe', 'Stk', 12),
  P('sp.kreuzschalter', 'Schalterprogramm', 'Kreuzschalter-Einsatz + Wippe', 'Stk', 22),
  P('sp.serienschalter', 'Schalterprogramm', 'Serienschalter-Einsatz + Doppelwippe', 'Stk', 18),
  P('sp.taster', 'Schalterprogramm', 'Taster-Einsatz (Schließer) + Wippe', 'Stk', 13),
  P('sp.jalousietaster', 'Schalterprogramm', 'Jalousietaster + Wippe', 'Stk', 24),
  P('sp.dimmer', 'Schalterprogramm', 'LED-Dimmer-Einsatz + Abdeckung', 'Stk', 65),
  P('sp.smart_taster', 'Schalterprogramm', 'Smart-/Funk-Taster (System nach Wahl)', 'Stk', 45),
  P('sp.knx_taster', 'Schalterprogramm', 'KNX-Tastsensor 2-fach', 'Stk', 140),
  P('sp.aktor_unterputz', 'Schalterprogramm', 'UP-Aktor (z. B. Shelly Plus 1PM)', 'Stk', 22),
  P('sp.lan_1fach', 'Schalterprogramm', 'Datendose Cat.6A 1-fach + Abdeckung', 'Stk', 22),
  P('sp.lan_2fach', 'Schalterprogramm', 'Datendose Cat.6A 2-fach + Abdeckung', 'Stk', 30),
  P('sp.tv_sat', 'Schalterprogramm', 'Antennendose TV/SAT + Abdeckung', 'Stk', 18),
  P('sp.lautsprecher_klemme', 'Schalterprogramm', 'Lautsprecher-Anschlussdose (Klemmen)', 'Stk', 15),
  P('sp.blind', 'Schalterprogramm', 'Blindabdeckung mit Tragring', 'Stk', 5),
  P('sp.geraeteanschluss', 'Schalterprogramm', 'Geräteanschlussdose / Auslass mit Abdeckung', 'Stk', 6),
  P('sp.sonstiges', 'Schalterprogramm', 'Sonstiger Einsatz (prüfen)', 'Stk', 10),
  P('sp.ap_steckdose', 'Schalterprogramm', 'Feuchtraum-AP: Steckdoseneinsatz mit Klappdeckel', 'Stk', 9),
  P('sp.ap_schalter', 'Schalterprogramm', 'Feuchtraum-AP: Schalter-/Tastereinsatz', 'Stk', 8),
  P('sp.ap_cee', 'Schalterprogramm', 'CEE-Steckdose 16 A 5-polig AP', 'Stk', 25),
  // Klemmen und Kleinmaterial
  P('km.wago3', 'Klemmen und Kleinmaterial', 'Verbindungsklemme 3-Leiter (z. B. WAGO 221-413)', 'Stk', 0.35, 50),
  P('km.wago5', 'Klemmen und Kleinmaterial', 'Verbindungsklemme 5-Leiter (z. B. WAGO 221-415)', 'Stk', 0.5, 25),
  P('km.dosenmoertel', 'Klemmen und Kleinmaterial', 'Gips/Dosenmörtel zum Einsetzen der Dosen', 'kg', 1.2, 5),
  P('km.gips', 'Klemmen und Kleinmaterial', 'Gips/Haftputz zum Schließen der Wandschlitze', 'kg', 1.2, 5),
  P('km.reparaturmoertel', 'Klemmen und Kleinmaterial', 'Zementärer Reparaturmörtel (Bodenschlitze)', 'kg', 1.0, 25),
  P('km.schnellzement', 'Klemmen und Kleinmaterial', 'Schnellzement (Fixieren im Boden)', 'kg', 1.6, 5),
  P('km.rohr20', 'Klemmen und Kleinmaterial', 'Installationsrohr starr M20 (Aufputz)', 'm', 0.7, 3),
  P('km.rohr25', 'Klemmen und Kleinmaterial', 'Installationsrohr starr M25 (Aufputz)', 'm', 0.9, 3),
  P('km.rohrschelle', 'Klemmen und Kleinmaterial', 'Rohrschelle (alle 50 cm) inkl. Dübel', 'Stk', 0.25, 50),
  P('km.rohrbogen', 'Klemmen und Kleinmaterial', 'Rohrbogen/Muffe', 'Stk', 0.5, 10),
  P('km.stahlrohr', 'Klemmen und Kleinmaterial', 'Stahlrohr/Schutzkanal (mechanischer Schutz bis 1,5 m)', 'm', 6, 3),
  P('km.schutzrohr_schwelle', 'Klemmen und Kleinmaterial', 'Schutzrohr für Übergang unter Türschwelle (Flexrohr M25)', 'm', 0.8),
  P('km.abschottung', 'Klemmen und Kleinmaterial', 'Brandschutz-Abschottung (zugelassen, je Durchbruch)', 'Stk', 35, 1, 'Einbau durch Fachbetrieb'),
  P('km.durchfuehrung', 'Klemmen und Kleinmaterial', 'Wanddurchführung / Mörtel zum Verschließen', 'Stk', 3),
  P('km.kabelbinder', 'Klemmen und Kleinmaterial', 'Kabelbinder, Nagelschellen, Beschriftungsband', 'Set', 15),
  P('km.dichtung', 'Klemmen und Kleinmaterial', 'Hauseinführung / Abdichtung Erdkabel', 'Stk', 45),
  P('km.warnband', 'Klemmen und Kleinmaterial', 'Trassenwarnband „Achtung Kabel“', 'm', 0.2, 50),
  P('km.erdrohr', 'Klemmen und Kleinmaterial', 'Kabelschutzrohr DN50 (Erde) + Reserve-Leerrohr', 'm', 1.5, 25),
  // Verteiler und Schutzgeräte
  P('vt.ls1', 'Verteiler und Schutzgeräte', 'Leitungsschutzschalter 1-polig (B/C)', 'Stk', 8),
  P('vt.ls3', 'Verteiler und Schutzgeräte', 'Leitungsschutzschalter 3-polig (B/C)', 'Stk', 26),
  P('vt.rcd', 'Verteiler und Schutzgeräte', 'FI/RCD 40 A / 30 mA, 4-polig, Typ A', 'Stk', 45),
  P('vt.rcd_wallbox', 'Verteiler und Schutzgeräte', 'FI/RCD für Wallbox (Typ nach Herstellerangabe)', 'Stk', 90, 1, 'Typ B deutlich teurer (ca. 250–400 €)'),
  P('vt.spd', 'Verteiler und Schutzgeräte', 'Überspannungsschutz (SPD) Typ 2 bzw. 1+2', 'Stk', 120),
  P('vt.kv', 'Verteiler und Schutzgeräte', 'Kleinverteiler AP 2-reihig (24 TE) inkl. Klemmen', 'Stk', 75),
  P('vt.kv_nh', 'Verteiler und Schutzgeräte', 'Hauptschalter / Lasttrennschalter für UV', 'Stk', 25),
  P('vt.kleinmaterial', 'Verteiler und Schutzgeräte', 'Phasenschiene, N-/PE-Klemmen, Beschriftung', 'Set', 30),
  // Netzwerk, Multimedia, Smart Home
  P('nw.patch', 'Netzwerk, Multimedia, Smart Home', 'Patchpanel-Ports / Keystone Cat.6A', 'Stk', 7),
  P('nw.ap', 'Netzwerk, Multimedia, Smart Home', 'WLAN-Access-Point PoE', 'Stk', 120),
  P('nw.smart_zentrale', 'Netzwerk, Multimedia, Smart Home', 'Smart-Home-Zentrale (z. B. Home Assistant Green + Funkstick)', 'Stk', 150),
  P('nw.knx_basis', 'Netzwerk, Multimedia, Smart Home', 'KNX-Grundausstattung (Netzteil, IP-Schnittstelle, Aktoren) – grob', 'Set', 900),
  // Leuchten und Geräte
  P('lg.rwm', 'Leuchten und Geräte', 'Rauchwarnmelder (10-Jahres-Batterie, Q-Label)', 'Stk', 22),
  P('lg.leuchte', 'Leuchten und Geräte', 'Deckenleuchte LED (Standard)', 'Stk', 40),
  P('lg.wanne', 'Leuchten und Geräte', 'Feuchtraum-Wannenleuchte LED IP65', 'Stk', 30),
  P('lg.wandleuchte', 'Leuchten und Geräte', 'Wand-/Spiegelleuchte', 'Stk', 45),
  P('lg.luefter', 'Leuchten und Geräte', 'Badlüfter mit Nachlauf', 'Stk', 60),
  P('lg.spots', 'Leuchten und Geräte', 'LED-Spots / Paneele (je Auslass, grob)', 'Stk', 80),
  // Werkzeug und Miete
  P('wz.fraese', 'Werkzeug und Miete', 'Miete Mauernutfräse mit Absaugung', 'Tag', 45),
  P('wz.sauger', 'Werkzeug und Miete', 'Miete Bau-Staubsauger Klasse M', 'Tag', 25),
  P('wz.senker', 'Werkzeug und Miete', 'Dosensenker Ø 68 (Hartmetall/Diamant)', 'Stk', 40),
  P('wz.ortung', 'Werkzeug und Miete', 'Leitungssucher / Ortungsgerät', 'Stk', 35),
  P('wz.scheiben', 'Werkzeug und Miete', 'Diamant-Trennscheiben (Satz)', 'Set', 30),
  P('wz.schutz', 'Werkzeug und Miete', 'FFP2-Masken, Gehör- und Augenschutz', 'Set', 20),
];

export function priceItem(id: string): PriceItem | undefined {
  return PRICES.find((p) => p.id === id);
}
