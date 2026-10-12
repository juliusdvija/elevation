import type * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawPolygon } from '../kernel/draw';
import { EPS, type Plane } from '../kernel/math';
import { circlePoints } from '../kernel/shapes';
import { PreviewLines } from './overlay';
import { parseSegments, planeOfStart, pointInPlane } from './planeOfStart';
import type { Tool, ToolContext } from './Tool';
import { space } from './space';

const HINT_CENTER = 'Click the centre. Circles follow the face you start on. Type 24s to set the number of sides.';
const HINT_RADIUS = 'Click to set the radius, or type it and press Enter.';

export function createCircleTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const preview = new PreviewLines(ctx.viewport);
  let segments = 24;
  let center: THREE.Vector3 | null = null;
  let plane: Plane | null = null;
  let edge: THREE.Vector3 | null = null;

  const points = (radius: number) => circlePoints(center!, plane!.normal, radius, segments, edge ? edge.clone().sub(center!) : undefined);

  const reset = () => {
    center = null;
    plane = null;
    edge = null;
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_CENTER);
  };

  const commit = (radius: number) => {
    if (!center || radius < EPS) return;
    const pts = points(radius);
    const s = space(ctx);
    ctx.doc.run('Circle', () => drawPolygon(s.model, pts.map(s.toLocal)));
    inference.remember(center);
    reset();
  };

  return {
    id: 'circle',
    label: 'Circle',
    shortcut: 'C',
    hint: HINT_CENTER,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!center) {
        feedback.show(inference.infer(e, null));
        return;
      }
      const hit = pointInPlane(ctx, e, plane!, center);
      feedback.show(hit?.inferred ?? null);
      if (!hit) return;
      edge = hit.point;
      const r = edge.distanceTo(center);
      if (r < EPS) return;
      const pts = points(r);
      preview.set(pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [THREE.Vector3, THREE.Vector3]));
      ctx.setMeasurement(formatLength(r));
    },

    pointerDown(e) {
      if (center) {
        if (edge) commit(edge.distanceTo(center));
        return;
      }
      const p = inference.infer(e, null);
      if (!p) return;
      center = p.point.clone();
      plane = planeOfStart(ctx, e, p);
      ctx.setHint(HINT_RADIUS);
    },

    onMeasurement(text) {
      const n = parseSegments(text);
      if (n) {
        segments = n;
        ctx.setHint(`${segments} sides. ${center ? HINT_RADIUS : HINT_CENTER}`);
        return true;
      }
      const r = parseLength(text);
      if (!center || r === null) return false;
      commit(Math.abs(r));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && center) {
        reset();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
