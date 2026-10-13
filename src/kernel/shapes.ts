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

/**
 * Points along a circular arc around `center` in the plane with `normal`,
 * starting at `start` and sweeping `angle` radians (counter-clockwise around
 * the normal when positive). Includes both ends.
 */
export function arcFromCenter(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  start: THREE.Vector3,
  angle: number,
  segments: number,
): THREE.Vector3[] {
  const n = normal.clone().normalize();
  const radial = start.clone().sub(center);
  radial.addScaledVector(n, -radial.dot(n));
  return Array.from({ length: segments + 1 }, (_, i) =>
    i === 0 ? start.clone() : center.clone().add(radial.clone().applyAxisAngle(n, (angle * i) / segments)),
  );
}

/** Segments for an arc: one per 15° (24 for a full circle), at least two. */
export function arcSegments(angle: number): number {
  return Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 12) - 1e-9));
}

/**
 * Offsets a closed planar polygon (counter-clockwise around `normal`) by
 * `distance`: positive moves the outline inwards, negative outwards. Vertices
 * in the middle of a straight run are dropped: they would land outside the
 * trimmed offset line and leave a spike.
 */
export function offsetPolygon(points: THREE.Vector3[], normal: THREE.Vector3, distance: number): THREE.Vector3[] {
  const n = normal.clone().normalize();
  const count = points.length;
  const lines = points.map((p, i) => {
    const d = points[(i + 1) % count].clone().sub(p).normalize();
    const inward = new THREE.Vector3().crossVectors(n, d);
    return { point: p.clone().addScaledVector(inward, distance), dir: d };
  });
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const prev = lines[(i - 1 + count) % count];
    const next = lines[i];
    // Intersect the two offset lines within the plane.
    const cross = new THREE.Vector3().crossVectors(prev.dir, next.dir);
    const denom = cross.dot(n);
    if (Math.abs(denom) < 1e-9) {
      if (prev.dir.dot(next.dir) > 0) continue; // straight on: not a corner
      result.push(next.point.clone());
      continue;
    }
    const diff = next.point.clone().sub(prev.point);
    const t = new THREE.Vector3().crossVectors(diff, next.dir).dot(n) / denom;
    result.push(prev.point.clone().addScaledVector(prev.dir, t));
  }
  return result;
}

/**
 * Whether an offset outline is still a polygon of the original orientation:
 * offsetting further than half the width turns it inside out or collapses it
 * to a line.
 */
export function offsetHolds(points: THREE.Vector3[], normal: THREE.Vector3, original: THREE.Vector3[]): boolean {
  const area = (pts: THREE.Vector3[]) => {
    const sum = new THREE.Vector3();
    pts.forEach((p, i) => sum.add(new THREE.Vector3().crossVectors(p, pts[(i + 1) % pts.length])));
    return sum.dot(normal.clone().normalize()) / 2;
  };
  return points.length >= 3 && area(points) * area(original) > 1 && Math.abs(area(points)) > 1;
}
