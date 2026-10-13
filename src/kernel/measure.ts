import * as THREE from 'three';
import type { Id, Model } from './Model';
import { faceArea } from './faces';

/** Length of an edge. */
export function edgeLength(model: Model, edge: Id): number {
  const e = model.edge(edge);
  return model.position(e.a).distanceTo(model.position(e.b));
}

/** Total length of all loops of a face (outline and holes). */
export function facePerimeter(model: Model, faceId: Id): number {
  const face = model.face(faceId);
  let total = 0;
  for (const loop of model.faceLoops(face)) {
    loop.forEach((v, i) => {
      total += model.position(v).distanceTo(model.position(loop[(i + 1) % loop.length]));
    });
  }
  return total;
}

/** Area of a face (outline minus holes). */
export const areaOf = (model: Model, faceId: Id): number => faceArea(model, model.face(faceId));

/**
 * The volume enclosed by a set of faces, or null when they do not close up: every edge of the faces must be
 * shared by exactly two of them. Faces must point outwards (as the kernel keeps them).
 */
export function enclosedVolume(model: Model, faceIds: Iterable<Id>): number | null {
  const faces = [...faceIds].filter((id) => model.hasFace(id));
  if (faces.length < 4) return null;
  const set = new Set(faces);
  for (const id of faces) {
    for (const edge of model.faceEdges(model.face(id))) {
      if (model.facesOfEdge(edge).filter((f) => set.has(f)).length !== 2) return null;
    }
  }
  let volume = 0;
  for (const id of faces) {
    const face = model.face(id);
    volume += (faceArea(model, face) * face.normal.dot(model.position(face.outer[0]))) / 3;
  }
  return Math.abs(volume);
}

/** The box around the vertices of faces and edges, transformed by `matrix` (world space for a placement). Empty box when there are none. */
export function entityBounds(model: Model, faces: Iterable<Id>, edges: Iterable<Id>, matrix = new THREE.Matrix4()): THREE.Box3 {
  const box = new THREE.Box3();
  const add = (v: Id) => box.expandByPoint(model.position(v).clone().applyMatrix4(matrix));
  for (const id of faces) if (model.hasFace(id)) for (const v of model.faceVertices(model.face(id))) add(v);
  for (const id of edges) if (model.hasEdge(id)) {
    const e = model.edge(id);
    add(e.a);
    add(e.b);
  }
  return box;
}
