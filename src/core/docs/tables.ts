/** Tabellen-Daten (aus dem Modell abgeleitet) – für UI, PDF und spätere Exporte. */
import type { Project, Room } from '../model/schema';
import { boxCenters, fmt, wallName, zToFfb } from '../geometry/room';
import { boxTypeLabel, insertLabel, outletKindLabel } from '../model/labels';

export interface BoxRow {
  label: string;
  kind: string;
  where: string;
  s: string;
  z: string;
  zFfb: string;
  gangs: number;
  orientation: string;
  boxType: string;
  inserts: string;
  circuit: string;
  status: string;
  note: string;
  /** Einzelne Dosenmitten bei Mehrfachkombinationen. */
  centers: { n: number; s: string; z: string }[];
  outletId: string;
}

const statusLabel: Record<string, string> = {
  neu: 'neu', bestand_bleibt: 'Bestand bleibt', bestand_wird_ersetzt: 'Bestand → ersetzen', bestand_entfaellt: 'Bestand entfällt',
};

export function boxTable(project: Project, room: Room): BoxRow[] {
  const byLabel = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
  return [...room.outlets].sort((a, b) => byLabel(a.label, b.label)).map((o) => {
    const c = project.circuits.find((c) => c.id === o.circuitId);
    const centers = boxCenters(o, project.settings).map((b) => ({ n: b.n, s: fmt(b.s), z: fmt(b.z) }));
    const isWall = o.mount === 'wand';
    return {
      outletId: o.id,
      label: o.label,
      kind: outletKindLabel[o.kind],
      where: isWall ? wallName(room, o.wallIndex ?? 0) : o.mount === 'decke' ? 'Decke' : 'Boden',
      s: isWall ? fmt(o.s) : `x ${fmt(o.x)} / y ${fmt(o.y)}`,
      z: isWall ? fmt(o.z) : '–',
      zFfb: isWall && o.z != null ? fmt(zToFfb(room, o.z)) : '–',
      gangs: o.gangs,
      orientation: o.gangs > 1 ? o.orientation : '–',
      boxType: boxTypeLabel[o.boxType],
      inserts: o.inserts.map((i) => insertLabel[i]).join(', '),
      circuit: c ? c.label : '',
      status: statusLabel[o.status],
      note: o.note,
      centers,
    };
  });
}

/** Einsatz-Stückliste über alle (geplanten) Räume. */
export function insertBom(project: Project) {
  const counts = new Map<string, number>();
  const frames = new Map<number, number>();
  for (const r of project.rooms.filter((r) => r.inScope)) {
    for (const o of r.outlets) {
      if (o.status === 'bestand_bleibt' || o.status === 'bestand_entfaellt') continue;
      for (const i of o.inserts) counts.set(insertLabel[i], (counts.get(insertLabel[i]) ?? 0) + 1);
      if (o.mount === 'wand' && o.inserts.length && o.boxType !== 'aufputz' && o.boxType !== 'aufputz_holz') {
        frames.set(o.gangs, (frames.get(o.gangs) ?? 0) + 1);
      }
    }
  }
  return {
    inserts: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    frames: [...frames.entries()].sort((a, b) => a[0] - b[0]),
  };
}

export function circuitTable(project: Project) {
  return project.circuits.map((c) => {
    const dist = project.distributions.find((d) => d.id === c.distributionId);
    const rcd = dist?.rcds.find((r) => r.id === c.rcdId);
    const outlets = project.rooms.flatMap((r) => r.outlets.filter((o) => o.circuitId === c.id).map((o) => ({ room: r.name, label: o.label })));
    const rooms = [...new Set(outlets.map((o) => o.room))];
    return {
      id: c.id,
      label: c.label,
      name: c.name,
      distribution: dist?.name ?? '?',
      breaker: `${c.poles === 3 ? '3× ' : ''}${c.characteristic}${c.ratedCurrent}`,
      existingBreaker: c.breakerGroupId ? 'vorhanden' : 'neu nötig',
      rcd: rcd?.label ?? '—',
      cable: c.cable,
      afdd: c.afdd ? 'ja' : '—',
      rooms: rooms.join(', '),
      outlets: outlets.map((o) => o.label).join(', '),
      count: outlets.length,
      reason: c.reason,
    };
  });
}
