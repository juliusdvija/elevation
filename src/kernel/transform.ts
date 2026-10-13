import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges, weldVertices } from './cleanup';
import { splitEdge, splitEdgeAt } from './draw';
import { canonicalPlane, closestBetweenSegments, EPS, planeFromPointNormal, projectOnSegment, samePlane, type Plane } from './math';
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
      color: f.color,
      opacity: f.opacity,
    });
  }
  const created = [...map.values()];
  settle(model, created);
  return created;
}

const MIN_TRIANGLE_AREA = 0.5; // mm²

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
function foldFace(model: Model, face: Face): { diagonals: Id[]; faces: Id[] } {
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
  const created: Id[] = [];
  const loopVertices = [...new Set(ids)];
  for (const [i, j, k] of triangles) {
    const [a, b, c] = [ids[i], ids[j], ids[k]].map((v) => model.position(v));
    let normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    // Skip slivers from collinear points: they cover no area.
    if (normal.length() / 2 < MIN_TRIANGLE_AREA) continue;
    normal.normalize();
    let tri = [ids[i], ids[j], ids[k]];
    if (normal.dot(face.normal) < 0) {
      normal = normal.negate();
      tri = [tri[0], tri[2], tri[1]];
    }
    // Keep vertices that lie on a triangle side in its loop, so no edge spans them.
    const outer: Id[] = [];
    for (const [p, q] of loopPairs(tri)) {
      outer.push(p);
      const P = model.position(p);
      const Q = model.position(q);
      const between = loopVertices
        .filter((v) => v !== p && v !== q)
        .map((v) => ({ v, ...projectOnSegment(model.position(v), P, Q) }))
        .filter(({ t, distance }) => distance < EPS && t > 0 && t < 1)
        .sort((x, y) => x.t - y.t);
      outer.push(...between.map((x) => x.v));
    }
    for (const [p, q] of loopPairs(outer)) {
      if (model.edgeBetween(p, q) === undefined) diagonals.push(model.addEdge(p, q));
    }
    created.push(model.putFace({ outer, holes: [], normal, color: face.color, opacity: face.opacity }));
  }
  return { diagonals, faces: created };
}

/**
 * Settles geometry after its vertices moved or were created: merges
 * coincident vertices, splits edges that now pass through vertices, folds
 * faces that are no longer flat, recomputes the faces of affected planes and
 * merges coplanar neighbours.
 */
export function settle(model: Model, vertices: Iterable<Id>): void {
  const survivors = weldVertices(model, vertices);
  const live = () => [...survivors].filter((v) => model.hasVertex(v));
  const facesNear = () => {
    const faces = new Set<Id>();
    for (const v of live()) for (const f of model.facesAtVertex(v)) faces.add(f);
    return faces;
  };

  // Fold faces that bent out of plane; refresh the normal of flat faces that tilted.
  const healCandidates = new Set<Id>();
  const folded = new Set<Id>();
  for (const id of facesNear()) {
    if (!model.hasFace(id)) continue;
    const face = model.face(id);
    if (!isPlanar(model, face)) {
      const fold = foldFace(model, face);
      for (const e of fold.diagonals) healCandidates.add(e);
      for (const f of fold.faces) {
        folded.add(f);
        // Triangles may lie in a neighbour's plane and merge with it.
        for (const e of model.faceEdges(model.face(f))) healCandidates.add(e);
      }
      continue;
    }
    const n = newellNormal(face.outer.map((v) => model.position(v)));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    if (n.dot(face.normal) < 0) n.negate();
    if (n.angleTo(face.normal) > 1e-9) model.putFace({ ...face, normal: n });
  }

  // A vertex landing on an edge splits it.
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

  // Edges of the settled geometry (and fold diagonals): split at vertices lying
  // on them and where they cross other edges, until nothing more needs splitting.
  const queue = new Set<Id>(healCandidates);
  for (const v of live()) for (const e of model.edgesAt(v)) queue.add(e);
  const splitInto = (edge: { a: Id; b: Id }, w: Id) => {
    survivors.add(w);
    for (const piece of [model.edgeBetween(edge.a, w), model.edgeBetween(w, edge.b)]) {
      if (piece === undefined) continue;
      queue.add(piece);
      healCandidates.add(piece);
    }
  };
  while (queue.size > 0) {
    const e = queue.values().next().value as Id;
    queue.delete(e);
    if (!model.hasEdge(e)) continue;
    const edge = model.edge(e);
    const onIt = model.allVertices().find((w) => w.id !== edge.a && w.id !== edge.b && onEdgeInterior(model, e, w.position));
    if (onIt) {
      splitEdgeAt(model, e, onIt.id);
      splitInto(edge, onIt.id);
      continue;
    }
    const A = model.position(edge.a);
    const B = model.position(edge.b);
    for (const other of model.allEdges()) {
      if (other.id === e || other.a === edge.a || other.a === edge.b || other.b === edge.a || other.b === edge.b) continue;
      const C = model.position(other.a);
      const D = model.position(other.b);
      const hit = closestBetweenSegments(A, B, C, D);
      if (hit.parallel || hit.distance >= EPS) continue;
      const lengthAB = A.distanceTo(B);
      const lengthCD = C.distanceTo(D);
      const interior = (t: number, length: number) => t * length > EPS && (1 - t) * length > EPS;
      if (!interior(hit.s, lengthAB) || !interior(hit.t, lengthCD)) continue;
      const w = splitEdge(model, other.id, A.clone().lerp(B, hit.s));
      splitEdgeAt(model, e, w);
      splitInto(edge, w);
      // The other edge's pieces may have been waiting in the queue themselves.
      splitInto(other, w);
      break;
    }
  }

  // Recompute faces in each affected plane (keeps faces, splits or merges regions).
  const planes: Plane[] = [];
  for (const id of new Set([...facesNear(), ...folded])) {
    if (!model.hasFace(id)) continue;
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

/**
 * Copies faces and edges from `source` into `target`, transformed by
 * `matrix`. With `settleAfter`, the copy merges with what is already there
 * (as when exploding a group); otherwise it is placed as is (filling a new,
 * empty group). Returns the created vertices.
 */
export function copyBetweenModels(
  source: Model,
  target: Model,
  faces: Iterable<Id>,
  edges: Iterable<Id>,
  matrix: THREE.Matrix4,
  settleAfter: boolean,
): Id[] {
  const faceList = [...faces].filter((f) => source.hasFace(f)).map((f) => source.face(f));
  const edgeIds = new Set([...edges].filter((e) => source.hasEdge(e)));
  for (const f of faceList) for (const e of source.faceEdges(f)) edgeIds.add(e);

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const map = new Map<Id, Id>();
  const copy = (v: Id) => {
    let c = map.get(v);
    if (c === undefined) map.set(v, (c = target.addVertex(source.position(v).clone().applyMatrix4(matrix))));
    return c;
  };
  for (const e of edgeIds) {
    const edge = source.edge(e);
    target.addEdge(copy(edge.a), copy(edge.b));
  }
  for (const f of faceList) {
    target.putFace({
      outer: f.outer.map(copy),
      holes: f.holes.map((h) => h.map(copy)),
      normal: f.normal.clone().applyMatrix3(normalMatrix).normalize(),
      color: f.color,
      opacity: f.opacity,
    });
  }
  const created = [...map.values()];
  if (settleAfter) settle(target, created);
  return created;
}
