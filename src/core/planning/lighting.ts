/**
 * Einfache Beleuchtungsabschätzung (Wirkungsgradverfahren, stark vereinfacht):
 *   benötigter Lichtstrom ≈ Beleuchtungsstärke × Fläche / Nutzungsfaktor
 * Nutzungsfaktor 0,5 (Raumwirkungsgrad × Wartungsfaktor, mittlere Räume).
 * Lux-Ziele je Raumtyp (Richtwerte in Anlehnung an DIN EN 12464-1 / Wohnpraxis).
 */
import type { Project, Room } from '../model/schema';
import { ROOM_TYPE_INFO } from '../model/roomTypes';
import { roomArea } from '../geometry/room';

export const UTILISATION = 0.5;

export function lightingEstimate(project: Project, room: Room) {
  const lux = room.roomType ? ROOM_TYPE_INFO[room.roomType].lux : 200;
  const area = roomArea(room);
  const lumenNeeded = Math.round((lux * area) / UTILISATION);
  const perLuminaire = project.settings.luminaireLumen;
  const recommended = Math.max(1, Math.ceil(lumenNeeded / perLuminaire));
  const existing = room.outlets.filter((o) => (o.kind === 'licht_decke' || o.kind === 'licht_wand') && o.status !== 'bestand_entfaellt').length;
  return { lux, area, lumenNeeded, perLuminaire, recommended, existing };
}
