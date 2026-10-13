import * as THREE from 'three';
import type { Face, Id, Model } from '../kernel/Model';
import { EPS } from '../kernel/math';

/** How far a shadow reaches along the light (mm). Beyond a few storeys it stops mattering. */
const REACH = 12_000;
/** An occluder this close to (or behind) the receiver's plane casts nothing on it (coplanar neighbours, the face itself). */
const MIN_GAP = 1;
const CELL = 2000;

const hash = (i: number, j: number, k: number) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);

/** The part of a polygon where `value(p) >= 0`, by walking its edges. */
function clipAbove(points: THREE.Vector3[], value: (p: THREE.Vector3) => number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const P = points[i];
    const Q = points[(i + 1) % points.length];
    const dp = value(P);
    const dq = value(Q);
    if (dp >= 0) out.push(P);
    if (dp >= 0 !== dq >= 0) out.push(P.clone().lerp(Q, dp / (dp - dq)));
  }
  return out;
}

/** A loop of a face: its outline, or a hole in it (light passes through holes). */
export interface ShadowLoop {
  points: THREE.Vector3[];
  hole: boolean;
}

export interface Occluder {
  loops: ShadowLoop[];
  box: THREE.Box3;
  face: Id;
}

/** The faces that block light (anything see-through lets it pass), with their holes. */
export function occluders(model: Model): Occluder[] {
  const result: Occluder[] = [];
  for (const face of model.allFaces()) {
    if (face.opacity !== undefined && face.opacity < 1) continue;
    const loops = [face.outer, ...face.holes].map((loop, i) => ({ points: loop.map((id) => model.position(id)), hole: i > 0 }));
    result.push({ loops, box: new THREE.Box3().setFromPoints(loops[0].points), face: face.id });
  }
  return result;
}

/**
 * For each receiving face, the shadows that other faces cast on its plane along `light`: polygons in
 * world space, all lying in the receiver's plane. Overlaps are left for the renderer's non-zero fill.
 */
export function castShadows(model: Model, receivers: Face[], light: THREE.Vector3, all: Occluder[] = occluders(model)): Map<Id, ShadowLoop[]> {
  const result = new Map<Id, ShadowLoop[]>();
  if (receivers.length === 0) return result;

  // A grid over the receivers' boxes, so each occluder only meets the faces near its shadow.
  const grid = new Map<number, number[]>();
  const info = receivers.map((face, i) => {
    const points = face.outer.map((id) => model.position(id));
    const box = new THREE.Box3().setFromPoints(points);
    for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++) {
      for (let y = Math.floor(box.min.y / CELL); y <= Math.floor(box.max.y / CELL); y++) {
        for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) {
          const key = hash(x, y, z);
          (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
        }
      }
    }
    return { face, box, n: face.normal, d: face.normal.dot(points[0]) };
  });

  for (const occluder of all) {
    // Everything the occluder can shade lies in the box swept along the light.
    const sweep = occluder.box.clone();
    sweep.union(occluder.box.clone().translate(light.clone().multiplyScalar(REACH)));
    const seen = new Set<number>();
    for (let x = Math.floor(sweep.min.x / CELL); x <= Math.floor(sweep.max.x / CELL); x++) {
      for (let y = Math.floor(sweep.min.y / CELL); y <= Math.floor(sweep.max.y / CELL); y++) {
        for (let z = Math.floor(sweep.min.z / CELL); z <= Math.floor(sweep.max.z / CELL); z++) {
          for (const i of grid.get(hash(x, y, z)) ?? []) {
            if (seen.has(i)) continue;
            seen.add(i);
            const r = info[i];
            if (r.face.id === occluder.face || !r.box.intersectsBox(sweep)) continue;
            const den = r.n.dot(light);
            if (Math.abs(den) < 1e-3) continue; // the light grazes this face
            // Distance along the light from each occluder point to the receiver's plane; only the part in front counts.
            const t = (p: THREE.Vector3) => (r.d - r.n.dot(p)) / den;
            const casts: ShadowLoop[] = [];
            for (const loop of occluder.loops) {
              let polygon = clipAbove(loop.points, (p) => t(p) - MIN_GAP);
              if (polygon.length < 3) continue;
              polygon = clipAbove(polygon, (p) => REACH - t(p));
              if (polygon.length < 3) continue;
              casts.push({ points: polygon.map((p) => p.clone().addScaledVector(light, t(p))), hole: loop.hole });
            }
            // Skip shadows that cannot reach the receiver.
            if (casts.length === 0 || !new THREE.Box3().setFromPoints(casts[0].points).expandByScalar(EPS).intersectsBox(r.box)) continue;
            (result.get(r.face.id) ?? result.set(r.face.id, []).get(r.face.id)!).push(...casts);
          }
        }
      }
    }
  }
  return result;
}
