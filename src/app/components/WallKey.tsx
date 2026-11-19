/**
 * Kleine Raumskizze als Legende: jede Wand mit Nummer (W1, W2 …), Türen und
 * Fenster zur Orientierung, Standpunkt-Hilfe „Wand 1 = oben im Plan“.
 * Eine Wand antippen hebt sie hervor (und meldet es, z. B. an eine Tabelle).
 */
import { wallGeoms } from '../../core/geometry/room';
import type { Room } from '../../core/model/schema';

export function WallKey({ room, highlight, onPick }: { room: Room; highlight?: number; onPick?: (wallIndex: number) => void }) {
  const ws = wallGeoms(room);
  const xs = room.polygon.map((p) => p.x), ys = room.polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = maxX - minX || 1, D = maxY - minY || 1;
  const u = Math.max(W, D) / 100;
  const pad = u * 14;
  const at = (i: number, s: number) => ({ x: ws[i].a.x + ws[i].dir.x * s, y: ws[i].a.y + ws[i].dir.y * s });
  return (
    <figure className="wallkey">
      <svg viewBox={`${minX - pad} ${minY - pad} ${W + 2 * pad} ${D + 2 * pad}`} role="img" aria-label={`Raumskizze mit ${ws.length} Wänden`}>
        <polygon points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill="var(--panel)" stroke="var(--ink)" strokeWidth={u * 1.2} />
        {ws.map((w) => {
          const hl = highlight === w.index;
          const m = at(w.index, w.length / 2);
          // Beschriftung außen neben der Wand (gegen die Innennormale)
          const lab = { x: m.x - w.normal.x * u * 7, y: m.y - w.normal.y * u * 7 };
          const tabu = room.walls[w.index]?.zones.some((z) => z.kind === 'kaminwange' || z.kind === 'tabu');
          return (
            <g key={w.index} className={onPick ? 'pick' : undefined} onClick={onPick ? () => onPick(w.index) : undefined}>
              <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth={u * 10} />
              {tabu && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="var(--muted)" strokeWidth={u * 2.4} strokeDasharray={`${u * 2} ${u * 1.5}`} />}
              {hl && <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="var(--ink)" strokeWidth={u * 5} strokeLinecap="square" />}
              <text x={lab.x} y={lab.y} fontSize={u * (hl ? 8 : w.length < Math.max(W, D) * 0.15 ? 4.5 : 6)} textAnchor="middle" dominantBaseline="central" fill="var(--ink)" fontWeight={700} textDecoration={hl ? 'underline' : undefined}>W{w.index + 1}</text>
            </g>
          );
        })}
        {room.doors.filter((d) => ws[d.wallIndex]).map((d) => {
          const p1 = at(d.wallIndex, d.s), p2 = at(d.wallIndex, d.s + d.width);
          return <line key={d.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--accent)" strokeWidth={u * 3} />;
        })}
        {room.windows.filter((x) => ws[x.wallIndex]).map((x) => {
          const p1 = at(x.wallIndex, x.s), p2 = at(x.wallIndex, x.s + x.width);
          return <line key={x.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--ep-daten)" strokeWidth={u * 3} />;
        })}
        {/* Nullpunkt: hier beginnt Wand 1 */}
        <circle cx={room.polygon[0].x} cy={room.polygon[0].y} r={u * 2.4} fill="var(--panel)" stroke="var(--ink)" strokeWidth={u * 1.2} />
      </svg>
      <figcaption className="small muted">Wand 1 beginnt am Punkt, die Nummern laufen im Uhrzeigersinn. Orange: Tür, Blau: Fenster{room.walls.some((w) => w.zones.length) ? ', gestrichelt: Kamin/Tabuzone' : ''}.{onPick ? ' Wand antippen zum Markieren.' : ''}</figcaption>
    </figure>
  );
}
