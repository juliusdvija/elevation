import * as THREE from 'three';
import type { Placement } from '../document';
import { materialOf, type Material } from '../core/materials';
import { faceArea, triangulateFace } from '../kernel/faces';
import type { Id } from '../kernel/Model';
import { smoothNormal } from './shading';

/** The triangles of everything that is made of one material (and colour), in world space. */
export interface MaterialBucket {
  key: string;
  material: Material;
  positions: number[];
  normals: number[];
  uvs: number[];
}

const Z = new THREE.Vector3(0, 0, 1);

/**
 * The texture frame of a face: `u` runs along the face and `v` up it (walls), or east and north (floors
 * and roofs), so brick courses are level and a pattern carries on across neighbouring faces.
 */
export function textureFrame(normal: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  if (Math.abs(normal.z) > 0.9) return { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0) };
  const u = new THREE.Vector3().crossVectors(Z, normal).normalize();
  return { u, v: new THREE.Vector3().crossVectors(normal, u) };
}

/**
 * Sorts every face of the placed models into buckets by material, as triangles in world space with
 * smooth shading normals and texture coordinates in repeats (world mm / the material's tile size).
 */
export function buildMaterialBuckets(placements: Iterable<Placement>, smoothAngle: number): Map<string, MaterialBucket> {
  const buckets = new Map<string, MaterialBucket>();
  const cosSmooth = Math.cos(smoothAngle);
  const smoothing = smoothAngle > 0;
  const keyOf = (p: THREE.Vector3) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;

  for (const { model, matrix } of placements) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const worldNormal = new Map<Id, THREE.Vector3>();
    const faceNormal = (f: { id: Id; normal: THREE.Vector3 }) => {
      let n = worldNormal.get(f.id);
      if (!n) worldNormal.set(f.id, (n = f.normal.clone().applyMatrix3(normalMatrix).normalize()));
      return n;
    };
    const around = new Map<string, { n: THREE.Vector3; weight: number }[]>();
    if (smoothing) {
      for (const face of model.allFaces()) {
        const n = faceNormal(face);
        const weight = Math.max(faceArea(model, face), 1e-6);
        for (const id of model.faceVertices(face)) {
          const key = keyOf(model.position(id));
          (around.get(key) ?? around.set(key, []).get(key)!).push({ n, weight });
        }
      }
    }
    for (const face of model.allFaces()) {
      const material = materialOf(face);
      const key = `${material.id}|${material.color}|${material.opacity ?? 1}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { key, material, positions: [], normals: [], uvs: [] }));
      const n = faceNormal(face);
      const { u, v } = textureFrame(n);
      const tile = material.texture?.tileMm ?? 1000;
      const local = triangulateFace(model, face);
      for (let i = 0; i < local.length; i += 3) {
        let [a, b, c] = [local[i], local[i + 1], local[i + 2]].map((q) => ({ q, p: q.clone().applyMatrix4(matrix) }));
        const cross = new THREE.Vector3().subVectors(b.p, a.p).cross(new THREE.Vector3().subVectors(c.p, a.p));
        if (cross.dot(n) < 0) [b, c] = [c, b];
        for (const { q, p } of [a, b, c]) {
          bucket.positions.push(p.x, p.y, p.z);
          const shade = smoothing ? smoothNormal(around.get(keyOf(q)), n, cosSmooth) : n;
          bucket.normals.push(shade.x, shade.y, shade.z);
          bucket.uvs.push(p.dot(u) / tile, p.dot(v) / tile);
        }
      }
    }
  }
  return buckets;
}

/**
 * The area of upward-facing horizontal triangles per height (rounded to the millimetre), from flat triangle lists in
 * world space (Z up): where the floors, terraces, lawns and water surfaces of a model are.
 */
export function levelAreas(surfaces: Iterable<{ positions: ArrayLike<number>; normals: ArrayLike<number> }>): Map<number, number> {
  const area = new Map<number, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const { positions, normals } of surfaces) {
    for (let i = 0; i + 8 < positions.length; i += 9) {
      if (normals[i + 2] < 0.98 || normals[i + 5] < 0.98 || normals[i + 8] < 0.98) continue;
      a.set(positions[i], positions[i + 1], positions[i + 2]);
      b.set(positions[i + 3], positions[i + 4], positions[i + 5]);
      c.set(positions[i + 6], positions[i + 7], positions[i + 8]);
      if (Math.abs(a.z - b.z) > 0.5 || Math.abs(a.z - c.z) > 0.5) continue;
      const z = Math.round(a.z);
      area.set(z, (area.get(z) ?? 0) + b.sub(a).cross(c.sub(a)).length() / 2);
    }
  }
  return area;
}

/**
 * Where the endless ground of the photorealistic view lies: just under the largest level at or below z = 0. When that
 * level is sunk below zero (a lawn with a pool let into it), the ground leaves a hole the size of that level, so the
 * pool and anything else below the lawn stays visible while the site's buried sides stay hidden under the ground.
 */
export function groundPlan(surfaces: Iterable<{ positions: ArrayLike<number>; normals: ArrayLike<number> }>): { z: number; hole: THREE.Box2 | null } {
  const list = [...surfaces];
  let best = 0;
  let bestArea = 0;
  for (const [z, area] of levelAreas(list)) {
    if (z <= 0 && area > bestArea) {
      best = z;
      bestArea = area;
    }
  }
  if (best > -1) return { z: best - 0.5, hole: null };
  const hole = new THREE.Box2();
  for (const { positions, normals } of list) {
    for (let i = 0; i + 8 < positions.length; i += 9) {
      if (normals[i + 2] < 0.98) continue;
      if ([2, 5, 8].every((k) => Math.round(positions[i + k]) === best)) {
        for (const k of [0, 3, 6]) hole.expandByPoint(new THREE.Vector2(positions[i + k], positions[i + k + 1]));
      }
    }
  }
  return { z: best - 0.5, hole };
}

/** The ground as a flat disc of `radius` around `centre` at height `z`, with a rectangular hole (see `groundPlan`). */
export function groundGeometry(plan: { z: number; hole: THREE.Box2 | null }, centre: THREE.Vector2, radius: number): THREE.BufferGeometry {
  const shape = new THREE.Shape().absarc(centre.x, centre.y, radius, 0, Math.PI * 2, false);
  if (plan.hole) {
    const { min, max } = plan.hole;
    shape.holes.push(new THREE.Path().moveTo(min.x, min.y).lineTo(min.x, max.y).lineTo(max.x, max.y).lineTo(max.x, min.y).lineTo(min.x, min.y));
  }
  const geometry = new THREE.ShapeGeometry(shape, 64);
  geometry.translate(0, 0, plan.z);
  return geometry;
}
