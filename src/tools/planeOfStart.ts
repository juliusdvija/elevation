import * as THREE from 'three';
import { onPlane, planeFromPointNormal, type Plane } from '../kernel/math';
import type { InferredPoint } from './inference';
import type { ToolContext } from './Tool';

/** Drawing plane for a shape started at `p`: the face under it, else horizontal. */
export function planeOfStart(ctx: ToolContext, e: PointerEvent, p: InferredPoint): Plane {
  const model = ctx.doc.model;
  const hit = ctx.picker.face(e.clientX, e.clientY);
  if (hit) {
    const face = model.face(hit.id);
    if (onPlane(model.facePlane(face), p.point)) return planeFromPointNormal(p.point, face.normal);
  }
  return planeFromPointNormal(p.point, new THREE.Vector3(0, 0, 1));
}

/** Cursor point in a plane: an inferred point lying in it, else the ray hit. */
export function pointInPlane(ctx: ToolContext, e: PointerEvent, plane: Plane, from: THREE.Vector3 | null): { point: THREE.Vector3; inferred: InferredPoint | null } | null {
  const p = ctx.inference.infer(e, from);
  if (p && onPlane(plane, p.point)) return { point: p.point, inferred: p };
  const hit = ctx.viewport.ray(e.clientX, e.clientY).intersectPlane(new THREE.Plane(plane.normal.clone(), -plane.d), new THREE.Vector3());
  return hit && { point: hit, inferred: null };
}

/** "24s" sets a segment count. */
export function parseSegments(text: string): number | null {
  const m = text.trim().match(/^(\d+)\s*s$/i);
  const n = m ? Number(m[1]) : NaN;
  return n >= 3 && n <= 360 ? n : null;
}
