import type * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawSegments } from '../kernel/draw';
import { EPS } from '../kernel/math';
import { axisColor, inferPoint, type InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Click to start a line.';
const HINT_NEXT = 'Click the next point, or type a length and press Enter. Esc ends the line.';

export function createLineTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  let start: THREE.Vector3 | null = null;
  let hover: InferredPoint | null = null;

  const reset = () => {
    start = null;
    preview.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  /** Draws start→end; ends the chain when the line closed a face. */
  const commit = (end: THREE.Vector3) => {
    if (!start || end.distanceTo(start) < EPS) return;
    const from = start;
    const facesBefore = ctx.doc.model.faceCount;
    ctx.doc.run('Line', () => drawSegments(ctx.doc.model, [[from, end]]));
    if (ctx.doc.model.faceCount > facesBefore) reset();
    else {
      start = end.clone();
      preview.clear();
    }
  };

  return {
    id: 'line',
    label: 'Line',
    shortcut: 'L',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      hover = inferPoint(ctx, e, start);
      if (!hover) {
        ctx.marker.hide();
        return;
      }
      ctx.marker.show(hover.point, hover.kind);
      if (start) {
        preview.set([[start, hover.point]], axisColor(hover.kind));
        ctx.setMeasurement(formatLength(start.distanceTo(hover.point)));
      }
    },

    pointerDown(e) {
      const p = inferPoint(ctx, e, start);
      if (!p) return;
      if (!start) {
        start = p.point.clone();
        ctx.setHint(HINT_NEXT);
      } else {
        commit(p.point);
      }
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!start || !hover || length === null) return false;
      const dir = hover.point.clone().sub(start);
      if (dir.lengthSq() < EPS * EPS) return false;
      commit(start.clone().addScaledVector(dir.normalize(), length));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && start) {
        reset();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate() {
      reset();
      ctx.marker.hide();
    },
  };
}
