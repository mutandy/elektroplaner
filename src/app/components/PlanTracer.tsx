/**
 * Grundriss als Hintergrund: hochladen, Maßstab kalibrieren (zwei Punkte +
 * bekanntes Maß), Räume als Rechteck aufziehen. Ergebnis immer in cm.
 */
import { useRef, useState } from 'react';
import type { FloorLevel, Room } from '../../core/model/schema';
import { NumberInput } from './ui';

export interface ImageData { dataUrl: string; w: number; h: number }

/** Bild laden und auf max. Kantenlänge verkleinern (hält die Projektdatei klein). */
export function loadImage(file: File, maxPx = 2400): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * f);
      const h = Math.round(img.naturalHeight * f);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.82), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden (JPG oder PNG verwenden; PDF bitte als Foto/Screenshot).')); };
    img.src = url;
  });
}

type Pt = { x: number; y: number };
export type TracerMode = 'ansehen' | 'kalibrieren' | 'raum';

export function PlanTracer({ floor, rooms, mode, onCalibrate, onRect, highlightRoomId }: {
  floor: FloorLevel;
  rooms: Room[];
  mode: TracerMode;
  onCalibrate?: (cmPerPx: number) => void;
  onRect?: (r: { x: number; y: number; w: number; d: number }) => void;
  highlightRoomId?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [len, setLen] = useState<number | null>(null);
  if (!floor.backgroundPlan || !floor.backgroundSize) return null;
  const { w, h } = floor.backgroundSize;
  const scale = floor.backgroundScale; // cm/px
  const sw = Math.max(w, h) / 400;

  const toPx = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const r = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10 };
  };

  const click = (e: React.PointerEvent) => {
    if (mode === 'ansehen') return;
    const p = toPx(e);
    const next = pts.length >= 2 ? [p] : [...pts, p];
    setPts(next);
    if (mode === 'raum' && next.length === 2 && scale && onRect) {
      const [a, b] = next;
      onRect({
        x: Math.round(Math.min(a.x, b.x) * scale), y: Math.round(Math.min(a.y, b.y) * scale),
        w: Math.round(Math.abs(b.x - a.x) * scale), d: Math.round(Math.abs(b.y - a.y) * scale),
      });
      setPts([]);
    }
  };

  const distPx = pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0;

  return (
    <div className="tracer">
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} className={`tracer-svg mode-${mode}`}
        onPointerDown={click} onPointerMove={(e) => mode !== 'ansehen' && setHover(toPx(e))} onPointerLeave={() => setHover(null)}>
        <image href={floor.backgroundPlan} width={w} height={h} opacity={floor.backgroundOpacity} />
        {scale && rooms.map((r) => {
          const pts = r.polygon.map((p) => `${(p.x + r.originOnFloor.x) / scale},${(p.y + r.originOnFloor.y) / scale}`).join(' ');
          const xs = r.polygon.map((p) => p.x);
          const ys = r.polygon.map((p) => p.y);
          const c = { x: (r.originOnFloor.x + (Math.min(...xs) + Math.max(...xs)) / 2) / scale, y: (r.originOnFloor.y + (Math.min(...ys) + Math.max(...ys)) / 2) / scale };
          const hl = r.id === highlightRoomId;
          return (
            <g key={r.id}>
              <polygon points={pts} fill={hl ? 'rgba(37,99,235,.25)' : 'rgba(37,99,235,.08)'} stroke="#2563eb" strokeWidth={hl ? sw * 2 : sw} />
              <text x={c.x} y={c.y} fontSize={sw * 9} textAnchor="middle" fill="#1d4ed8" fontWeight={700} style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: sw * 2 }}>{r.name}</text>
            </g>
          );
        })}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={sw * 3} fill="#dc2626" />)}
        {pts.length === 1 && hover && (mode === 'kalibrieren'
          ? <line x1={pts[0].x} y1={pts[0].y} x2={hover.x} y2={hover.y} stroke="#dc2626" strokeWidth={sw} />
          : <rect x={Math.min(pts[0].x, hover.x)} y={Math.min(pts[0].y, hover.y)} width={Math.abs(hover.x - pts[0].x)} height={Math.abs(hover.y - pts[0].y)} fill="rgba(220,38,38,.15)" stroke="#dc2626" strokeWidth={sw} />)}
        {pts.length === 2 && mode === 'kalibrieren' && <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="#dc2626" strokeWidth={sw * 1.5} />}
      </svg>
      {mode === 'kalibrieren' && (
        <div className="inline">
          {pts.length < 2
            ? <span className="muted small">Klicke Anfang und Ende eines bekannten Maßes (z. B. die Maßkette „18.00“). {pts.length === 1 ? 'Jetzt den zweiten Punkt.' : ''}</span>
            : <>
              <span>Diese Strecke ist in Wirklichkeit</span>
              <NumberInput value={len} onChange={setLen} placeholder="cm" />
              <span>cm lang.</span>
              <button className="primary" disabled={!len} onClick={() => { if (len && distPx > 0) { onCalibrate?.(len / distPx); setPts([]); } }}>Maßstab übernehmen</button>
              <button onClick={() => setPts([])}>Neu klicken</button>
            </>}
        </div>
      )}
      {mode === 'raum' && <p className="muted small">Klicke zwei gegenüberliegende Ecken des Raums (Innenkanten). Das Programm übernimmt Lage und Größe – die Maße kannst du danach mit dem Aufmaß überschreiben.</p>}
    </div>
  );
}
