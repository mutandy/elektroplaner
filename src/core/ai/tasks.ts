/**
 * KI-Aufgaben (Claude-API): Schema der erwarteten Antwort, Anweisung und die
 * Übernahme ins Projekt. Der eigentliche API-Aufruf liegt in src/app/ai/.
 *
 * Grundsatz: Die KI liefert nur VORSCHLÄGE. Jede Übernahme zeigt die Oberfläche
 * vorher zur Prüfung an; übernommene Werte werden als „aus Plan“ bzw. „Annahme“
 * markiert und bleiben vor Ort zu prüfen.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Draft } from 'immer';
import type { Project, Room } from '../model/schema';
import { ROOM_TYPES, ROOM_TYPE_INFO } from '../model/roomTypes';
import { FURNITURE_TYPES } from '../model/catalog';
import { createRectRoom, newId } from '../model/factory';
import { wallGeoms } from '../geometry/room';

/** JSON-Schema für strukturierte Ausgabe (ohne $schema, alle Objekte geschlossen). */
export function jsonSchemaFor(schema: z.ZodTypeAny): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

// ---------------------------------------------------------------------------
// 1) Grundriss auslesen
// ---------------------------------------------------------------------------

export const FloorPlanResult = z.object({
  rooms: z.array(z.object({
    label: z.string().describe('Bezeichnung genau wie im Plan, z. B. „HEIZUNG“ oder „KELLER ③“'),
    bbox: z.object({
      x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number(),
    }).describe('Innenkanten des Raums als Anteil der Bildbreite/-höhe (0 = links/oben, 1 = rechts/unten)'),
    widthM: z.number().nullable().describe('Innenmaß waagerecht laut Bemaßung im Plan in Metern, sonst null'),
    depthM: z.number().nullable().describe('Innenmaß senkrecht laut Bemaßung im Plan in Metern, sonst null'),
    kind: z.enum(['raum', 'flur', 'treppe', 'schacht', 'sonstiges']),
    notes: z.string().describe('Auffälligkeiten: Kamin, Türen, Fenster/Lichtschacht, Brandschutztür (FHT/T30), unsichere Lesung'),
  })),
  overallDimension: z.object({
    lengthM: z.number().nullable(),
    description: z.string(),
  }).describe('Größtes eindeutig lesbares Gesamtmaß (z. B. Außenmaß der Maßkette) – hilft beim Maßstab'),
  notes: z.string(),
});
export type FloorPlanResult = z.infer<typeof FloorPlanResult>;

export const FLOOR_PLAN_PROMPT = `Du liest einen Bauplan/Grundriss (oft ein schräg fotografierter Papierplan) für eine Elektroplanung.
Erfasse jeden Raum mit seiner Bezeichnung GENAU wie im Plan (auch Nummern in Kreisen, z. B. „KELLER ③“), seiner Lage im Bild (Innenkanten als Anteil 0–1 der Bildbreite/-höhe) und – nur wenn eine Bemaßung eindeutig zum Raum gehört – Breite und Tiefe in Metern (Plan-Notation „3.38“ oder „4.82“ = Meter; hochgestellte Ziffern wie „3.56⁵“ = 3,565 m).
Erfinde keine Maße: Wenn du unsicher bist, setze null und schreibe den Grund in notes. Farbige Umrandungen sind keine Raumgrenzen, sondern Markierungen. Treppen, Schächte und Flure gesondert kennzeichnen.
Antworte ausschließlich im vorgegebenen JSON-Format, alle Texte auf Deutsch.`;

/** Vorschläge aus dem Grundriss ins Projekt übernehmen (ausgewählte Einträge). */
export function applyFloorPlan(p: Draft<Project>, floorId: string, result: FloorPlanResult, picks: { index: number; name: string }[]) {
  const floor = p.floors.find((f) => f.id === floorId);
  if (!floor) return [];
  const size = floor.backgroundSize;
  const scale = floor.backgroundScale;
  const created: string[] = [];
  for (const pick of picks) {
    const r = result.rooms[pick.index];
    if (!r) continue;
    const bw = Math.abs(r.bbox.x1 - r.bbox.x0), bh = Math.abs(r.bbox.y1 - r.bbox.y0);
    // Maße: bevorzugt Bemaßung aus dem Plan, sonst aus Lage × Maßstab
    const fromBox = size && scale ? { w: bw * size.w * scale, d: bh * size.h * scale } : null;
    const w = r.widthM ? r.widthM * 100 : fromBox?.w ?? 300;
    const d = r.depthM ? r.depthM * 100 : fromBox?.d ?? 300;
    const origin = size && scale ? { x: Math.round(Math.min(r.bbox.x0, r.bbox.x1) * size.w * scale), y: Math.round(Math.min(r.bbox.y0, r.bbox.y1) * size.h * scale) } : { x: 0, y: 0 };
    const room = createRectRoom({
      id: newId('raum'), floorId, name: pick.name || r.label, formerName: r.label,
      width: Math.round(w), depth: Math.round(d), height: Math.max(200, floor.height - 25),
      originOnFloor: origin, provenance: 'aus_plan',
      roomType: r.kind === 'flur' ? 'flur' : undefined,
      installationType: p.settings.defaultInstallationType,
      note: r.notes ? `Aus Grundriss (KI): ${r.notes}` : '',
    });
    p.rooms.push(room as any);
    created.push(room.id);
  }
  return created;
}

// ---------------------------------------------------------------------------
// 2) Foto der Verteilung auslesen
// ---------------------------------------------------------------------------

export const DistributionPhotoResult = z.object({
  devices: z.array(z.object({
    kind: z.enum(['LS', 'RCD', 'RCBO', 'SPD', 'Hauptschalter', 'NH/Neozed', 'sonstiges']),
    characteristic: z.enum(['B', 'C', 'D']).nullable(),
    ratedCurrent: z.number().nullable().describe('Nennstrom in A'),
    poles: z.number().int().nullable(),
    residualCurrent: z.number().nullable().describe('Bemessungsdifferenzstrom in mA (nur RCD/RCBO)'),
    rcdType: z.enum(['A', 'F', 'B', 'AC']).nullable(),
    count: z.number().int().describe('Anzahl gleicher Geräte nebeneinander'),
    label: z.string().nullable().describe('Beschriftung am oder unter dem Gerät, falls lesbar'),
  })),
  freeModules: z.number().int().nullable().describe('Freie Teilungseinheiten (Blindabdeckungen/leere Plätze)'),
  mainFuse: z.string().nullable(),
  uncertain: z.array(z.string()).describe('Was nicht sicher lesbar war'),
});
export type DistributionPhotoResult = z.infer<typeof DistributionPhotoResult>;

export const DISTRIBUTION_PROMPT = `Du liest ein Foto einer elektrischen Verteilung (Sicherungskasten) für eine Planung, die eine Elektrofachkraft prüft.
Erfasse von links nach rechts, Reihe für Reihe, jedes Gerät: Leitungsschutzschalter (Aufdruck z. B. „B16“ = Charakteristik B, 16 A; Polzahl an der Breite), FI/RCD (z. B. „40 A / 0,03 A“ = 30 mA, Typ-Symbol), RCBO, Überspannungsschutz, Hauptschalter, Schmelzsicherungen.
Gleiche Geräte direkt nebeneinander zusammenfassen (count). Zähle freie Plätze/Blindabdeckungen als freie Teilungseinheiten.
Nur angeben, was du auf dem Foto siehst; Unlesbares als null setzen und in uncertain beschreiben. Antworte ausschließlich im vorgegebenen JSON-Format, Texte auf Deutsch.`;

export function applyDistributionPhoto(p: Draft<Project>, distributionId: string, r: DistributionPhotoResult) {
  const d = p.distributions.find((x) => x.id === distributionId);
  if (!d) return;
  for (const dev of r.devices) {
    if ((dev.kind === 'LS' || dev.kind === 'RCBO') && dev.characteristic && dev.ratedCurrent) {
      const poles = dev.poles === 3 ? 3 : 1;
      const g = d.breakers.find((b) => b.characteristic === dev.characteristic && b.ratedCurrent === dev.ratedCurrent && b.poles === poles);
      if (g) g.count += dev.count;
      else d.breakers.push({ id: newId('ls'), characteristic: dev.characteristic, ratedCurrent: dev.ratedCurrent, poles, count: dev.count, free: 0, note: `aus Foto (KI)${dev.label ? ': ' + dev.label : ''}` });
    }
    if (dev.kind === 'RCD' || dev.kind === 'RCBO') {
      for (let i = 0; i < Math.max(1, dev.count); i++) {
        d.rcds.push({ id: newId('fi'), label: `FI ${dev.ratedCurrent ?? '?'} A / ${dev.residualCurrent ?? '?'} mA${dev.rcdType ? ', Typ ' + dev.rcdType : ''} (Foto)`, ratedCurrent: dev.ratedCurrent ?? 40, residualCurrent: dev.residualCurrent ?? 30, type: dev.rcdType === 'F' || dev.rcdType === 'B' ? dev.rcdType : 'A', poles: (dev.poles ?? 4) >= 4 ? 4 : 2, existing: true });
      }
    }
    if (dev.kind === 'SPD') d.hasSpd = true;
  }
  if (r.freeModules != null) d.freeModules = r.freeModules;
  if (r.mainFuse && !d.mainFuse) d.mainFuse = r.mainFuse;
  const unsure = r.uncertain.length ? ` Unsicher: ${r.uncertain.join('; ')}` : '';
  d.note = `${d.note ? d.note + ' ' : ''}Bestand aus Foto ausgelesen (KI) – von der Elektrofachkraft zu bestätigen. Freie LS je Gruppe bitte eintragen.${unsure}`.trim();
}

// ---------------------------------------------------------------------------
// 3) Raumbeschreibung (Freitext) → Nutzung, Geräte, Möbel
// ---------------------------------------------------------------------------

const furnitureKinds = FURNITURE_TYPES.map((f) => f.kind) as [string, ...string[]];

export const RoomTextResult = z.object({
  roomType: z.enum(ROOM_TYPES).nullable(),
  usage: z.string(),
  futureUsage: z.string(),
  loads: z.array(z.object({
    label: z.string(),
    power: z.number().describe('Leistung in W (typischer Wert, wenn nicht genannt)'),
    phases: z.union([z.literal(1), z.literal(3)]),
    dedicated: z.boolean().describe('eigener Stromkreis empfohlen (Großgerät ab ca. 2 kW, Kühlgerät, Drehstrom)'),
  })),
  furniture: z.array(z.object({
    kind: z.enum(furnitureKinds),
    label: z.string(),
    wallSide: z.enum(['oben', 'rechts', 'unten', 'links', 'unbekannt']).describe('an welcher Wand im Plan (oben = Wand 1 bei rechteckigen Räumen)'),
    widthCm: z.number().nullable(),
    depthCm: z.number().nullable(),
  })),
  wishes: z.array(z.string()).describe('Wünsche zu Steckdosen, Licht, Schaltern, Netzwerk, Smart Home'),
  questions: z.array(z.string()).describe('Was zur Planung noch unklar ist'),
});
export type RoomTextResult = z.infer<typeof RoomTextResult>;

export function roomTextPrompt(room: Room) {
  return `Ein Bauherr beschreibt einen Raum für die Elektroplanung in eigenen Worten. Raum: „${room.name}“${room.formerName ? ` (im Bestandsplan „${room.formerName}“)` : ''}, Innenmaß ca. ${Math.round(wallGeoms(room)[0]?.length ?? 0)} × ${Math.round(wallGeoms(room)[1]?.length ?? 0)} cm.
Bestimme den Raumtyp (${ROOM_TYPES.map((t) => `${t} = ${ROOM_TYPE_INFO[t].label}`).join(', ')}), die Geräte mit Leistung (typische Werte, wenn nicht genannt; Drehstrom nur, wenn das Gerät ihn braucht), die Möbel (nur aus der vorgegebenen Liste) mit Wandseite im Plan, Wünsche zur Elektroausstattung und offene Fragen.
Erfinde nichts, was nicht beschrieben ist. Antworte ausschließlich im vorgegebenen JSON-Format, Texte auf Deutsch.`;
}

const SIDE_TO_WALL: Record<string, number> = { oben: 0, rechts: 1, unten: 2, links: 3 };

export function applyRoomText(p: Draft<Project>, roomId: string, r: RoomTextResult, opts: { type: boolean; loads: boolean; furniture: boolean }) {
  const room = p.rooms.find((x) => x.id === roomId);
  if (!room) return;
  if (opts.type && r.roomType) {
    room.roomType = r.roomType;
    if (ROOM_TYPE_INFO[r.roomType].wetRoom) room.wetRoom = true;
  }
  if (r.usage && !room.usage) room.usage = r.usage;
  if (r.futureUsage && !room.futureUsage) room.futureUsage = r.futureUsage;
  if (opts.loads) for (const l of r.loads) {
    if (room.loads.some((x) => x.label.toLowerCase() === l.label.toLowerCase())) continue;
    room.loads.push({ id: newId('last'), label: l.label, power: l.power, phases: l.phases, dedicated: l.dedicated, connection: l.phases === 3 ? 'anschlussdose' : 'steckdose' });
  }
  if (opts.furniture) {
    const ws = wallGeoms(room as Room);
    for (const f of r.furniture) {
      const t = FURNITURE_TYPES.find((x) => x.kind === f.kind)!;
      const w = f.widthCm ?? t.w, d = f.depthCm ?? t.d;
      const wi = SIDE_TO_WALL[f.wallSide];
      const len = wi != null && ws[wi] ? ws[wi].length : 0;
      // grob an die Wand stellen (Mitte), Feinlage im Plan
      let x = 20, y = 20;
      if (wi === 0) { x = Math.max(0, len / 2 - w / 2); y = 0; }
      if (wi === 1) { x = (ws[0]?.length ?? 300) - d; y = Math.max(0, len / 2 - w / 2); }
      if (wi === 2) { x = Math.max(0, len / 2 - w / 2); y = (ws[1]?.length ?? 300) - d; }
      if (wi === 3) { x = 0; y = Math.max(0, len / 2 - w / 2); }
      const rotated = wi === 1 || wi === 3;
      room.furniture.push({ id: newId('m'), kind: f.kind, label: f.label || t.label, x: Math.round(x), y: Math.round(y), w: rotated ? d : w, d: rotated ? w : d, height: t.height, wallIndex: wi, note: 'aus Beschreibung (KI) – Lage prüfen' });
    }
  }
  const extra = [...r.wishes.map((x) => `Wunsch: ${x}`), ...r.questions.map((x) => `Offen: ${x}`)];
  if (extra.length) room.note = [room.note, ...extra].filter(Boolean).join('\n');
}
