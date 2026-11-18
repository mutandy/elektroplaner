/**
 * Heimkino: Lautsprecher-Positionen nach gängigen Dolby-Empfehlungen und
 * Beamer-Abstand aus dem Projektionsverhältnis. Alles ab Hörplatz (MLP):
 *  - Front L/R ±22–30° (hier 27°), Center 0°
 *  - Surround ±90–110° (7.x: 100°; 5.x: 110°), Rear ±135–150° (142°)
 *  - Front Wide (9.x) ±60°
 *  - Höhenlautsprecher in Linie mit Front L/R: Top Front/Rear bei 30–55°
 *    Elevation (Ziel 45°), Top Middle (bei .2) ca. 80° über dem Hörplatz
 * Werte sind Empfehlungen; Feinabstimmung macht der Kalibrierer/Planer.
 */
import type { Project, Room, TheaterConfig } from '../model/schema';
import { futureBuildup, wallGeoms, fmt, type Pt } from '../geometry/room';

export interface TheaterSpeaker {
  code: string;
  label: string;
  mount: 'wand' | 'decke';
  wallIndex?: number;
  s?: number;
  z?: number; // über Bezug
  x?: number;
  y?: number;
  azimuth: number;
  elevation: number;
  ok: boolean;
  note: string;
}

export interface TheaterPlan {
  mlp: Pt;
  screenCenter: Pt;
  speakers: TheaterSpeaker[];
  projector: { x: number; y: number; distance: number; min: number; max: number; ok: boolean; note: string } | null;
  imageHeight: number;
  warnings: string[];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Schnittpunkt eines Strahls mit den Raumwänden → Wand und s. */
function rayToWall(room: Room, from: Pt, dir: Pt): { wallIndex: number; s: number; dist: number } | null {
  let best: { wallIndex: number; s: number; dist: number } | null = null;
  for (const w of wallGeoms(room)) {
    const ex = w.b.x - w.a.x, ey = w.b.y - w.a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((w.a.x - from.x) * ey - (w.a.y - from.y) * ex) / den; // Strahl
    const u = ((w.a.x - from.x) * dir.y - (w.a.y - from.y) * dir.x) / den; // Wand 0..1
    if (t > 1 && u >= 0 && u <= 1 && (!best || t < best.dist)) best = { wallIndex: w.index, s: u * w.length, dist: t };
  }
  return best;
}

export function planTheater(project: Project, room: Room, cfg: TheaterConfig): TheaterPlan {
  const ws = wallGeoms(room);
  const w = ws[cfg.screenWall] ?? ws[0];
  const fb = futureBuildup(room);
  const earZ = cfg.earHeight + fb;
  const ceil = room.height;
  // Leinwand-Ebene: vor der Baffle-/Vorwand
  const baffle = Math.max(0, ...room.walls[w.index].preWall.map((p) => p.depth));
  const center = { x: w.a.x + (w.b.x - w.a.x) / 2 + w.normal.x * baffle, y: w.a.y + (w.b.y - w.a.y) / 2 + w.normal.y * baffle };
  const fwd = { x: -w.normal.x, y: -w.normal.y }; // Blick vom Hörplatz zur Leinwand
  const right = { x: w.dir.x, y: w.dir.y }; // von innen gesehen läuft die Wand von links nach rechts
  const D = cfg.listeningDistance;
  const mlp = { x: center.x - fwd.x * D, y: center.y - fwd.y * D };
  const warnings: string[] = [];
  const speakers: TheaterSpeaker[] = [];
  const dirAt = (az: number) => ({ x: fwd.x * Math.cos(rad(az)) + right.x * Math.sin(rad(az)), y: fwd.y * Math.cos(rad(az)) + right.y * Math.sin(rad(az)) });
  const [base, , top] = cfg.layout.split('.').map(Number);
  const halfW = cfg.screenWidth / 2;
  const sCenter = w.length / 2;

  // Front: auf der Leinwandwand (Baffle-Ebene)
  const frontOffset = D * Math.tan(rad(27));
  const frontS = (sign: number) => sCenter + sign * frontOffset;
  const add = (sp: Omit<TheaterSpeaker, 'ok'> & { ok?: boolean }) => speakers.push({ ok: true, ...sp });
  add({ code: 'C', label: 'Center', mount: 'wand', wallIndex: w.index, s: sCenter, z: Math.max(earZ - 20, cfg.screenBottom + fb - 10), azimuth: 0, elevation: 0, note: 'hinter akustisch transparenter Leinwand bzw. direkt darunter' });
  for (const [code, label, sign] of [['FL', 'Front links', -1], ['FR', 'Front rechts', 1]] as const) {
    const s = frontS(sign);
    const ok = s > 15 && s < w.length - 15;
    add({ code, label, mount: 'wand', wallIndex: w.index, s: Math.max(15, Math.min(w.length - 15, s)), z: earZ, azimuth: sign * 27, elevation: 0, ok, note: Math.abs(s - sCenter) < halfW ? 'innerhalb der Bildbreite – nur hinter transparenter Leinwand' : 'neben der Leinwand' });
  }
  if (base >= 9) for (const [code, label, sign] of [['FWL', 'Front Wide links', -1], ['FWR', 'Front Wide rechts', 1]] as const) {
    const hit = rayToWall(room, mlp, dirAt(sign * 60));
    if (hit) add({ code, label, mount: 'wand', wallIndex: hit.wallIndex, s: hit.s, z: earZ, azimuth: sign * 60, elevation: 0, note: '' });
  }
  const sideAz = base >= 7 ? 100 : 110;
  for (const [code, label, sign] of [['SL', 'Surround links', -1], ['SR', 'Surround rechts', 1]] as const) {
    const hit = rayToWall(room, mlp, dirAt(sign * sideAz));
    if (!hit) { warnings.push(`${label}: keine Wand in Richtung ${sideAz}° gefunden.`); continue; }
    const elev = Math.atan2(40, hit.dist) * 180 / Math.PI;
    add({ code, label, mount: 'wand', wallIndex: hit.wallIndex, s: hit.s, z: earZ + 40, azimuth: sign * sideAz, elevation: Math.round(elev), note: `${fmt(hit.dist / 100, 2)} m vom Hörplatz, leicht über Ohrhöhe` });
  }
  if (base >= 7) for (const [code, label, sign] of [['SBL', 'Rear links', -1], ['SBR', 'Rear rechts', 1]] as const) {
    const hit = rayToWall(room, mlp, dirAt(sign * 142));
    if (!hit) { warnings.push(`${label}: keine Wand hinter dem Hörplatz.`); continue; }
    add({ code, label, mount: 'wand', wallIndex: hit.wallIndex, s: hit.s, z: earZ + 40, azimuth: sign * 142, elevation: Math.round(Math.atan2(40, hit.dist) * 180 / Math.PI), note: `${fmt(hit.dist / 100, 2)} m vom Hörplatz` });
  }
  // Höhenlautsprecher in Linie mit Front L/R
  const dh = ceil - earZ;
  const lateral = Math.min(frontOffset, halfW + 20);
  const ceilPt = (forward: number, sign: number) => ({ x: mlp.x + fwd.x * forward + right.x * sign * lateral, y: mlp.y + fwd.y * forward + right.y * sign * lateral });
  const topList: [string, string, number][] = top === 2 ? [['TML', 'Top Middle', 0]] : top >= 4 ? [['TF', 'Top Front', 1], ['TR', 'Top Rear', -1]] : [];
  for (const [code, label, dirSign] of topList) {
    const forward = dirSign === 0 ? 0 : dirSign * dh; // 45° → Abstand = Höhendifferenz
    for (const [sfx, side, sign] of [['L', 'links', -1], ['R', 'rechts', 1]] as const) {
      const p = ceilPt(forward, sign);
      const horiz = Math.hypot(forward, lateral);
      const elev = Math.round(Math.atan2(dh, horiz) * 180 / Math.PI);
      const ok = dirSign === 0 ? elev >= 65 : elev >= 30 && elev <= 55;
      if (!ok) warnings.push(`${label} ${side}: Elevation ${elev}° außerhalb der Empfehlung.`);
      add({ code: `${code}${sfx}`, label: `${label} ${side}`, mount: 'decke', x: Math.round(p.x), y: Math.round(p.y), azimuth: Math.round(Math.atan2(sign * lateral, forward) * 180 / Math.PI), elevation: elev, ok, note: 'in Linie mit Front L/R' });
    }
  }
  // Subwoofer: an der Leinwandwand, seitlich
  add({ code: 'SUB', label: 'Subwoofer', mount: 'wand', wallIndex: w.index, s: Math.max(20, sCenter - halfW - 40), z: 25 + fb, azimuth: 0, elevation: 0, note: 'Steckdose + Signal; Position nach Messung optimieren' });

  // Beamer
  const min = cfg.throwMin * cfg.screenWidth, max = cfg.throwMax * cfg.screenWidth;
  let dist = Math.max(min, Math.min(max, D + 40));
  let projector: TheaterPlan['projector'] = null;
  const depthAvail = rayToWall(room, center, { x: -fwd.x, y: -fwd.y })?.dist ?? 0;
  if (dist > depthAvail - 20) dist = Math.min(max, depthAvail - 20);
  const ok = dist >= min && dist <= max;
  const pp = { x: center.x - fwd.x * dist, y: center.y - fwd.y * dist };
  projector = { x: Math.round(pp.x), y: Math.round(pp.y), distance: Math.round(dist), min: Math.round(min), max: Math.round(max), ok, note: ok ? `${fmt(dist / 100, 2)} m vor der Leinwand (Bereich ${fmt(min / 100, 2)}–${fmt(max / 100, 2)} m)` : 'Raum zu kurz für dieses Projektionsverhältnis' };
  if (!ok) warnings.push(`Beamer: nötiger Abstand ${fmt(min / 100, 2)}–${fmt(max / 100, 2)} m, verfügbar ${fmt(depthAvail / 100, 2)} m.`);
  const imageHeight = Math.round((cfg.screenWidth * 9) / 16);
  if (cfg.screenBottom + imageHeight > ceil - fb - 10) warnings.push(`Bild ${fmt(cfg.screenWidth)} × ${imageHeight} cm passt bei Unterkante ${fmt(cfg.screenBottom)} cm nicht unter die Decke.`);
  if (D < cfg.screenWidth * 1.0) warnings.push('Hörabstand kleiner als die Bildbreite – sehr nah (Empfehlung ca. 1–1,5 × Bildbreite).');
  return { mlp, screenCenter: center, speakers, projector, imageHeight, warnings };
}
