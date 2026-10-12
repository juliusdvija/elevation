import type { Id, Model } from './Model';
import { coplanarSameSide, faceArea, rebuildPlane } from './faces';
import { DIR_EPS, EPS } from './math';

function withoutVertex(loop: readonly Id[], v: Id): Id[] {
  return loop.filter((x) => x !== v);
}

/** Drops consecutive repeats (cyclically) from a loop. */
function dedupeLoop(loop: readonly Id[]): Id[] {
  const result = loop.filter((v, i) => v !== loop[(i + 1) % loop.length]);
  return result.length === loop.length ? result : dedupeLoop(result);
}

export function removeOrphanVertices(model: Model, vertices: Iterable<Id>): void {
  for (const v of vertices) if (model.hasVertex(v) && model.edgesAt(v).length === 0) model.removeVertex(v);
}

/**
 * Joins the two edges at `v` into one when they are collinear and nothing
 * else uses the vertex.
 */
export function mergeCollinear(model: Model, v: Id): boolean {
  if (!model.hasVertex(v)) return false;
  const edges = model.edgesAt(v);
  if (edges.length !== 2) return false;
  const [e1, e2] = edges.map((e) => model.edge(e));
  const x = model.other(e1, v);
  const y = model.other(e2, v);
  if (x === y || model.edgeBetween(x, y) !== undefined) return false;

  const p = model.position(v);
  const dx = model.position(x).clone().sub(p).normalize();
  const dy = model.position(y).clone().sub(p).normalize();
  if (dx.dot(dy) > -(1 - DIR_EPS)) return false;

  const faces = model.facesAtVertex(v);
  model.removeEdge(e1.id);
  model.removeEdge(e2.id);
  model.addEdge(x, y);
  for (const id of faces) {
    const face = model.face(id);
    model.putFace({
      ...face,
      outer: withoutVertex(face.outer, v),
      holes: face.holes.map((h) => withoutVertex(h, v)),
    });
  }
  model.removeVertex(v);
  return true;
}

function tidyVertices(model: Model, vertices: Iterable<Id>): void {
  const list = [...vertices];
  removeOrphanVertices(model, list);
  for (const v of list) mergeCollinear(model, v);
}

/** Removes edges between two coplanar faces facing the same way, merging the faces. */
export function healEdges(model: Model, edges: Iterable<Id>): void {
  const touched = new Set<Id>();
  for (const id of edges) {
    if (!model.hasEdge(id)) continue;
    const faces = model.facesOfEdge(id).map((f) => model.face(f));
    if (faces.length !== 2 || !coplanarSameSide(model, faces[0], faces[1])) continue;
    const edge = model.edge(id);
    const plane = model.facePlane(faces[0]);
    // Other edges between the same two faces end up inside the merged face.
    const between = new Set([...model.faceEdges(faces[0]), ...model.faceEdges(faces[1])]);
    model.removeEdge(id);
    rebuildPlane(model, plane, new Set());
    touched.add(edge.a).add(edge.b);
    for (const e of between) {
      if (!model.hasEdge(e) || model.facesOfEdge(e).length > 0) continue;
      const stray = model.edge(e);
      model.removeEdge(e);
      touched.add(stray.a).add(stray.b);
    }
  }
  tidyVertices(model, touched);
}

/**
 * Erases edges like SketchUp's Eraser: an edge between two coplanar faces
 * merges them, otherwise the faces it bounds are deleted with it.
 */
export function eraseEdges(model: Model, ids: Iterable<Id>): void {
  const touched = new Set<Id>();
  for (const id of ids) {
    if (!model.hasEdge(id)) continue;
    const edge = model.edge(id);
    const faces = model.facesOfEdge(id).map((f) => model.face(f));
    touched.add(edge.a).add(edge.b);
    if (faces.length === 2 && coplanarSameSide(model, faces[0], faces[1])) {
      const plane = model.facePlane(faces[0]);
      model.removeEdge(id);
      rebuildPlane(model, plane, new Set());
    } else {
      for (const f of faces) model.removeFace(f.id);
      model.removeEdge(id);
    }
  }
  tidyVertices(model, touched);
}

export function eraseFaces(model: Model, ids: Iterable<Id>): void {
  for (const id of ids) if (model.hasFace(id)) model.removeFace(id);
}

/**
 * Merges each of `vertices` into any other vertex at the same position, then
 * removes edges and faces that collapsed. Used after moving geometry.
 * Returns the surviving vertices.
 */
export function weldVertices(model: Model, vertices: Iterable<Id>): Set<Id> {
  const survivors = new Set<Id>();
  for (const v of vertices) {
    if (!model.hasVertex(v)) continue;
    const p = model.position(v);
    const target = model
      .allVertices()
      .find((u) => u.id !== v && u.position.distanceTo(p) < EPS)?.id;
    if (target === undefined) {
      survivors.add(v);
      continue;
    }
    survivors.add(target);

    const faces = model.facesAtVertex(v);
    for (const e of model.edgesAt(v)) {
      const x = model.other(model.edge(e), v);
      model.removeEdge(e);
      if (x !== target) model.addEdge(target, x);
    }
    for (const id of faces) {
      const face = model.face(id);
      const swap = (loop: readonly Id[]) => dedupeLoop(loop.map((x) => (x === v ? target : x)));
      model.putFace({ ...face, outer: swap(face.outer), holes: face.holes.map(swap) });
    }
    model.removeVertex(v);
  }

  // Drop faces that collapsed, and pairs of identical faces (two sides of nothing).
  const faces = new Set<Id>();
  for (const v of survivors) for (const f of model.facesAtVertex(v)) faces.add(f);
  const seen = new Map<string, Id>();
  for (const id of faces) {
    if (!model.hasFace(id)) continue;
    const face = model.face(id);
    if (face.outer.length < 3 || faceArea(model, face) < 1e-2) {
      model.removeFace(id);
      continue;
    }
    const key = [...face.outer].sort((a, b) => a - b).join(',');
    const twin = seen.get(key);
    if (twin !== undefined && model.hasFace(twin)) {
      if (model.face(twin).normal.dot(face.normal) < 0) model.removeFace(twin);
      model.removeFace(id);
    } else {
      seen.set(key, id);
    }
  }
  return survivors;
}
