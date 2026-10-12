import * as THREE from 'three';
import { eraseEdges, eraseFaces } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import { within } from '../viewport/ModelRenderer';
import { boxFrom, boxMode, edgeInBox, polygonInBox, type BoxMode } from './boxSelect';
import type { EntityRef } from './Selection';
import { entityOf } from './targets';
import type { Tool, ToolContext } from './Tool';

const DRAG_THRESHOLD = 4; // px before a click becomes a selection box
const DOUBLE_CLICK_MS = 350;

export function createSelectTool(ctx: ToolContext): Tool {
  const boxEl = document.createElement('div');
  boxEl.className = 'select-box';
  boxEl.hidden = true;
  ctx.viewport.container.append(boxEl);

  let down: { at: THREE.Vector2; shift: boolean } | null = null;
  let dragging = false;
  let lastClick: { at: THREE.Vector2; time: number } | null = null;

  const entityAt = (e: PointerEvent): EntityRef | null =>
    entityOf(ctx, ctx.picker.pick(e.clientX, e.clientY, { vertices: false, guides: false }));

  /** Everything in the edited model inside (window) or touching (crossing) a client-space box. */
  const entitiesIn = (box: THREE.Box2, mode: BoxMode): EntityRef[] => {
    const ctxPlacement = ctx.doc.context;
    const { model, matrix } = ctxPlacement;
    const screen = new Map<Id, THREE.Vector2 | null>();
    const at = (v: Id) => {
      if (!screen.has(v)) screen.set(v, ctx.viewport.toScreen(model.position(v).clone().applyMatrix4(matrix)));
      return screen.get(v)!;
    };
    const refs: EntityRef[] = [];
    for (const e of model.allEdges()) {
      const a = at(e.a);
      const b = at(e.b);
      if (a && b && edgeInBox(a, b, box, mode)) refs.push({ kind: 'edge', id: e.id });
    }
    for (const f of model.allFaces()) {
      const outline = f.outer.map(at);
      if (outline.every((p) => p) && polygonInBox(outline as THREE.Vector2[], box, mode)) refs.push({ kind: 'face', id: f.id });
    }
    // Groups: all of their edges inside (window), or any touching (crossing).
    for (const instance of model.allInstances()) {
      const path = [...ctxPlacement.path, instance.id];
      const tests: boolean[] = [];
      for (const p of ctx.doc.placements()) {
        if (!within(p.path, path)) continue;
        for (const e of p.model.allEdges()) {
          const a = ctx.viewport.toScreen(p.model.position(e.a).clone().applyMatrix4(p.matrix));
          const b = ctx.viewport.toScreen(p.model.position(e.b).clone().applyMatrix4(p.matrix));
          tests.push(!!a && !!b && edgeInBox(a, b, box, mode));
        }
      }
      const hit = mode === 'window' ? tests.length > 0 && tests.every(Boolean) : tests.some(Boolean);
      if (hit) refs.push({ kind: 'instance', id: instance.id });
    }
    return refs;
  };

  const highlightOf = (refs: EntityRef[]) => ({
    faces: refs.filter((r) => r.kind === 'face').map((r) => r.id),
    edges: refs.filter((r) => r.kind === 'edge').map((r) => r.id),
    instances: refs.filter((r) => r.kind === 'instance').map((r) => r.id),
  });

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

  /** Double-click: open a group for editing, or close the one being edited. */
  const doubleClick = (ref: EntityRef | null) => {
    if (ref?.kind === 'instance') {
      ctx.selection.clear();
      ctx.doc.enter(ref.id);
    } else if (!ref) {
      ctx.selection.clear();
      ctx.doc.exit();
    }
  };

  return {
    id: 'select',
    label: 'Select',
    shortcut: 'Space',
    hint: 'Click to select, drag a box to select several (left to right: fully inside; right to left: touching). Double-click a group to edit it. Delete erases.',
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
          ctx.renderer.setHover(highlightOf(entitiesIn(box, boxMode(down.at, at))));
        }
        return;
      }
      const ref = entityAt(e);
      ctx.renderer.setHover(ref && highlightOf([ref]));
    },

    pointerUp(e) {
      if (!down) return;
      const { at: start, shift } = down;
      const end = new THREE.Vector2(e.clientX, e.clientY);
      if (dragging) {
        const found = entitiesIn(boxFrom(start, end), boxMode(start, end));
        if (!shift) ctx.selection.clear();
        ctx.selection.addAll(found);
        lastClick = null;
      } else {
        const ref = entityAt(e);
        const now = performance.now();
        if (lastClick && now - lastClick.time < DOUBLE_CLICK_MS && lastClick.at.distanceTo(end) < DRAG_THRESHOLD) {
          lastClick = null;
          doubleClick(ref);
          reset();
          return;
        }
        lastClick = { at: end, time: now };
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
        // Esc with nothing selected closes the group being edited.
        if (ctx.selection.empty) ctx.doc.exit();
        ctx.selection.clear();
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctx.selection.empty) {
        const model = ctx.doc.context.model;
        const { faces, edges, instances } = ctx.selection;
        ctx.doc.run('Erase', () => {
          for (const id of instances) model.removeInstance(id);
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
