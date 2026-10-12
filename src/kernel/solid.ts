import * as THREE from 'three';
import type { Model } from './Model';
import { triangulateFace } from './faces';

// Oblique so rays are unlikely to graze edges of axis-aligned geometry.
const RAY_DIRS = [
  new THREE.Vector3(0.5773, 0.5779, 0.5767).normalize(),
  new THREE.Vector3(-0.5781, -0.5769, -0.5771).normalize(),
  new THREE.Vector3(0.3217, -0.8113, 0.4882).normalize(),
];

/**
 * Whether `p` lies inside a closed volume formed by the model's faces. Counts
 * face crossings along several rays (even-odd); all must agree, so a point
 * next to open geometry (a single face) does not count as inside.
 */
export function pointInsideSolid(model: Model, p: THREE.Vector3): boolean {
  const triangles = model.allFaces().map((face) => triangulateFace(model, face));
  const hit = new THREE.Vector3();
  return RAY_DIRS.every((dir) => {
    const ray = new THREE.Ray(p, dir);
    let crossings = 0;
    for (const tris of triangles) {
      for (let i = 0; i < tris.length; i += 3) {
        if (ray.intersectTriangle(tris[i], tris[i + 1], tris[i + 2], false, hit)) {
          crossings++;
          break;
        }
      }
    }
    return crossings % 2 === 1;
  });
}
