import { readFileSync } from 'node:fs';
import { loadProject, createProject, createRectRoom } from '../src/core/model/factory';
import { Project } from '../src/core/model/schema';

export const example = () => loadProject(readFileSync(new URL('../examples/kellerwohnung.json', import.meta.url), 'utf8'));

/** Minimalprojekt mit einem 400×300-Raum, Tür in Wand 1 (s 100, 90 breit, Bänder links). */
export function miniProject(extra: Partial<Parameters<typeof createRectRoom>[0]> = {}) {
  const room = createRectRoom({
    id: 'r1', floorId: 'geschoss_eg', name: 'Testraum', width: 400, depth: 300, height: 250,
    wallDefaults: { material: 'kalksandstein' },
    ceiling: { construction: 'stahlbeton' },
    doors: [{ id: 'd1', wallIndex: 0, s: 100, width: 90, hinge: 'links', swing: 'innen' }],
    confirmed: true,
    ...extra,
  });
  return Project.parse({ ...createProject({ id: 'p' }), rooms: [room] });
}
