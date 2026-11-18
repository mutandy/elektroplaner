/**
 * Interaktive Draufsicht und Wandabwicklung: dieselben SVG-Generatoren wie im
 * PDF, zusätzlich Auswahl und Verschieben von Auslässen per Maus/Finger.
 */
import { useMemo, useRef } from 'react';
import type { Project, Room } from '../../core/model/schema';
import { renderRoomPlan, type Layer } from '../../core/render/plan';
import { renderElevation } from '../../core/render/elevation';
import { wallGeoms, wallLength } from '../../core/geometry/room';
import { store } from '../store';

const snap = (v: number, step = 0.5) => Math.round(v / step) * step;

/** Bildschirm-Maßstab: Schrift/Striche skalieren mit, damit große Räume lesbar bleiben. */
function screenScale(room: Room) {
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.max(40, Math.round(size / 9));
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const m = svg.getScreenCTM();
  return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}

function useDrag(project: Project, room: Room, mode: 'plan' | 'elevation', wallIndex?: number) {
  const drag = useRef<{ id: string; before: Project; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = (e.target as Element).closest('[data-outlet]');
    if (!target) return;
    const id = target.getAttribute('data-outlet')!;
    store.setUi({ outletId: id });
    drag.current = { id, before: store.getState().project!, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const svg = (e.currentTarget as HTMLElement).querySelector('svg');
    if (!svg) return;
    const p = svgPoint(svg, e.clientX, e.clientY);
    d.moved = true;
    store.preview((draft) => {
      const r = draft.rooms.find((x) => x.id === room.id);
      const o = r?.outlets.find((x) => x.id === d.id);
      if (!r || !o) return;
      if (mode === 'plan') {
        if (o.mount === 'wand' && o.wallIndex != null) {
          const w = wallGeoms(r as Room)[o.wallIndex];
          const s = (p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y;
          o.s = Math.max(0, Math.min(w.length, snap(s)));
        } else {
          o.x = snap(p.x);
          o.y = snap(p.y);
        }
      } else if (o.mount === 'wand' && o.wallIndex === wallIndex) {
        o.s = Math.max(0, Math.min(wallLength(r as Room, wallIndex!), snap(p.x)));
        o.z = Math.max(0, Math.min(r.height, snap(r.height - p.y)));
      }
    });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const o = store.getState().project?.rooms.find((r) => r.id === room.id)?.outlets.find((x) => x.id === d.id);
    store.commit(`${room.name}: ${o?.label ?? 'Auslass'} verschoben`, d.before);
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

export function RoomPlan({ project, room, layers, selectedOutletId }: { project: Project; room: Room; layers: Layer[]; selectedOutletId?: string }) {
  const svg = useMemo(() => renderRoomPlan(project, room, { layers, selectedOutletId, screen: true, scale: screenScale(room) }), [project, room, layers, selectedOutletId]);
  const handlers = useDrag(project, room, 'plan');
  return <div className="canvas" {...handlers} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function WallElevation({ project, room, wallIndex, layers, selectedOutletId }: { project: Project; room: Room; wallIndex: number; layers: Layer[]; selectedOutletId?: string }) {
  const svg = useMemo(() => renderElevation(project, room, wallIndex, { layers, selectedOutletId, screen: true, scale: Math.max(35, Math.round(wallLength(room, wallIndex) / 9)) }), [project, room, wallIndex, layers, selectedOutletId]);
  const handlers = useDrag(project, room, 'elevation', wallIndex);
  return <div className="canvas elevation" {...handlers} dangerouslySetInnerHTML={{ __html: svg }} />;
}
