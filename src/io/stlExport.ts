import * as THREE from 'three';
import type { Model } from '../kernel/Model';
import { triangulateFace } from '../kernel/faces';

export interface StlResult {
  /** The binary STL file. */
  data: Uint8Array;
  triangles: number;
  /** Edges not shared by exactly two faces: a printable model has none. */
  openEdges: number;
  size: THREE.Vector3;
}

/**
 * Writes a model as binary STL, in millimetres and Z up (what slicers expect): faces triangulated, one
 * normal per triangle. Also reports whether the surface is watertight, since an open one will not print.
 */
export function exportStl(model: Model, name = 'Elevation'): StlResult {
  const triangles: THREE.Vector3[][] = [];
  const normals: THREE.Vector3[] = [];
  for (const face of model.allFaces()) {
    const points = triangulateFace(model, face);
    for (let i = 0; i + 2 < points.length; i += 3) {
      triangles.push([points[i], points[i + 1], points[i + 2]]);
      normals.push(face.normal);
    }
  }
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode(`${name} - Elevation`.slice(0, 79)));
  view.setUint32(80, triangles.length, true);
  triangles.forEach((tri, i) => {
    const at = 84 + i * 50;
    // Wind each triangle counter-clockwise seen from outside, to agree with the face normal.
    const n = normals[i];
    const cross = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0]));
    const [a, b, c] = cross.dot(n) < 0 ? [tri[0], tri[2], tri[1]] : tri;
    [n, a, b, c].forEach((v, k) => {
      view.setFloat32(at + k * 12, v.x, true);
      view.setFloat32(at + k * 12 + 4, v.y, true);
      view.setFloat32(at + k * 12 + 8, v.z, true);
    });
  });
  const openEdges = model.allEdges().filter((e) => model.facesOfEdge(e.id).length % 2 !== 0 || model.facesOfEdge(e.id).length === 0).length;
  return { data: new Uint8Array(buffer), triangles: triangles.length, openEdges, size: model.bounds().getSize(new THREE.Vector3()) };
}
