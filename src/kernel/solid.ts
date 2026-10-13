import * as THREE from 'three';
import type { Id, Model } from './Model';
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
  return insideTester(model)(p);
}

/**
 * A point-in-solid test bound to the model as it is now, so it keeps
 * answering for the old shape while the model is being edited. `skip` leaves
 * a face out: a loose face being pulled is not part of any solid, and a ray
 * crossing it would flip the parity.
 */
export function insideTester(model: Model, skip?: Id): (p: THREE.Vector3) => boolean {
  return insideTesterOf(model.allFaces().filter((face) => face.id !== skip).map((face) => triangulateFace(model, face).map((v) => v.clone())));
}

/** The same test over loose triangles: one array of points (three per triangle) per surface piece. */
export function insideTesterOf(triangles: THREE.Vector3[][]): (p: THREE.Vector3) => boolean {
  const boxes = triangles.map((tris) => new THREE.Box3().setFromPoints(tris));
  const hit = new THREE.Vector3();
  return (p) =>
    RAY_DIRS.every((dir) => {
      const ray = new THREE.Ray(p, dir);
      let crossings = 0;
      triangles.forEach((tris, f) => {
        if (!ray.intersectsBox(boxes[f])) return;
        for (let i = 0; i < tris.length; i += 3) {
          if (ray.intersectTriangle(tris[i], tris[i + 1], tris[i + 2], false, hit)) {
            crossings++;
            break;
          }
        }
      });
      return crossings % 2 === 1;
    });
}
