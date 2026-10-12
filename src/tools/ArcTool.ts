import type * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawSegments } from '../kernel/draw';
import { EPS, type Plane } from '../kernel/math';
import { arcPoints, bulgeDirection } from '../kernel/shapes';
import { PreviewLines } from './overlay';
import { parseSegments, planeOfStart, pointInPlane } from './planeOfStart';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Click the start of the arc. Type 12s to set the number of segments.';
const HINT_END = 'Click the end of the arc, or type the chord length.';
const HINT_BULGE = 'Move to set the bulge and click (snaps to a half circle), or type the bulge.';
const HALF_CIRCLE_PX = 8;

export function createArcTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const preview = new PreviewLines(ctx.viewport);
  let segments = 12;
  let start: THREE.Vector3 | null = null;
  let end: THREE.Vector3 | null = null;
  let plane: Plane | null = null;
  let bulge = 0;
  let cursor: THREE.Vector3 | null = null;

  const reset = () => {
    start = null;
    end = null;
    plane = null;
    bulge = 0;
    cursor = null;
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  const commit = (b: number) => {
    if (!start || !end) return;
    const pts = arcPoints(start, end, plane!.normal, b, segments);
    ctx.doc.run('Arc', () => drawSegments(ctx.doc.model, pts.slice(1).map((p, i) => [pts[i], p] as [THREE.Vector3, THREE.Vector3])));
    inference.remember(start);
    inference.remember(end);
    reset();
  };

  const showArc = (b: number) => {
    const pts = arcPoints(start!, end!, plane!.normal, b, segments);
    preview.set(pts.slice(1).map((p, i) => [pts[i], p] as [THREE.Vector3, THREE.Vector3]));
    ctx.setMeasurement(formatLength(Math.abs(b)));
  };

  return {
    id: 'arc',
    label: 'Arc',
    shortcut: 'A',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!start) {
        feedback.show(inference.infer(e, null));
        return;
      }
      const hit = pointInPlane(ctx, e, plane!, end ? null : start);
      feedback.show(hit?.inferred ?? null);
      if (!hit) return;
      if (!end) {
        cursor = hit.point;
        preview.set([[start, cursor]]);
        ctx.setMeasurement(formatLength(start.distanceTo(cursor)));
        return;
      }
      const mid = start.clone().lerp(end, 0.5);
      bulge = hit.point.clone().sub(mid).dot(bulgeDirection(start, end, plane!.normal));
      // Snap to a half circle.
      const half = (start.distanceTo(end) / 2) * Math.sign(bulge || 1);
      const halfApex = mid.clone().addScaledVector(bulgeDirection(start, end, plane!.normal), half);
      const screen = ctx.viewport.toScreen(halfApex);
      if (screen && screen.distanceTo({ x: e.clientX, y: e.clientY } as THREE.Vector2) < HALF_CIRCLE_PX) {
        bulge = half;
        ctx.setHint(`Half circle. ${HINT_BULGE}`);
      }
      showArc(bulge);
    },

    pointerDown(e) {
      if (!start) {
        const p = inference.infer(e, null);
        if (!p) return;
        start = p.point.clone();
        plane = planeOfStart(ctx, e, p);
        ctx.setHint(HINT_END);
      } else if (!end) {
        if (!cursor || cursor.distanceTo(start) < EPS) return;
        end = cursor.clone();
        ctx.setHint(HINT_BULGE);
      } else {
        commit(bulge);
      }
    },

    onMeasurement(text) {
      const n = parseSegments(text);
      if (n) {
        segments = n;
        return true;
      }
      const length = parseLength(text);
      if (!start || length === null) return false;
      if (!end) {
        if (!cursor || cursor.distanceTo(start) < EPS) return false;
        end = start.clone().add(cursor.clone().sub(start).setLength(Math.abs(length)));
        ctx.setHint(HINT_BULGE);
        return true;
      }
      commit(length * (bulge < 0 ? -1 : 1));
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
    deactivate: reset,
  };
}
