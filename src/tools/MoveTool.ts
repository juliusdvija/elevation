import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { EPS } from '../kernel/math';
import { copyEntities, transformVertices } from '../kernel/transform';
import { kindColor, type InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import { highlightOf, targetVertices, targetsAt, type Targets } from './targets';
import type { Tool, ToolContext } from './Tool';
import type { Operation } from '../core/history';
import { space } from './space';
import { previewEdit } from './preview';

const HINT_START = 'Click a point to move from. Moves the selection, or what is under the cursor.';
const HINT_MOVE = 'Click to place, or type a distance. Option/Ctrl toggles copy.';
const HINT_ARRAY = 'Type 3x for more copies at the same spacing, or /3 to divide the distance.';

/** Parses "5x" (repeat) or "/5" (divide) array input. */
export function parseArray(text: string): { count: number; divide: boolean } | null {
  const repeat = text.trim().match(/^(\d+)\s*x$/i) ?? text.trim().match(/^x\s*(\d+)$/i);
  if (repeat && Number(repeat[1]) >= 1) return { count: Number(repeat[1]), divide: false };
  const divide = text.trim().match(/^\/\s*(\d+)$/);
  if (divide && Number(divide[1]) >= 1) return { count: Number(divide[1]), divide: true };
  return null;
}

export function createMoveTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const rubber = new PreviewLines(ctx.viewport);

  let targets: Targets | null = null;
  let base: THREE.Vector3 | null = null;
  let copy = false;
  let preview: Operation | null = null;
  let offset = new THREE.Vector3();
  let hover: InferredPoint | null = null;
  let lastEvent: PointerEvent | null = null;
  let lastCopy: { targets: Targets; offset: THREE.Vector3 } | null = null;

  /** Moves (or copies) targets by a world-space displacement. */
  const perform = (t: Targets, d: THREE.Vector3, asCopy: boolean, count = 1, divide = false) => {
    const s = space(ctx);
    const model = s.model;
    const local = (step: THREE.Vector3) => s.matrixToLocal(new THREE.Matrix4().makeTranslation(step.x, step.y, step.z));
    if (!asCopy) {
      const m = local(d);
      for (const id of t.instances) model.setInstanceMatrix(id, m.clone().multiply(new THREE.Matrix4().fromArray(model.instance(id).matrix)));
      transformVertices(model, targetVertices(ctx, t), m);
      return;
    }
    for (let i = 1; i <= count; i++) {
      const m = local(d.clone().multiplyScalar(divide ? i / count : i));
      for (const id of t.instances) {
        const inst = model.instance(id);
        model.addInstance(inst.definition, m.clone().multiply(new THREE.Matrix4().fromArray(inst.matrix)));
      }
      copyEntities(model, t.faces, t.edges, m);
    }
  };

  const revertPreview = () => {
    preview?.revert();
    preview = null;
  };

  const applyPreview = () => {
    revertPreview();
    if (!targets || offset.length() < EPS) return;
    const t = targets;
    // Preview in every model (moving an instance edits its parent).
    preview = previewEdit(ctx, () => perform(t, offset, copy));
  };

  const reset = () => {
    revertPreview();
    targets = null;
    base = null;
    hover = null;
    copy = false;
    inference.release();
    rubber.clear();
    feedback.clear();
    ctx.renderer.setHover(null);
    ctx.setMeasurement('');
    ctx.setHint(lastCopy ? `${HINT_START} ${HINT_ARRAY}` : HINT_START);
  };

  const commit = (d: THREE.Vector3) => {
    if (!targets || d.length() < EPS) return reset();
    const t = targets;
    const asCopy = copy && t.faces.length + t.edges.length + t.instances.length > 0;
    revertPreview();
    ctx.doc.run(asCopy ? 'Copy' : 'Move', () => perform(t, d, asCopy));
    lastCopy = asCopy ? { targets: t, offset: d.clone() } : null;
    inference.remember(base!.clone().add(d));
    reset();
  };

  const update = (e: PointerEvent) => {
    lastEvent = e;
    if (!base) {
      ctx.renderer.setHover(ctx.selection.empty ? highlightOf(targetsAt(ctx, e)) : null);
      feedback.show(inference.infer(e, null));
      return;
    }
    // Infer against the unmoved model, then show the move.
    revertPreview();
    hover = inference.infer(e, base);
    feedback.show(hover);
    if (!hover) return;
    offset = hover.point.clone().sub(base);
    rubber.set([[base, hover.point]], kindColor(hover.kind));
    ctx.setMeasurement(formatLength(offset.length()));
    applyPreview();
  };

  return {
    id: 'move',
    label: 'Move',
    shortcut: 'M',
    hint: HINT_START,
    cursor: 'move',

    pointerMove: update,

    pointerDown(e) {
      if (base) {
        commit(offset);
        return;
      }
      const t = targetsAt(ctx, e);
      const p = inference.infer(e, null);
      if (!t || !p) return;
      targets = t;
      base = p.point.clone();
      lastCopy = null;
      inference.remember(base);
      ctx.renderer.setHover(null);
      ctx.setHint(HINT_MOVE);
    },

    onMeasurement(text) {
      const array = parseArray(text);
      if (array && !base && lastCopy && ctx.doc.history.undoLabel === 'Copy') {
        const { targets: t, offset: d } = lastCopy;
        ctx.doc.history.undo();
        ctx.doc.run('Copy', () => perform(t, d, true, array.count, array.divide));
        return true;
      }
      const length = parseLength(text);
      if (!base || length === null) return false;
      const dir = hover?.direction?.clone() ?? offset.clone();
      if (dir.lengthSq() < EPS * EPS) return false;
      if (dir.dot(offset) < 0) dir.negate();
      commit(dir.normalize().multiplyScalar(length));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && base) {
        reset();
        return true;
      }
      if ((e.key === 'Alt' || e.key === 'Control') && base) {
        copy = !copy;
        ctx.setHint(copy ? `Copy: ${HINT_MOVE}` : HINT_MOVE);
        if (lastEvent) update(lastEvent);
        return true;
      }
      if (base && inference.keyDown(e)) {
        if (lastEvent) update(lastEvent);
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate() {
      lastCopy = null;
      reset();
    },
  };
}
