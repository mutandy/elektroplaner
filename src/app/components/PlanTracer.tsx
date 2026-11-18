/**
 * Grundriss als Hintergrund: hochladen, Maßstab kalibrieren (zwei Punkte +
 * bekanntes Maß), Räume als Rechteck aufziehen. Ergebnis immer in cm.
 * Zoomen mit Mausrad, zwei Fingern oder den Knöpfen; Ziehen verschiebt den
 * Ausschnitt, ein kurzer Klick/Tipp setzt einen Punkt.
 */
import { useEffect, useRef, useState } from 'react';
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
  const size = floor.backgroundSize;
  const full = { x: 0, y: 0, w: size?.w ?? 1, h: size?.h ?? 1 };
  const [vb, setVb] = useState(full);
  // neues Bild → ganzer Plan
  useEffect(() => { setVb(full); setPts([]); }, [floor.backgroundPlan, size?.w, size?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zeiger (Maus/Finger) für Verschieben und Zwei-Finger-Zoom
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ start: Pt; vb: typeof vb; moved: boolean; pinch?: { dist: number; mid: Pt; vb: typeof vb } } | null>(null);
  const vbRef = useRef(vb);
  vbRef.current = vb;

  const clampVb = (v: typeof vb) => {
    const minW = full.w / 25;
    const wNew = Math.min(full.w * 1.2, Math.max(minW, v.w));
    const hNew = v.h * (wNew / v.w);
    return { x: Math.min(full.w - wNew * 0.2, Math.max(-wNew * 0.8, v.x)), y: Math.min(full.h - hNew * 0.2, Math.max(-hNew * 0.8, v.y)), w: wNew, h: hNew };
  };
  /** Zoom um Faktor f (<1 = hinein) um den Bildpunkt c */
  const zoomAt = (f: number, c?: Pt) => setVb((v) => {
    const cx = c?.x ?? v.x + v.w / 2, cy = c?.y ?? v.y + v.h / 2;
    return clampVb({ x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w: v.w * f, h: v.h * f });
  });

  // Mausrad: nicht-passiver Listener, damit die Seite nicht mitscrollt
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = clientToPx(e.clientX, e.clientY);
      zoomAt(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!floor.backgroundPlan || !floor.backgroundSize) return null;
  const { w, h } = floor.backgroundSize;
  const scale = floor.backgroundScale; // cm/px
  const sw = Math.max(vb.w, vb.h) / 400; // Strichstärke bleibt beim Zoomen gleich dick
  const zoomPct = Math.round((Math.max(w, h) / Math.max(vb.w, vb.h)) * 100);

  function clientToPx(cx: number, cy: number): Pt {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = cx;
    p.y = cy;
    const r = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10 };
  }
  const toPx = (e: React.PointerEvent): Pt => clientToPx(e.clientX, e.clientY);

  const click = (p: Pt) => {
    if (mode === 'ansehen') return;
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

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { start: { x: e.clientX, y: e.clientY }, vb: vbRef.current, moved: false };
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.moved = true; // zwei Finger: nie als Klick werten
      gesture.current.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: clientToPx((a.x + b.x) / 2, (a.y + b.y) / 2), vb: vbRef.current };
    }
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== 'ansehen') setHover(toPx(e));
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const ctm = svgRef.current!.getScreenCTM()!;
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const f = g.pinch.dist / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const c = g.pinch.mid, v0 = g.pinch.vb;
      setVb(clampVb({ x: c.x - (c.x - v0.x) * f, y: c.y - (c.y - v0.y) * f, w: v0.w * f, h: v0.h * f }));
      return;
    }
    const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.moved) setVb(clampVb({ ...g.vb, x: g.vb.x - dx / ctm.a, y: g.vb.y - dy / ctm.d }));
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (g && wasSingle && !g.moved) click(toPx(e));
    if (pointers.current.size === 0) gesture.current = null;
    else if (g) g.pinch = undefined;
  };

  const distPx = pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0;

  return (
    <div className="tracer">
      <div className="tracer-tools">
        <button type="button" onClick={() => zoomAt(1 / 1.5)} title="Hineinzoomen" aria-label="Hineinzoomen">＋</button>
        <button type="button" onClick={() => zoomAt(1.5)} title="Herauszoomen" aria-label="Herauszoomen">−</button>
        <button type="button" onClick={() => setVb(full)} disabled={zoomPct === 100}>Ganzer Plan</button>
        <span className="muted small">{zoomPct} % · Mausrad oder zwei Finger zoomen, ziehen verschiebt{mode !== 'ansehen' ? ', kurz klicken setzt den Punkt' : ''}</span>
      </div>
      <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={`tracer-svg mode-${mode}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}>
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
        {hover && mode !== 'ansehen' && <g pointerEvents="none" stroke="#dc2626" strokeWidth={sw * 0.5} strokeDasharray={`${sw * 3} ${sw * 2}`} opacity={0.7}>
          <line x1={vb.x} x2={vb.x + vb.w} y1={hover.y} y2={hover.y} />
          <line x1={hover.x} x2={hover.x} y1={vb.y} y2={vb.y + vb.h} />
        </g>}
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
