/**
 * Leistungsbedarf: Verbraucher je Raum, Belastung je Stromkreis,
 * gleichzeitige Gesamtleistung gegen die Hauptsicherung (Schätzung).
 */
import type { Circuit, Load, Project, Room } from '../model/schema';
import { ROOM_TYPE_INFO, type RoomTypeId } from '../model/roomTypes';
import { newId } from '../model/factory';
import { fmt } from '../geometry/room';

export function loadsForType(type: RoomTypeId, onlyDefault = true): Load[] {
  return ROOM_TYPE_INFO[type].loads.filter((l) => !onlyDefault || l.default).map((l) => ({ id: newId('last'), label: l.label, power: l.power, phases: l.phases, dedicated: l.dedicated, connection: l.connection, height: l.height }));
}

export function roomPower(room: Room): number {
  return room.loads.reduce((s, l) => s + l.power, 0);
}

/** Anschlussleistung eines Stromkreises in W (Summe der zugeordneten Verbraucher). */
export function circuitPower(project: Project, c: Circuit): number {
  const outletIds = new Set(project.rooms.flatMap((r) => r.outlets.filter((o) => o.circuitId === c.id).map((o) => o.id)));
  return project.rooms.flatMap((r) => r.loads).filter((l) => l.outletId && outletIds.has(l.outletId)).reduce((s, l) => s + l.power, 0);
}

/** Belastbarkeit eines Stromkreises in W (Nennstrom des LS). */
export function circuitCapacity(c: Circuit): number {
  return c.poles === 3 ? Math.sqrt(3) * 400 * c.ratedCurrent : 230 * c.ratedCurrent;
}

/** Hauptsicherung aus Freitext („3× 63 A“, „3x50A“, „63 A“). */
export function parseMainFuse(text: string): { phases: number; amps: number; watts: number } | null {
  const m = text.match(/(\d)\s*[×x]\s*(\d{2,3})\s*A/i) ?? text.match(/(\d{2,3})\s*A/i);
  if (!m) return null;
  const phases = m.length > 2 && m[2] ? Number(m[1]) : 3;
  const amps = Number(m.length > 2 && m[2] ? m[2] : m[1]);
  return { phases, amps, watts: phases === 3 ? Math.sqrt(3) * 400 * amps : 230 * amps };
}

export interface Demand {
  installed: number; // W, Summe aller Verbraucher
  simultaneous: number; // W, geschätzt
  mainFuse: ReturnType<typeof parseMainFuse>;
  ratio: number | null;
  biggest: { room: string; label: string; power: number }[];
}

/**
 * Gleichzeitig benötigte Leistung (Schätzung): größter Verbraucher voll,
 * zweitgrößter 60 %, drittgrößter 40 %, Rest 25 %. Nur als Plausibilitätscheck –
 * die Bemessung nach DIN 18015-1 macht die Elektrofachkraft.
 */
export function projectDemand(project: Project): Demand {
  const all = project.rooms.filter((r) => r.inScope).flatMap((r) => r.loads.map((l) => ({ room: r.name, label: l.label, power: l.power })));
  const sorted = [...all].sort((a, b) => b.power - a.power);
  const factors = [1, 0.6, 0.4];
  const simultaneous = sorted.reduce((s, l, i) => s + l.power * (factors[i] ?? 0.25), 0);
  const hv = project.distributions.find((d) => d.kind === 'HV' || d.kind === 'Zaehlerschrank');
  const mainFuse = hv ? parseMainFuse(hv.mainFuse) : null;
  return { installed: all.reduce((s, l) => s + l.power, 0), simultaneous: Math.round(simultaneous), mainFuse, ratio: mainFuse ? simultaneous / mainFuse.watts : null, biggest: sorted.slice(0, 5) };
}

/** Leitung und Absicherung für einen Großverbraucher (Richtwert, Elektriker bestätigt). */
export function circuitForLoad(l: Load): { cable: string; characteristic: 'B' | 'C'; ratedCurrent: number; poles: 1 | 3 } {
  if (l.phases === 3) {
    const amps = l.power / (Math.sqrt(3) * 400);
    if (amps <= 16) return { cable: /wallbox/i.test(l.label) ? 'NYM-J 5×6' : 'NYM-J 5×2,5', characteristic: /wallbox/i.test(l.label) ? 'C' : 'B', ratedCurrent: 16, poles: 3 };
    if (amps <= 20) return { cable: 'NYM-J 5×4', characteristic: 'B', ratedCurrent: 20, poles: 3 };
    if (amps <= 32) return { cable: 'NYM-J 5×6', characteristic: 'B', ratedCurrent: 32, poles: 3 };
    return { cable: 'NYM-J 5×10', characteristic: 'B', ratedCurrent: 40, poles: 3 };
  }
  return { cable: 'NYM-J 3×2,5', characteristic: 'B', ratedCurrent: 16, poles: 1 };
}

export const kw = (w: number) => (Math.abs(w) < 1000 ? `${fmt(w, 0)} W` : `${fmt(w / 1000, 1)} kW`);
