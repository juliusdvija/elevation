import * as THREE from 'three';

/** An edge that may be part of the outline: its ends, and the normals of the one or two faces it borders (world space). */
export interface ProfileCandidate {
  a: THREE.Vector3;
  b: THREE.Vector3;
  n1: THREE.Vector3;
  n2: THREE.Vector3 | null;
}

/**
 * The edges that form the outline of the model seen from a camera: edges of a single face (the rim of a
 * sheet) and edges between a face that looks at the camera and one that looks away. `eye` is the camera
 * position for a perspective view; null with `toward` (the direction from the model to the camera) for a
 * parallel one. Returns segment end points, three numbers each, ready for `ThickLines`.
 */
export function profileSegments(candidates: readonly ProfileCandidate[], eye: THREE.Vector3 | null, toward: THREE.Vector3): number[] {
  const out: number[] = [];
  const view = new THREE.Vector3();
  for (const { a, b, n1, n2 } of candidates) {
    let outline = n2 === null;
    if (n2) {
      if (eye) view.set((a.x + b.x) / 2 - eye.x, (a.y + b.y) / 2 - eye.y, (a.z + b.z) / 2 - eye.z).negate();
      else view.copy(toward);
      outline = n1.dot(view) > 0 !== n2.dot(view) > 0;
    }
    if (outline) out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return out;
}
