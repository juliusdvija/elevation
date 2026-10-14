import * as THREE from 'three';

/** The shading normal at a corner: the area-weighted mean of the normals of the faces there that are within the smoothing angle of this face's. */
export function smoothNormal(neighbours: { n: THREE.Vector3; weight: number }[] | undefined, own: THREE.Vector3, cosAngle: number): THREE.Vector3 {
  if (!neighbours) return own;
  const sum = new THREE.Vector3();
  for (const { n, weight } of neighbours) if (n.dot(own) >= cosAngle) sum.addScaledVector(n, weight);
  return sum.lengthSq() > 1e-12 ? sum.normalize() : own;
}
