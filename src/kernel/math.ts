import * as THREE from 'three';

/** Points closer than this (mm) are the same point. */
export const EPS = 1e-3;
/** Tolerance on dot products of unit vectors. */
export const DIR_EPS = 1e-9;

const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

/** Plane `normal · p = d`, normal unit length. */
export interface Plane {
  readonly normal: THREE.Vector3;
  readonly d: number;
}

export function planeFromPointNormal(point: THREE.Vector3, normal: THREE.Vector3): Plane {
  const n = normal.clone().normalize();
  return { normal: n, d: n.dot(point) };
}

/** Plane through three points, or null when they are (nearly) collinear. */
export function planeFromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): Plane | null {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const n = new THREE.Vector3().crossVectors(ab, ac);
  // Relative test: sine of the angle between ab and ac.
  if (n.length() <= 1e-9 * ab.length() * ac.length() || n.lengthSq() === 0) return null;
  return planeFromPointNormal(a, n);
}

/** Same plane with the normal flipped into a canonical half-space, for dedupe. */
export function canonicalPlane(plane: Plane): Plane {
  const { normal: n } = plane;
  const flip =
    Math.abs(n.z) > 1e-9 ? n.z < 0 : Math.abs(n.y) > 1e-9 ? n.y < 0 : n.x < 0;
  return flip ? { normal: n.clone().negate(), d: -plane.d } : plane;
}

export function samePlane(p: Plane, q: Plane): boolean {
  const dot = p.normal.dot(q.normal);
  if (dot > 1 - DIR_EPS) return Math.abs(p.d - q.d) < EPS;
  if (dot < -(1 - DIR_EPS)) return Math.abs(p.d + q.d) < EPS;
  return false;
}

export function distanceToPlane(plane: Plane, p: THREE.Vector3): number {
  return plane.normal.dot(p) - plane.d;
}

export function onPlane(plane: Plane, p: THREE.Vector3): boolean {
  return Math.abs(distanceToPlane(plane, p)) < EPS;
}

export function isParallel(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return Math.abs(a.dot(b)) > 1 - DIR_EPS;
}

export function isPerpendicular(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return Math.abs(a.dot(b)) < 1e-6;
}

/** 2D coordinate frame on a plane: `u × v = normal`. */
export interface PlaneFrame {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  normal: THREE.Vector3;
}

export function planeFrame(plane: Plane): PlaneFrame {
  const normal = plane.normal;
  const helper = Math.abs(normal.z) < 0.9 ? Z : X;
  const u = new THREE.Vector3().crossVectors(helper, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  return { origin: normal.clone().multiplyScalar(plane.d), u, v, normal };
}

export function to2D(frame: PlaneFrame, p: THREE.Vector3): THREE.Vector2 {
  const rel = new THREE.Vector3().subVectors(p, frame.origin);
  return new THREE.Vector2(rel.dot(frame.u), rel.dot(frame.v));
}

export function to3D(frame: PlaneFrame, p: THREE.Vector2): THREE.Vector3 {
  return frame.origin.clone().addScaledVector(frame.u, p.x).addScaledVector(frame.v, p.y);
}

/** Positive for counter-clockwise polygons. */
export function signedArea(points: readonly THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function pointInPolygon(p: THREE.Vector2, polygon: readonly THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point parameter of `p` on segment ab (unclamped) and the distance to the clamped point. */
export function projectOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lengthSq = ab.lengthSq();
  const t = lengthSq === 0 ? 0 : new THREE.Vector3().subVectors(p, a).dot(ab) / lengthSq;
  const closest = a.clone().addScaledVector(ab, THREE.MathUtils.clamp(t, 0, 1));
  return { t, distance: closest.distanceTo(p), point: closest };
}

/**
 * Closest points between segments p1q1 and p2q2. Returns parameters s, t in
 * [0, 1] and the distance between the closest points. `parallel` is set when
 * the segments are (nearly) parallel, in which case s/t are not meaningful.
 */
export function closestBetweenSegments(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
): { s: number; t: number; distance: number; parallel: boolean } {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const denom = a * e - b * b;
  const parallel = denom <= 1e-12 * a * e;

  let s = parallel ? 0 : THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1);
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return { s, t, distance: c1.distanceTo(c2), parallel };
}
