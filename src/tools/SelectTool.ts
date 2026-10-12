import * as THREE from 'three';
import { eraseEdges, eraseFaces } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import { boxFrom, boxMode, edgeInBox, polygonInBox, type BoxMode } from './boxSelect';
import type { EntityRef } from './Selection';
import type { Tool, ToolContext } from './Tool';

const DRAG_THRESHOLD = 4; // px before a click becomes a selection box

export function createSelectTool(ctx: ToolContext): Tool {
  const model = ctx.doc.model;
  const boxEl = document.createElement('div');
  boxEl.className = 'select-box';
  boxEl.hidden = true;
  ctx.viewport.container.append(boxEl);

  let down: { at: THREE.Vector2; shift: boolean } | null = null;
  let dragging = false;

  const entityAt = (e: PointerEvent): EntityRef | null => {
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false, guides: false });
    if (pick.kind === 'edge' || pick.kind === 'midpoint') return { kind: 'edge', id: pick.id };
    if (pick.kind === 'face') return { kind: 'face', id: pick.id };
    return null;
  };

  /** Everything inside (window) or touching (crossing) a client-space box. */
  const entitiesIn = (box: THREE.Box2, mode: BoxMode): { faces: Id[]; edges: Id[] } => {
    const screen = new Map<Id, THREE.Vector2 | null>();
    const at = (v: Id) => {
      if (!screen.has(v)) screen.set(v, ctx.viewport.toScreen(model.position(v)));
      return screen.get(v)!;
    };
    const edges = model.allEdges().filter((e) => {
      const a = at(e.a);
      const b = at(e.b);
      return !!a && !!b && edgeInBox(a, b, box, mode);
    });
    const faces = model.allFaces().filter((f) => {
      const outline = f.outer.map(at);
      return outline.every((p) => p) && polygonInBox(outline as THREE.Vector2[], box, mode);
    });
    return { faces: faces.map((f) => f.id), edges: edges.map((e) => e.id) };
  };

  const showBox = (start: THREE.Vector2, end: THREE.Vector2) => {
    const rect = ctx.viewport.container.getBoundingClientRect();
    const box = boxFrom(start, end);
    boxEl.hidden = false;
    boxEl.dataset.mode = boxMode(start, end);
    Object.assign(boxEl.style, {
      left: `${box.min.x - rect.left}px`,
      top: `${box.min.y - rect.top}px`,
      width: `${box.max.x - box.min.x}px`,
      height: `${box.max.y - box.min.y}px`,
    });
    return box;
  };

  const reset = () => {
    down = null;
    dragging = false;
    boxEl.hidden = true;
    ctx.renderer.setHover(null);
  };

  return {
    id: 'select',
    label: 'Select',
    shortcut: 'Space',
    hint: 'Click to select, drag a box to select several (left to right: fully inside; right to left: touching). Shift adds. Delete erases.',
    cursor: 'default',

    pointerDown(e) {
      down = { at: new THREE.Vector2(e.clientX, e.clientY), shift: e.shiftKey };
      dragging = false;
    },

    pointerMove(e) {
      const at = new THREE.Vector2(e.clientX, e.clientY);
      if (down && e.buttons & 1) {
        if (!dragging && at.distanceTo(down.at) > DRAG_THRESHOLD) dragging = true;
        if (dragging) {
          const box = showBox(down.at, at);
          ctx.renderer.setHover(entitiesIn(box, boxMode(down.at, at)));
        }
        return;
      }
      const ref = entityAt(e);
      ctx.renderer.setHover(ref && { faces: ref.kind === 'face' ? [ref.id] : [], edges: ref.kind === 'edge' ? [ref.id] : [] });
    },

    pointerUp(e) {
      if (!down) return;
      const { at: start, shift } = down;
      const end = new THREE.Vector2(e.clientX, e.clientY);
      if (dragging) {
        const found = entitiesIn(boxFrom(start, end), boxMode(start, end));
        if (!shift) ctx.selection.clear();
        ctx.selection.addAll([
          ...found.faces.map((id) => ({ kind: 'face' as const, id })),
          ...found.edges.map((id) => ({ kind: 'edge' as const, id })),
        ]);
      } else {
        const ref = entityAt(e);
        if (!shift) ctx.selection.clear();
        if (ref) {
          if (shift) ctx.selection.toggle(ref);
          else ctx.selection.add(ref);
        }
      }
      reset();
    },

    keyDown(e) {
      if (e.key === 'Escape') {
        reset();
        ctx.selection.clear();
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctx.selection.empty) {
        const { faces, edges } = ctx.selection;
        ctx.doc.run('Erase', () => {
          eraseFaces(model, [...faces]);
          eraseEdges(model, [...edges]);
        });
        ctx.selection.clear();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
