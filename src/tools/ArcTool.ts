import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawSegments } from '../kernel/draw';
import { EPS, type Plane } from '../kernel/math';
import { arcFromCenter, arcSegments } from '../kernel/shapes';
import { theme } from '../viewport/theme';
import { PreviewLines } from './overlay';
import { parseSegments, planeOfStart, pointInPlane } from './planeOfStart';
import type { Tool, ToolContext } from './Tool';
import { space } from './space';

const HINT_CENTER = 'Click the centre of the arc. Arcs follow the face you start on.';
const HINT_START = 'Click the start of the arc (sets the radius), or type the radius.';
const HINT_ANGLE = 'Move to sweep the arc (snaps every 15°) and click, or type the angle in degrees. Type 12s to set the segments.';
const SNAP_DEGREES = 15;
const SNAP_TOLERANCE = 2; // degrees

/** Arc from a centre, a start point (radius) and a swept angle. */
export function createArcTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const preview = new PreviewLines(ctx.viewport);
  let center: THREE.Vector3 | null = null;
  let plane: Plane | null = null;
  let start: THREE.Vector3 | null = null;
  let cursor: THREE.Vector3 | null = null;
  /** Swept angle in radians, tracked continuously so arcs can pass 180°. */
  let angle = 0;
  let lastRaw = 0;
  /** The angle shown (snapped), which a click commits. */
  let shownAngle = 0;
  let segments: number | null = null;

  const reset = () => {
    center = null;
    plane = null;
    start = null;
    cursor = null;
    angle = 0;
    lastRaw = 0;
    shownAngle = 0;
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_CENTER);
  };

  const points = (a: number) => arcFromCenter(center!, plane!.normal, start!, a, segments ?? arcSegments(a));

  const commit = (a: number) => {
    if (!center || !start || Math.abs(a) < 1e-6) return;
    const s = space(ctx);
    const pts = points(a).map(s.toLocal);
    ctx.doc.run('Arc', () => drawSegments(s.model, pts.slice(1).map((p, i) => [pts[i], p] as [THREE.Vector3, THREE.Vector3])));
    inference.remember(center);
    inference.remember(s.toWorld(pts[0]));
    inference.remember(s.toWorld(pts[pts.length - 1]));
    reset();
  };

  /** Angle of `p` around the centre, measured from the start direction. */
  const rawAngle = (p: THREE.Vector3) => {
    const n = plane!.normal;
    const u = start!.clone().sub(center!);
    const d = p.clone().sub(center!);
    d.addScaledVector(n, -d.dot(n));
    return Math.atan2(new THREE.Vector3().crossVectors(u, d).dot(n), u.dot(d));
  };

  return {
    id: 'arc',
    label: 'Arc',
    shortcut: 'A',
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
      if (!start) {
        cursor = hit.point;
        preview.set([[center, cursor]], theme.preview);
        ctx.setMeasurement(formatLength(center.distanceTo(cursor)));
        return;
      }
      // Unwrap so the sweep keeps growing past ±180°.
      const raw = rawAngle(hit.point);
      let delta = raw - lastRaw;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      lastRaw = raw;
      angle = THREE.MathUtils.clamp(angle + delta, -2 * Math.PI, 2 * Math.PI);
      let degrees = THREE.MathUtils.radToDeg(angle);
      const snapped = Math.round(degrees / SNAP_DEGREES) * SNAP_DEGREES;
      if (Math.abs(degrees - snapped) < SNAP_TOLERANCE) degrees = snapped;
      const shown = THREE.MathUtils.degToRad(degrees);
      shownAngle = shown;
      const pts = points(shown);
      preview.set([
        [center, pts[0]],
        [center, pts[pts.length - 1]],
        ...pts.slice(1).map((p, i) => [pts[i], p] as [THREE.Vector3, THREE.Vector3]),
      ]);
      ctx.setMeasurement(`${Math.round(degrees * 10) / 10}°`);
    },

    pointerDown(e) {
      if (!center) {
        const p = inference.infer(e, null);
        if (!p) return;
        center = p.point.clone();
        plane = planeOfStart(ctx, e, p);
        ctx.setHint(HINT_START);
      } else if (!start) {
        if (!cursor || cursor.distanceTo(center) < EPS) return;
        start = cursor.clone();
        angle = 0;
        lastRaw = 0;
        ctx.setHint(HINT_ANGLE);
      } else {
        commit(shownAngle);
      }
    },

    onMeasurement(text) {
      const n = parseSegments(text);
      if (n) {
        segments = n;
        return true;
      }
      if (center && !start) {
        const radius = parseLength(text);
        if (radius === null || !cursor || cursor.distanceTo(center) < EPS) return false;
        start = center.clone().add(cursor.clone().sub(center).setLength(Math.abs(radius)));
        angle = 0;
        lastRaw = 0;
        ctx.setHint(HINT_ANGLE);
        return true;
      }
      const degrees = Number(text.replace(',', '.'));
      if (!start || !Number.isFinite(degrees)) return false;
      // Typed angles sweep the way the cursor was going.
      commit(THREE.MathUtils.degToRad(Math.abs(degrees)) * (angle < 0 ? -1 : 1) * Math.sign(degrees || 1));
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
