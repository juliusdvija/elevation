import type * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawSegments } from '../kernel/draw';
import { EPS } from '../kernel/math';
import { kindColor, type InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Click to start a line.';
const HINT_NEXT =
  'Click the next point, or type a length and press Enter. Shift or arrow keys lock the direction. Esc ends the line.';

export function createLineTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  const { inference, feedback } = ctx;
  let start: THREE.Vector3 | null = null;
  let hover: InferredPoint | null = null;
  let lastEvent: PointerEvent | null = null;

  const reset = () => {
    start = null;
    hover = null;
    inference.release();
    inference.startNormal = null;
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  /** Draws start→end; ends the chain when the line closed a face. */
  const commit = (end: THREE.Vector3) => {
    if (!start || end.distanceTo(start) < EPS) return;
    const from = start;
    const facesBefore = ctx.doc.model.faceCount;
    ctx.doc.run('Line', () => drawSegments(ctx.doc.model, [[from, end]]));
    inference.remember(end);
    inference.release();
    if (ctx.doc.model.faceCount > facesBefore) reset();
    else {
      start = end.clone();
      preview.clear();
    }
  };

  const update = (e: PointerEvent) => {
    lastEvent = e;
    hover = inference.infer(e, start);
    feedback.show(hover);
    if (start && hover) {
      preview.set([[start, hover.point]], kindColor(hover.kind));
      ctx.setMeasurement(formatLength(start.distanceTo(hover.point)));
    }
  };

  return {
    id: 'line',
    label: 'Line',
    shortcut: 'L',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove: update,

    pointerDown(e) {
      const p = inference.infer(e, start);
      if (!p) return;
      if (!start) {
        start = p.point.clone();
        inference.remember(start);
        inference.startNormal = p.pick.kind === 'face' ? ctx.doc.model.face(p.pick.id).normal.clone() : null;
        ctx.setHint(HINT_NEXT);
      } else {
        commit(p.point);
      }
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!start || !hover || length === null) return false;
      const towardCursor = hover.point.clone().sub(start);
      const dir = hover.direction?.clone() ?? towardCursor.clone();
      if (dir.lengthSq() < EPS * EPS) return false;
      // An inferred direction is unsigned; point it towards the cursor.
      if (dir.dot(towardCursor) < 0) dir.negate();
      commit(start.clone().addScaledVector(dir.normalize(), length));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && start) {
        reset();
        return true;
      }
      if (start && inference.keyDown(e)) {
        if (lastEvent) update(lastEvent);
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
