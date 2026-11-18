/** Deutsche Anzeigenamen für alle Aufzählungen im Datenmodell. */
import type { BoxType, InsertType, OutletKind, SmartHomeSystem, InstallationType } from './schema';

export const projectTypeLabel: Record<string, string> = {
  neubau: 'Neubau',
  bestand_komplett: 'Bestand – komplette Erneuerung',
  teilsanierung: 'Teilsanierung',
};

export const outletKindLabel: Record<OutletKind, string> = {
  steckdose: 'Steckdose',
  schalter: 'Schalter',
  taster: 'Taster',
  bewegungsmelder: 'Bewegungsmelder',
  lan: 'LAN',
  tv_sat: 'TV/SAT',
  lautsprecher: 'Lautsprecher',
  anschlussdose: 'Geräteanschlussdose',
  festanschluss: 'Festanschluss (Leitung direkt ans Gerät)',
  herd: 'Herdanschluss',
  licht_decke: 'Deckenauslass Licht',
  licht_wand: 'Wandauslass Licht',
  rauchwarnmelder: 'Rauchwarnmelder',
  leerdose: 'Leerdose',
  klingel: 'Klingel/Sprechanlage',
  starkstrom: 'CEE-/Starkstromdose',
  sonstiges: 'Sonstiges',
};

/** Kurzzeichen im Plan. */
export const outletKindShort: Record<OutletKind, string> = {
  steckdose: 'SD', schalter: 'S', taster: 'T', bewegungsmelder: 'BWM', lan: 'LAN', tv_sat: 'TV',
  lautsprecher: 'LS', anschlussdose: 'AD', festanschluss: 'FA', herd: 'HE', licht_decke: 'L', licht_wand: 'WL',
  rauchwarnmelder: 'RWM', leerdose: 'LD', klingel: 'KL', starkstrom: 'CEE', sonstiges: '?',
};

export const boxTypeLabel: Record<BoxType, string> = {
  up_tief: 'UP tief',
  up: 'UP',
  hohlwand: 'Hohlwand',
  aufputz: 'Aufputz',
  aufputz_holz: 'Aufputz auf Holz',
  vorwand: 'Vorwand (Hohlwand)',
  bestand: 'Bestandsdose',
  decke_beton: 'Deckendose Beton',
  decke_hohl: 'Deckendose Hohldecke',
};

export const insertLabel: Record<InsertType, string> = {
  steckdose: 'Steckdose',
  steckdose_usb: 'Steckdose mit USB',
  steckdose_klappdeckel: 'Steckdose mit Klappdeckel',
  ausschalter: 'Ausschalter',
  wechselschalter: 'Wechselschalter',
  kreuzschalter: 'Kreuzschalter',
  serienschalter: 'Serienschalter',
  taster: 'Taster',
  jalousietaster: 'Jalousietaster',
  dimmer: 'Dimmer',
  smart_taster: 'Smart-Taster',
  knx_taster: 'KNX-Taster',
  aktor_unterputz: 'UP-Aktor (in Dose)',
  lan_1fach: 'LAN 1-fach',
  lan_2fach: 'LAN 2-fach',
  tv_sat: 'TV/SAT',
  lautsprecher_klemme: 'Lautsprecher-Klemme',
  blind: 'Blindabdeckung',
  geraeteanschluss: 'Geräteanschluss / Auslass',
  sonstiges: 'Sonstiges',
};

export const smartHomeLabel: Record<SmartHomeSystem, string> = {
  keines: 'Kein Smart Home',
  knx: 'KNX (kabelgebunden, Bus)',
  home_assistant: 'Home Assistant (Zentrale, Funk/LAN-Geräte)',
  shelly: 'Shelly (WLAN, UP-Aktoren)',
  zigbee: 'Zigbee',
  matter_thread: 'Matter / Thread',
  homematic_ip: 'Homematic IP',
  gemischt: 'Gemischt',
};

export const installationTypeLabel: Record<InstallationType, string> = {
  unterputz: 'Unterputz',
  aufputz_nym_schellen: 'Aufputz – NYM auf Schellen',
  aufputz_rohr: 'Aufputz – Installationsrohr',
  aufputz_kanal: 'Aufputz – Kabelkanal',
  hohlwand: 'Hohlwand',
  vorwand: 'Vorwand',
};

export const wallMaterialLabel: Record<string, string> = {
  bims: 'Bims', kalksandstein: 'Kalksandstein', beton: 'Beton', ziegel: 'Ziegel',
  porenbeton: 'Porenbeton', trockenbau: 'Trockenbau', holz: 'Holz', unbekannt: 'unbekannt',
};

export const ceilingLabel: Record<string, string> = {
  stahlbeton: 'Stahlbeton', hourdis: 'Hourdis/Hohlkörper', holzbalken: 'Holzbalken',
  abgehaengt: 'abgehängt', filigran: 'Filigrandecke', unbekannt: 'unbekannt',
};
