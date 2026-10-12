import * as THREE from 'three';

/** Two unit vectors spanning the plane with this normal (u × w = normal). */
function basis(normal: THREE.Vector3, prefer?: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const n = normal.clone().normalize();
  let u = prefer ? prefer.clone().addScaledVector(n, -prefer.dot(n)) : new THREE.Vector3();
  if (u.lengthSq() < 1e-12) {
    const helper = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    u = new THREE.Vector3().crossVectors(helper, n);
  }
  u.normalize();
  return [u, new THREE.Vector3().crossVectors(n, u)];
}

/**
 * Corners of a polygon approximating a circle. The first corner points along
 * `start` (projected into the plane) when given.
 */
export function circlePoints(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number,
  segments: number,
  start?: THREE.Vector3,
): THREE.Vector3[] {
  const [u, w] = basis(normal, start);
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return center.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(w, Math.sin(a) * radius);
  });
}

/** Direction from the chord's midpoint towards a positive bulge. */
export function bulgeDirection(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().crossVectors(normal, new THREE.Vector3().subVectors(b, a)).normalize();
}

/**
 * Points along a circular arc from `a` to `b` in the plane with `normal`,
 * bulging by `bulge` (the sagitta) towards `bulgeDirection`. Includes both
 * ends. A bulge of zero gives the straight chord.
 */
export function arcPoints(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3, bulge: number, segments: number): THREE.Vector3[] {
  const chord = a.distanceTo(b);
  if (Math.abs(bulge) < 1e-6 || chord < 1e-6) return [a.clone(), b.clone()];
  const perp = bulgeDirection(a, b, normal);
  const mid = a.clone().lerp(b, 0.5);
  const h = Math.abs(bulge);
  const side = Math.sign(bulge);
  const radius = (chord * chord) / (8 * h) + h / 2;
  const center = mid.clone().addScaledVector(perp, side * (h - radius));

  const [u, w] = basis(normal, a.clone().sub(center));
  const angle = (p: THREE.Vector3) => {
    const d = p.clone().sub(center);
    return Math.atan2(d.dot(w), d.dot(u));
  };
  const end = angle(b);
  const apex = angle(mid.clone().addScaledVector(perp, side * h));
  // Sweep from 0 to `end` the way that passes through the apex.
  const ccw = ((end % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const apexCcw = ((apex % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = apexCcw < ccw ? ccw : ccw - 2 * Math.PI;

  return Array.from({ length: segments + 1 }, (_, i) => {
    if (i === 0) return a.clone();
    if (i === segments) return b.clone();
    const t = (i / segments) * sweep;
    return center.clone().addScaledVector(u, Math.cos(t) * radius).addScaledVector(w, Math.sin(t) * radius);
  });
}

/**
 * Offsets a closed planar polygon (counter-clockwise around `normal`) by
 * `distance`: positive moves the outline inwards, negative outwards.
 */
export function offsetPolygon(points: THREE.Vector3[], normal: THREE.Vector3, distance: number): THREE.Vector3[] {
  const n = normal.clone().normalize();
  const count = points.length;
  const lines = points.map((p, i) => {
    const d = points[(i + 1) % count].clone().sub(p).normalize();
    const inward = new THREE.Vector3().crossVectors(n, d);
    return { point: p.clone().addScaledVector(inward, distance), dir: d };
  });
  return points.map((_, i) => {
    const prev = lines[(i - 1 + count) % count];
    const next = lines[i];
    // Intersect the two offset lines within the plane.
    const cross = new THREE.Vector3().crossVectors(prev.dir, next.dir);
    const denom = cross.dot(n);
    if (Math.abs(denom) < 1e-9) return next.point.clone();
    const diff = next.point.clone().sub(prev.point);
    const t = new THREE.Vector3().crossVectors(diff, next.dir).dot(n) / denom;
    return prev.point.clone().addScaledVector(prev.dir, t);
  });
}
