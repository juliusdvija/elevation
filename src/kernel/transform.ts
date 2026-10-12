import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges, weldVertices } from './cleanup';
import { splitEdgeAt } from './draw';
import { canonicalPlane, EPS, planeFromPointNormal, projectOnSegment, samePlane, type Plane } from './math';
import { newellNormal, rebuildPlane } from './faces';

/** Vertices used by a set of faces and edges. */
export function verticesOf(model: Model, faces: Iterable<Id>, edges: Iterable<Id>): Set<Id> {
  const vertices = new Set<Id>();
  for (const f of faces) if (model.hasFace(f)) for (const v of model.faceVertices(model.face(f))) vertices.add(v);
  for (const e of edges) {
    if (!model.hasEdge(e)) continue;
    const edge = model.edge(e);
    vertices.add(edge.a).add(edge.b);
  }
  return vertices;
}

/**
 * Moves vertices by `matrix`. Geometry attached to them stretches along, as
 * in SketchUp; afterwards the moved geometry is settled into its surroundings.
 */
export function transformVertices(model: Model, vertices: Iterable<Id>, matrix: THREE.Matrix4): void {
  const ids = [...vertices].filter((v) => model.hasVertex(v));
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const moved = new Set(ids);
  // Faces entirely carried along keep their orientation through the transform.
  const carried = new Set(
    model
      .allFaces()
      .filter((f) => model.faceVertices(f).every((v) => moved.has(v)))
      .map((f) => f.id),
  );
  for (const v of ids) model.moveVertex(v, model.position(v).clone().applyMatrix4(matrix));
  for (const id of carried) {
    const face = model.face(id);
    model.putFace({ ...face, normal: face.normal.clone().applyMatrix3(normalMatrix).normalize() });
  }
  settle(model, ids);
}

/**
 * Copies faces and edges, transformed by `matrix`, and settles the copy.
 * Returns the copied vertices.
 */
export function copyEntities(model: Model, faces: Iterable<Id>, edges: Iterable<Id>, matrix: THREE.Matrix4): Id[] {
  const faceList = [...faces].filter((f) => model.hasFace(f)).map((f) => model.face(f));
  const edgeIds = new Set([...edges].filter((e) => model.hasEdge(e)));
  for (const f of faceList) for (const e of model.faceEdges(f)) edgeIds.add(e);

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const map = new Map<Id, Id>();
  const copy = (v: Id) => {
    let c = map.get(v);
    if (c === undefined) map.set(v, (c = model.addVertex(model.position(v).clone().applyMatrix4(matrix))));
    return c;
  };
  for (const e of edgeIds) {
    const edge = model.edge(e);
    model.addEdge(copy(edge.a), copy(edge.b));
  }
  for (const f of faceList) {
    model.putFace({
      outer: f.outer.map(copy),
      holes: f.holes.map((h) => h.map(copy)),
      normal: f.normal.clone().applyMatrix3(normalMatrix).normalize(),
    });
  }
  const created = [...map.values()];
  settle(model, created);
  return created;
}

/** Whether all of a face's vertices lie in one plane. */
function isPlanar(model: Model, face: Face): boolean {
  const points = model.faceLoops(face).flat().map((v) => model.position(v));
  const n = newellNormal(points.slice(0, face.outer.length));
  if (n.lengthSq() < 1e-12) return true;
  const plane = planeFromPointNormal(points[0], n);
  return points.every((p) => Math.abs(plane.normal.dot(p) - plane.d) < EPS);
}

/**
 * Replaces a face that is no longer flat by triangles (folding it, like
 * SketchUp). Coplanar triangles are merged back by healing. Returns the new
 * diagonal edges.
 */
function foldFace(model: Model, face: Face): Id[] {
  const loops = model.faceLoops(face);
  const ids = loops.flat();
  const positions = ids.map((v) => model.position(v));
  const n = newellNormal(positions.slice(0, face.outer.length)).normalize();
  const u = new THREE.Vector3().crossVectors(Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), n).normalize();
  const w = new THREE.Vector3().crossVectors(n, u);
  const flat = (loop: readonly Id[]) => loop.map((v) => new THREE.Vector2(model.position(v).dot(u), model.position(v).dot(w)));
  const triangles = THREE.ShapeUtils.triangulateShape(flat(face.outer), face.holes.map(flat));

  model.removeFace(face.id);
  const diagonals: Id[] = [];
  for (const [i, j, k] of triangles) {
    const tri = [ids[i], ids[j], ids[k]];
    for (const [a, b] of loopPairs(tri)) {
      if (model.edgeBetween(a, b) === undefined) diagonals.push(model.addEdge(a, b));
    }
    const [a, b, c] = tri.map((v) => model.position(v));
    let normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let outer = tri;
    if (normal.dot(face.normal) < 0) {
      normal = normal.negate();
      outer = [tri[0], tri[2], tri[1]];
    }
    if (normal.lengthSq() > 0) model.putFace({ outer, holes: [], normal });
  }
  return diagonals;
}

/**
 * Settles geometry after its vertices moved or were created: merges
 * coincident vertices, splits edges that now pass through vertices, folds
 * faces that are no longer flat, recomputes the faces of affected planes and
 * merges coplanar neighbours.
 */
export function settle(model: Model, vertices: Iterable<Id>): void {
  const survivors = weldVertices(model, vertices);

  // A vertex landing on an edge splits it, and so does an edge sweeping over a vertex.
  const live = () => [...survivors].filter((v) => model.hasVertex(v));
  for (const v of live()) {
    const p = model.position(v);
    for (const e of model.allEdges()) {
      if (e.a === v || e.b === v || !model.hasEdge(e.id)) continue;
      if (onEdgeInterior(model, e.id, p)) {
        splitEdgeAt(model, e.id, v);
        break;
      }
    }
  }
  for (const v of live()) {
    for (const e of model.edgesAt(v)) {
      if (!model.hasEdge(e)) continue;
      const other = model.allVertices().find((w) => {
        const edge = model.edge(e);
        return w.id !== edge.a && w.id !== edge.b && onEdgeInterior(model, e, w.position);
      });
      if (other) splitEdgeAt(model, e, other.id);
    }
  }

  // Fold faces that bent out of plane.
  const healCandidates = new Set<Id>();
  const facesNear = () => {
    const faces = new Set<Id>();
    for (const v of live()) for (const f of model.facesAtVertex(v)) faces.add(f);
    return faces;
  };
  for (const id of facesNear()) {
    if (!model.hasFace(id)) continue;
    const face = model.face(id);
    if (!isPlanar(model, face)) {
      for (const e of foldFace(model, face)) healCandidates.add(e);
      continue;
    }
    // A flat face may have tilted: refresh its normal, keeping its side.
    const n = newellNormal(face.outer.map((v) => model.position(v)));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    if (n.dot(face.normal) < 0) n.negate();
    if (n.angleTo(face.normal) > 1e-9) model.putFace({ ...face, normal: n });
  }

  // Recompute faces in each affected plane (keeps faces, splits or merges regions).
  const planes: Plane[] = [];
  for (const id of facesNear()) {
    const plane = canonicalPlane(model.facePlane(model.face(id)));
    if (!planes.some((p) => samePlane(p, plane))) planes.push(plane);
  }
  for (const plane of planes) rebuildPlane(model, plane, new Set());

  for (const v of live()) for (const e of model.edgesAt(v)) healCandidates.add(e);
  healEdges(model, healCandidates);
}

function onEdgeInterior(model: Model, edgeId: Id, p: THREE.Vector3): boolean {
  const edge = model.edge(edgeId);
  const a = model.position(edge.a);
  const b = model.position(edge.b);
  const { t, distance } = projectOnSegment(p, a, b);
  const length = a.distanceTo(b);
  return distance < EPS && t * length > EPS && (1 - t) * length > EPS;
}
