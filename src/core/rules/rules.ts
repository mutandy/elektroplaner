/**
 * Regelbasis (Etappe 1). Jede Regel ist eine reine Funktion mit Quelle.
 * Neue Regel ergänzen: Objekt zu RULES hinzufügen, Test in tests/rules.test.ts.
 */
import type { Outlet, Project, Room } from '../model/schema';
import { boxCenters, doorHandleSide, outletExtent, wallLength, zToFfb, futureBuildup, fmt, wallName } from '../geometry/room';
import { normValue } from './normValues';
import type { Rule, RuleFinding, Severity } from './types';
import { outletKindLabel } from '../model/labels';

const isWallOutlet = (o: Outlet) => o.mount === 'wand' && o.wallIndex != null && o.s != null && o.z != null;
const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
const isSwitchLike = (o: Outlet) => o.kind === 'schalter' || o.kind === 'taster' || o.kind === 'bewegungsmelder';
const inMasonry = (o: Outlet) => o.boxType === 'up' || o.boxType === 'up_tief';

export function effectiveSmart(project: Project, room: Room) {
  if (room.smartHome) return room.smartHome;
  return project.smartHome.enabled ? project.smartHome.system : 'keines';
}

/** Liegt eine Wand-Position in einer senkrechten Installationszone? */
export function inVerticalZone(project: Project, room: Room, wallIndex: number, s: number): boolean {
  const from = normValue(project, 'zone.v.von');
  const to = normValue(project, 'zone.v.bis');
  const len = wallLength(room, wallIndex);
  const edges: number[] = [0, len];
  for (const d of room.doors.filter((d) => d.wallIndex === wallIndex)) edges.push(d.s, d.s + d.width);
  for (const w of room.windows.filter((w) => w.wallIndex === wallIndex)) edges.push(w.s, w.s + w.width);
  return edges.some((e) => {
    const dist = Math.abs(s - e);
    return dist >= from - 0.01 && dist <= to + 0.01;
  });
}

export type HZone = 'oben' | 'unten' | 'mitte';
export function horizontalZoneAt(project: Project, room: Room, z: number, allowMiddle: boolean): HZone | null {
  const hFfb = zToFfb(room, z);
  const ceilingFfb = room.height - futureBuildup(room);
  const below = ceilingFfb - hFfb;
  if (below >= normValue(project, 'zone.h.oben.von') && below <= normValue(project, 'zone.h.oben.bis')) return 'oben';
  if (hFfb >= normValue(project, 'zone.h.unten.von') && hFfb <= normValue(project, 'zone.h.unten.bis')) return 'unten';
  if (allowMiddle && hFfb >= normValue(project, 'zone.h.mitte.von') && hFfb <= normValue(project, 'zone.h.mitte.bis')) return 'mitte';
  return null;
}

const roomHasWorktop = (room: Room) =>
  /küche|kueche|bad|wc|hwr|werk|arbeit/i.test(`${room.name} ${room.usage}`) ||
  room.furniture.some((f) => /arbeitsfl|kuech|waschtisch|werkbank/i.test(f.kind));

export const RULES: Rule[] = [
  {
    id: 'AUSLASS.GEOMETRIE',
    title: 'Auslass liegt auf der Wand und unter der Decke',
    source: 'Plausibilität',
    confirm: false,
    scope: 'auslass',
    check: (_ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o)) return [];
      const len = wallLength(room, o.wallIndex!);
      const ext = outletExtent(o, _ctx.project.settings)!;
      const res = [];
      if (ext.sMin < 0 || ext.sMax > len) res.push({ severity: 'fehler' as Severity, message: `${o.label} liegt außerhalb von ${wallName(room, o.wallIndex!)} (Länge ${fmt(len)} cm).` });
      if (ext.zMin < 0 || ext.zMax > room.height) res.push({ severity: 'fehler' as Severity, message: `${o.label}: Höhe ${fmt(o.z)} cm liegt außerhalb der Raumhöhe ${fmt(room.height)} cm.` });
      return res;
    },
  },
  {
    id: 'DIN18015-3.ZONE',
    title: 'Auslass in einer Installationszone',
    source: 'DIN 18015-3 (Installationszonen)',
    confirm: true,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o) || !inMasonry(o)) return [];
      if (room.installationType !== 'unterputz') return [];
      if (o.wallIndex != null && room.walls[o.wallIndex]?.material === 'trockenbau') return [];
      const centers = boxCenters(o, ctx.project.settings);
      const vz = centers.some((c) => inVerticalZone(ctx.project, room, o.wallIndex!, c.s));
      const hz = horizontalZoneAt(ctx.project, room, o.z!, roomHasWorktop(room));
      if (vz || hz) return [];
      return [{
        severity: 'warnung',
        message: `${o.label} (${outletKindLabel[o.kind]}) liegt außerhalb der Installationszonen – Position prüfen oder Abweichung dokumentieren.`,
      }];
    },
  },
  {
    id: 'TUER.OEFFNUNG',
    title: 'Keine Dose in Tür-/Fensteröffnung oder hinter dem Türblatt',
    source: 'Praxisregel',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o)) return [];
      const ext = outletExtent(o, ctx.project.settings)!;
      const m = normValue(ctx.project, 'oeffnung.rand');
      const res: { severity: Severity; message: string }[] = [];
      for (const d of room.doors.filter((d) => d.wallIndex === o.wallIndex)) {
        if (overlaps(ext.sMin, ext.sMax, d.s - m, d.s + d.width + m) && ext.zMin < d.height + futureBuildup(room) + m) {
          res.push({ severity: 'fehler', message: `${o.label} liegt in der Türöffnung (Tür bei ${fmt(d.s)}–${fmt(d.s + d.width)} cm).` });
        } else if (d.swing === 'innen') {
          const leaf = d.hinge === 'links' ? [d.s - d.width, d.s] : [d.s + d.width, d.s + 2 * d.width];
          if (overlaps(ext.sMin, ext.sMax, leaf[0], leaf[1]) && ext.zMin < d.height + futureBuildup(room)) {
            res.push({ severity: 'warnung', message: `${o.label} liegt hinter dem geöffneten Türblatt (Bandseite ${d.hinge}). Dose ist bei offener Tür verdeckt – ${isSwitchLike(o) ? 'Schalter gehört auf die Griffseite' : 'andere Position prüfen'}.` });
          }
        }
      }
      for (const w of room.windows.filter((w) => w.wallIndex === o.wallIndex && w.status !== 'wird_zugemauert')) {
        if (overlaps(ext.sMin, ext.sMax, w.s - m, w.s + w.width + m) && overlaps(ext.zMin, ext.zMax, w.sill - m, w.sill + w.height + m)) {
          res.push({ severity: 'fehler', message: `${o.label} liegt im Fenster (Fenster bei ${fmt(w.s)}–${fmt(w.s + w.width)} cm, Brüstung ${fmt(w.sill)} cm).` });
        }
      }
      return res;
    },
  },
  {
    id: 'SCHALTER.GRIFFSEITE',
    title: 'Schalter auf der Griffseite neben der Tür',
    source: 'Praxisregel',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o) || !isSwitchLike(o)) return [];
      const radius = normValue(ctx.project, 'schalter.suchradius');
      const doors = room.doors.filter((d) => d.wallIndex === o.wallIndex);
      const res: { severity: Severity; message: string }[] = [];
      for (const d of doors) {
        const leftEdge = d.s;
        const rightEdge = d.s + d.width;
        const onLeft = o.s! < leftEdge && leftEdge - o.s! <= radius;
        const onRight = o.s! > rightEdge && o.s! - rightEdge <= radius;
        if (!onLeft && !onRight) continue;
        const side = onLeft ? 'links' : 'rechts';
        const handle = doorHandleSide(d);
        if (side !== handle) {
          res.push({ severity: 'warnung', message: `${o.label} sitzt auf der Bandseite der Tür (Bänder ${d.hinge}). Schalter gehören auf die Griffseite (${handle}).` });
          continue;
        }
        const target = d.hasFrame ? normValue(ctx.project, 'schalter.abstandZarge') : normValue(ctx.project, 'schalter.abstandOhneZarge');
        const dist = onLeft ? leftEdge - o.s! : o.s! - rightEdge;
        if (Math.abs(dist - target) > normValue(ctx.project, 'schalter.toleranz')) {
          res.push({ severity: 'hinweis', message: `${o.label}: ${fmt(dist)} cm neben der Öffnung, üblich sind ca. ${fmt(target)} cm (${d.hasFrame ? 'mit Zarge' : 'ohne Zarge'}).` });
        }
      }
      return res;
    },
  },
  {
    id: 'ECKE.ABSTAND',
    title: 'Abstand zur Raumecke',
    source: 'Praxisregel',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o)) return [];
      const min = normValue(ctx.project, 'ecke.minAbstandDosenmitte');
      const len = wallLength(room, o.wallIndex!);
      const c = boxCenters(o, ctx.project.settings);
      const first = Math.min(...c.map((b) => b.s));
      const last = Math.max(...c.map((b) => b.s));
      const res: { severity: Severity; message: string }[] = [];
      if (first < min || len - last < min) {
        const near = first < min ? 'linken' : 'rechten';
        res.push({ severity: 'warnung', message: `${o.label}: Dosenmitte nur ${fmt(Math.min(first, len - last))} cm von der ${near} Ecke (mind. ${fmt(min)} cm, sonst passt der Rahmen nicht).` });
      }
      if (o.gangs > 1 && o.orientation === 'waagerecht' && (o.convention ?? ctx.project.settings.boxConvention) === 'erste_an_position') {
        // Mehrfachdosen von der Ecke weg
        const towardsLeftCorner = o.growth === 'links' && o.s! < len / 2;
        const towardsRightCorner = o.growth === 'rechts' && o.s! > len / 2 && len - last < 40;
        if (towardsLeftCorner && first < 40) res.push({ severity: 'hinweis', message: `${o.label}: Mehrfachkombination wächst in Richtung Ecke – besser von der Ecke weg.` });
        if (towardsRightCorner) res.push({ severity: 'hinweis', message: `${o.label}: Mehrfachkombination wächst in Richtung Ecke – besser von der Ecke weg.` });
      }
      return res;
    },
  },
  {
    id: 'VORWAND.HOEHE',
    title: 'Dosen in Vorwänden liegen innerhalb der Vorwand',
    source: 'Praxisregel',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o)) return [];
      const wall = room.walls[o.wallIndex!];
      const ext = outletExtent(o, ctx.project.settings)!;
      const sections = wall.preWall.filter((p) => overlaps(ext.sMin, ext.sMax, p.from, p.to));
      const res: { severity: Severity; message: string }[] = [];
      const rand = normValue(ctx.project, 'vorwand.randOben');
      const hollow = o.boxType === 'vorwand' || o.boxType === 'hohlwand';
      for (const p of sections) {
        const top = p.height ?? room.height;
        if (hollow && ext.zMax > top - rand) {
          res.push({ severity: 'fehler', message: `${o.label} ist als Hohlwanddose geplant, liegt aber über der Vorwand (Vorwand ${p.label || ''} nur ${fmt(top)} cm hoch). Darüber ist Mauerwerk → UP-Dose mit Wandschlitz oder tiefer setzen.` });
        } else if (!hollow && inMasonry(o) && ext.zMax <= top) {
          res.push({ severity: 'warnung', message: `${o.label} liegt hinter der Vorwand (${fmt(p.from)}–${fmt(p.to)} cm, Höhe ${fmt(top)} cm), ist aber als UP-Dose im Mauerwerk geplant → Hohlwanddose in der Vorwand verwenden.` });
        }
      }
      if (hollow && sections.length === 0 && wall.material !== 'trockenbau') {
        res.push({ severity: 'fehler', message: `${o.label} ist als Hohlwanddose geplant, an dieser Stelle gibt es aber keine Vorwand/Trockenbauwand.` });
      }
      return res;
    },
  },
  {
    id: 'WAND.TABUZONE',
    title: 'Keine Dosen in Kaminwange, Sturz oder Tabuzone',
    source: 'DIN 18015-3 / Schornsteinfeger / Statik',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isWallOutlet(o)) return [];
      if (o.boxType === 'aufputz' || o.boxType === 'aufputz_holz') return [];
      const ext = outletExtent(o, ctx.project.settings)!;
      const wall = room.walls[o.wallIndex!];
      const res: { severity: Severity; message: string }[] = [];
      for (const zn of wall.zones) {
        const zTo = zn.zTo ?? room.height;
        if (overlaps(ext.sMin, ext.sMax, zn.from, zn.to) && overlaps(ext.zMin, ext.zMax, zn.zFrom, zTo)) {
          if (zn.kind === 'brandwand') {
            res.push({ severity: 'hinweis', message: `${o.label} liegt in einer Brandwand – Dose nur mit geeigneter Brandschutzdose/Abschottung.` });
          } else {
            const what = zn.kind === 'kaminwange' ? 'Kaminwange' : zn.kind === 'sturz' ? 'Sturz' : 'Tabuzone';
            res.push({ severity: 'fehler', message: `${o.label} liegt in der ${what} (${fmt(zn.from)}–${fmt(zn.to)} cm). Hier nicht bohren/schlitzen.` });
          }
        }
      }
      return res;
    },
  },
  {
    id: 'SMART.DOSENTIEFE',
    title: 'Smart-Home: tiefe Dosen und Neutralleiter an Schaltstellen',
    source: 'Herstellerangaben UP-Aktoren / Praxisregel',
    confirm: false,
    scope: 'auslass',
    check: (ctx, room, o) => {
      if (!room || !o || !isSwitchLike(o) || o.mount !== 'wand') return [];
      const sys = effectiveSmart(ctx.project, room);
      if (sys === 'keines') return [];
      const res: { severity: Severity; message: string }[] = [];
      if (['shelly', 'home_assistant', 'zigbee', 'matter_thread', 'homematic_ip', 'gemischt'].includes(sys)) {
        if (ctx.project.smartHome.deepBoxesForActuators && o.boxType === 'up') {
          res.push({ severity: 'hinweis', message: `${o.label}: Für UP-Aktoren (z. B. Shelly) hinter dem Schalter tiefe Dose (Elektronikdose) vorsehen.` });
        }
        if (ctx.project.smartHome.neutralInSwitchBoxes) {
          res.push({ severity: 'hinweis', message: `${o.label}: Neutralleiter in die Schalterdose führen (5-adrig bzw. 3-adrig + Schaltdraht) – Voraussetzung für Smart-Aktoren.` });
        }
      }
      if (sys === 'knx' && !o.inserts.includes('knx_taster')) {
        res.push({ severity: 'hinweis', message: `${o.label}: Bei KNX Busleitung (z. B. J-Y(St)Y 2×2×0,8 KNX grün) zu dieser Schaltstelle; Bestückung KNX-Taster prüfen.` });
      }
      return res;
    },
  },
  // ----------------------------- Raum -------------------------------------
  {
    id: 'BODEN.SCHLITZTIEFE',
    title: 'Bodenschlitz schneidet Folie/Dämmung/FBH nicht an',
    source: 'Praxisregel / DIN 18560 (Estrich)',
    confirm: true,
    scope: 'raum',
    check: (ctx, room) => {
      if (!room || !room.floor.slotsAllowed) return [];
      const res: { severity: Severity; message: string }[] = [];
      if (room.floor.underfloorHeating) {
        res.push({ severity: 'fehler', message: `${room.name}: Fußbodenheizung – Bodenschlitze sind ausgeschlossen.` });
      }
      const prot = room.floor.protectedLayerDepth;
      if (prot == null) {
        res.push({ severity: 'warnung', message: `${room.name}: Tiefe der Folie/Dämmlage im Boden ist nicht erfasst – vor dem Schlitzen ermitteln (Probebohrung).` });
      } else if (room.floor.maxSlotDepth > prot - normValue(ctx.project, 'boden.sicherheitZuFolie')) {
        res.push({ severity: 'fehler', message: `${room.name}: Bodenschlitz ${fmt(room.floor.maxSlotDepth)} cm tief, Folie/Dämmlage beginnt bei ${fmt(prot)} cm – Sicherheitsabstand fehlt.` });
      }
      return res;
    },
  },
  {
    id: 'RAUM.ERFASSUNG',
    title: 'Erfassung vollständig',
    source: 'Planungsablauf',
    confirm: false,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      const res: { severity: Severity; message: string }[] = [];
      if (room.doors.length === 0) res.push({ severity: 'warnung', message: `${room.name}: keine Tür erfasst – Schaltstellen und Bezugssystem hängen davon ab.` });
      const unknownWalls = room.walls.filter((w) => w.material === 'unbekannt').length;
      if (unknownWalls) res.push({ severity: 'warnung', message: `${room.name}: Material von ${unknownWalls} Wand/Wänden unbekannt.` });
      if (room.ceiling.construction === 'unbekannt') res.push({ severity: 'warnung', message: `${room.name}: Deckenbauart unbekannt – entscheidet, ob Deckenschlitze/Bohrungen möglich sind.` });
      if (room.provenance === 'annahme' || room.doors.some((d) => d.provenance === 'annahme') || room.windows.some((w) => w.provenance === 'annahme')) {
        res.push({ severity: 'hinweis', message: `${room.name}: enthält angenommene Maße/Positionen – vor Ort prüfen.` });
      }
      if (!room.confirmed) res.push({ severity: 'hinweis', message: `${room.name}: Raum-Zusammenfassung noch nicht bestätigt.` });
      return res;
    },
  },
  {
    id: 'LBO.RAUCHWARNMELDER',
    title: 'Rauchwarnmelder in Schlafräumen, Kinderzimmern und Fluren davor',
    source: 'Landesbauordnung (je Bundesland) / DIN 14676',
    confirm: true,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room || !room.inScope) return [];
      const text = `${room.name} ${room.usage} ${room.futureUsage}`;
      if (!/schlaf|kind|gäst|gaest|flur|diele/i.test(text)) return [];
      if (room.outlets.some((o) => o.kind === 'rauchwarnmelder')) return [];
      return [{ severity: 'warnung', message: `${room.name}: Rauchwarnmelder fehlt (Pflicht in Schlafräumen, Kinderzimmern und Fluren, die zu Aufenthaltsräumen führen – genaue Regel der Landesbauordnung prüfen).` }];
    },
  },
  {
    id: 'MLAR.BRANDSCHUTZTUER',
    title: 'Brandschutztür → Wand ist Brandabschnitt',
    source: 'MLAR (Muster-Leitungsanlagen-Richtlinie)',
    confirm: true,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      return room.doors
        .filter((d) => d.fireRating !== 'keine')
        .map((d) => ({
          severity: 'hinweis' as Severity,
          message: `${room.name}: Tür ${d.fireRating} in ${wallName(room, d.wallIndex)} – diese Wand bildet einen Brandabschnitt. Jede Leitungsdurchführung braucht eine zugelassene Abschottung.`,
        }));
    },
  },
  {
    id: 'DECKE.HOHLKOERPER',
    title: 'Hohlkörperdecken nicht schlitzen',
    source: 'Statik / Herstellerangaben',
    confirm: false,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      if (room.ceiling.construction === 'hourdis' && room.ceiling.slotsAllowed) {
        return [{ severity: 'fehler', message: `${room.name}: Hourdis-/Hohlkörperdecke ist als schlitzbar markiert – das ist statisch unzulässig.` }];
      }
      return [];
    },
  },
  // ----------------------------- Projekt ----------------------------------
  {
    id: 'VDE0100-410.RCD',
    title: 'RCD 30 mA für Steckdosen- und Lichtstromkreise',
    source: 'DIN VDE 0100-410:2018-10, 411.3.3',
    confirm: true,
    scope: 'projekt',
    check: (ctx) => {
      const res: { severity: Severity; message: string; ref?: string }[] = [];
      for (const c of ctx.project.circuits) {
        if (c.rcdId) continue;
        const outlets = ctx.project.rooms.flatMap((r) => r.outlets.filter((o) => o.circuitId === c.id));
        const sockets = outlets.some((o) => o.kind === 'steckdose' || o.kind === 'starkstrom');
        const lights = outlets.some((o) => o.kind === 'licht_decke' || o.kind === 'licht_wand');
        if (sockets) res.push({ severity: 'fehler', ref: c.label, message: `Stromkreis ${c.label} (${c.name}) versorgt Steckdosen, hat aber keinen RCD 30 mA.` });
        else if (lights) res.push({ severity: 'warnung', ref: c.label, message: `Stromkreis ${c.label} (${c.name}) versorgt Leuchten in Wohnräumen ohne RCD – in Wohnungen gefordert.` });
      }
      return res;
    },
  },
  {
    id: 'VERTEILUNG.PLAETZE',
    title: 'Freie Plätze in der Verteilung reichen',
    source: 'Planungsablauf',
    confirm: false,
    scope: 'projekt',
    check: (ctx) => {
      const res: { severity: Severity; message: string }[] = [];
      for (const d of ctx.project.distributions) {
        for (const g of d.breakers) {
          const used = ctx.project.circuits.filter((c) => c.breakerGroupId === g.id).length;
          if (used > g.free) res.push({ severity: 'fehler', message: `${d.name}: ${used} Stromkreise auf ${g.characteristic}${g.ratedCurrent} geplant, aber nur ${g.free} frei – ${used - g.free} LS fehlen.` });
        }
        const unassigned = ctx.project.circuits.filter((c) => c.distributionId === d.id && !c.breakerGroupId).length;
        if (unassigned > 0) res.push({ severity: 'warnung', message: `${d.name}: ${unassigned} Stromkreis(e) ohne vorhandenen LS – neue LS nötig (${d.freeModules} freie TE gemeldet).` });
      }
      return res;
    },
  },
  {
    id: 'STROMKREIS.ZUORDNUNG',
    title: 'Jeder 230-V-Auslass hat einen Stromkreis',
    source: 'Planungsablauf',
    confirm: false,
    scope: 'raum',
    check: (_ctx, room) => {
      if (!room) return [];
      const powered = ['steckdose', 'schalter', 'licht_decke', 'licht_wand', 'anschlussdose', 'herd', 'starkstrom', 'bewegungsmelder'];
      const missing = room.outlets.filter((o) => powered.includes(o.kind) && !o.circuitId && o.status !== 'bestand_entfaellt' && !(o.kind === 'schalter' && o.smart));
      if (!missing.length) return [];
      return [{ severity: 'hinweis', message: `${room.name}: ${missing.length} Auslass/Auslässe noch ohne Stromkreis (${missing.map((m) => m.label).join(', ')}).` }];
    },
  },
];

export interface RuleReport {
  findings: RuleFinding[];
  counts: Record<Severity, number>;
}

export function runRules(project: Project, opts: { roomId?: string } = {}): RuleReport {
  const findings: RuleFinding[] = [];
  const ctx = { project };
  const push = (rule: Rule, items: ReturnType<Rule['check']>, roomId?: string, outletId?: string) => {
    for (const it of items) findings.push({ ruleId: rule.id, source: rule.source, confirm: rule.confirm, roomId, outletId, ...it });
  };
  for (const rule of RULES) {
    if (project.settings.disabledRules[rule.id]) continue;
    if (rule.scope === 'projekt') {
      if (!opts.roomId) push(rule, rule.check(ctx));
      continue;
    }
    for (const room of project.rooms) {
      if (opts.roomId && room.id !== opts.roomId) continue;
      if (!room.inScope) continue;
      if (rule.scope === 'raum') push(rule, rule.check(ctx, room), room.id);
      else for (const o of room.outlets) {
        const items = rule.check(ctx, room, o).map((i) => ({ ...i, ref: o.label }));
        push(rule, items, room.id, o.id);
      }
    }
  }
  const counts: Record<Severity, number> = { ok: 0, hinweis: 0, warnung: 0, fehler: 0 };
  for (const f of findings) counts[f.severity]++;
  const order: Record<Severity, number> = { fehler: 0, warnung: 1, hinweis: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, counts };
}

export const severityLabel: Record<Severity, string> = { ok: 'OK', hinweis: 'Hinweis', warnung: 'Warnung', fehler: 'Fehler' };
