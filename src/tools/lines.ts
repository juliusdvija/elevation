import * as THREE from 'three';

/** An infinite 3D line through `point` along unit `direction`. */
export interface Line3 {
  point: THREE.Vector3;
  direction: THREE.Vector3;
}

export function projectOnLine(q: THREE.Vector3, line: Line3): THREE.Vector3 {
  const t = new THREE.Vector3().subVectors(q, line.point).dot(line.direction);
  return line.point.clone().addScaledVector(line.direction, t);
}

/** Point on `line` closest to `ray` (the cursor ray). Falls back to the ray origin's projection when parallel. */
export function closestOnLineToRay(line: Line3, ray: THREE.Ray): THREE.Vector3 {
  const d = line.direction;
  const r = ray.direction;
  const w0 = new THREE.Vector3().subVectors(line.point, ray.origin);
  const b = d.dot(r);
  const denom = 1 - b * b;
  if (denom < 1e-12) return projectOnLine(ray.origin, line);
  const t = (b * r.dot(w0) - d.dot(w0)) / denom;
  return line.point.clone().addScaledVector(d, t);
}

/**
 * Where two lines meet, or null if they are parallel or miss each other by
 * more than `tolerance` (mm).
 */
export function intersectLines(l1: Line3, l2: Line3, tolerance = 0.5): THREE.Vector3 | null {
  const d1 = l1.direction;
  const d2 = l2.direction;
  const w0 = new THREE.Vector3().subVectors(l1.point, l2.point);
  const b = d1.dot(d2);
  const denom = 1 - b * b;
  if (denom < 1e-9) return null;
  const d = d1.dot(w0);
  const e = d2.dot(w0);
  const s = (b * e - d) / denom;
  const t = (e - b * d) / denom;
  const p1 = l1.point.clone().addScaledVector(d1, s);
  const p2 = l2.point.clone().addScaledVector(d2, t);
  return p1.distanceTo(p2) <= tolerance ? p1.add(p2).multiplyScalar(0.5) : null;
}

/**
 * The line in a plane through `point`'s projection onto the plane, along
 * `axis` (null when the axis is not parallel to the plane). Used to align a
 * cursor on a face with a remembered point.
 */
export function alignmentInPlane(
  point: THREE.Vector3,
  axis: THREE.Vector3,
  plane: { normal: THREE.Vector3; d: number },
): Line3 | null {
  if (Math.abs(axis.dot(plane.normal)) > 1e-6) return null;
  const offset = plane.normal.dot(point) - plane.d;
  return { point: point.clone().addScaledVector(plane.normal, -offset), direction: axis.clone().normalize() };
}
