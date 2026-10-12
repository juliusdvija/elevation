import * as THREE from 'three';
import { formatLength, parseLengthPair } from '../core/units';
import { drawPolygon } from '../kernel/draw';
import { DIR_EPS, EPS, onPlane, planeFromPointNormal, type Plane } from '../kernel/math';
import type { InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Click the first corner. Rectangles follow the face you start on.';
const HINT_NEXT = 'Click the opposite corner, or type width;height and press Enter.';
const SQUARE_RADIUS = 8; // px

interface Frame {
  plane: Plane;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

/** Rectangle axes on a plane: horizontal edges where possible. */
function frameFor(origin: THREE.Vector3, normal: THREE.Vector3): Frame {
  const n = normal.clone().normalize();
  const u =
    Math.abs(n.z) > 1 - DIR_EPS ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  return { plane: planeFromPointNormal(origin, n), u, v };
}

export function createRectangleTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  const { inference, feedback } = ctx;
  let corner: THREE.Vector3 | null = null;
  let frame: Frame | null = null;
  let size = { du: 0, dv: 0 };

  const corners = (du: number, dv: number) => {
    const p = corner!;
    const { u, v } = frame!;
    return [
      p.clone(),
      p.clone().addScaledVector(u, du),
      p.clone().addScaledVector(u, du).addScaledVector(v, dv),
      p.clone().addScaledVector(v, dv),
    ];
  };

  const reset = () => {
    corner = null;
    frame = null;
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  const commit = (du: number, dv: number) => {
    if (!corner || Math.abs(du) < EPS || Math.abs(dv) < EPS) return;
    const points = corners(du, dv);
    ctx.doc.run('Rectangle', () => drawPolygon(ctx.doc.model, points));
    for (const p of points) inference.remember(p);
    reset();
  };

  /**
   * Opposite corner under the cursor, kept in the rectangle's plane: a
   * snapped point on the plane, an alignment with remembered points, or the
   * plane under the cursor; then squared up when close to a square.
   */
  const opposite = (e: PointerEvent): InferredPoint | null => {
    const { plane, u, v } = frame!;
    const cursor = new THREE.Vector2(e.clientX, e.clientY);
    const px = (p: THREE.Vector3) => ctx.viewport.toScreen(p)?.distanceTo(cursor) ?? Infinity;
    const ray = ctx.viewport.ray(e.clientX, e.clientY);
    const pick = ctx.picker.pick(e.clientX, e.clientY);

    let result: InferredPoint | null = null;
    if ((pick.kind === 'vertex' || pick.kind === 'midpoint' || pick.kind === 'edge' || pick.kind === 'intersection' || pick.kind === 'guide-point' || pick.kind === 'guide') && onPlane(plane, pick.point)) {
      result = { point: pick.point, kind: pick.kind, pick, guides: [] };
    } else {
      const aligned = inference.alignInPlane(ray, plane, px, [corner!]);
      if (aligned) result = { point: aligned.point, kind: 'from-point', pick, guides: aligned.guides };
      else {
        const hit = ray.intersectPlane(new THREE.Plane(plane.normal.clone(), -plane.d), new THREE.Vector3());
        if (hit) result = { point: hit, kind: 'face', label: '', pick, guides: [] };
      }
      if (result) {
        const d = result.point.clone().sub(corner!);
        const du = d.dot(u);
        const dv = d.dot(v);
        const side = Math.max(Math.abs(du), Math.abs(dv));
        const square = corner!.clone().addScaledVector(u, Math.sign(du) * side).addScaledVector(v, Math.sign(dv) * side);
        if (px(square) < SQUARE_RADIUS) result = { point: square, kind: 'square', pick, guides: [{ from: corner!, to: square }] };
      }
    }
    return result;
  };

  return {
    id: 'rectangle',
    label: 'Rectangle',
    shortcut: 'R',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!corner) {
        feedback.show(inference.infer(e, null));
        return;
      }
      const q = opposite(e);
      feedback.show(q);
      if (!q) return;
      const d = q.point.clone().sub(corner);
      size = { du: d.dot(frame!.u), dv: d.dot(frame!.v) };
      const pts = corners(size.du, size.dv);
      preview.set(pts.map((p, i) => [p, pts[(i + 1) % 4]] as [THREE.Vector3, THREE.Vector3]));
      ctx.setMeasurement(`${formatLength(Math.abs(size.du))}; ${formatLength(Math.abs(size.dv))}`);
    },

    pointerDown(e) {
      if (corner) {
        commit(size.du, size.dv);
        return;
      }
      const p = inference.infer(e, null);
      if (!p) return;
      const model = ctx.doc.model;
      const face = ctx.picker.face(e.clientX, e.clientY);
      const onFace = face && onPlane(model.facePlane(model.face(face.id)), p.point);
      corner = p.point.clone();
      inference.remember(corner);
      frame = frameFor(corner, onFace ? model.face(face.id).normal : new THREE.Vector3(0, 0, 1));
      size = { du: 0, dv: 0 };
      ctx.setHint(HINT_NEXT);
    },

    onMeasurement(text) {
      const dims = parseLengthPair(text);
      if (!corner || !dims) return false;
      commit(dims[0] * (size.du < 0 ? -1 : 1), dims[1] * (size.dv < 0 ? -1 : 1));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && corner) {
        reset();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
