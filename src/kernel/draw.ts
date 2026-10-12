import type * as THREE from 'three';
import type { Id, Model } from './Model';
import { updateFaces } from './faces';
import { EPS, closestBetweenSegments, projectOnSegment } from './math';

function insertIntoLoop(loop: readonly Id[], a: Id, b: Id, w: Id): Id[] {
  const result: Id[] = [];
  for (let i = 0; i < loop.length; i++) {
    const x = loop[i];
    const y = loop[(i + 1) % loop.length];
    result.push(x);
    if ((x === a && y === b) || (x === b && y === a)) result.push(w);
  }
  return result;
}

/** Splits an edge at `p` (which must lie on it); faces using it get the new vertex. */
export function splitEdge(model: Model, edgeId: Id, p: THREE.Vector3): Id {
  const w = model.addVertex(p);
  splitEdgeAt(model, edgeId, w);
  return w;
}

/** Splits an edge at an existing vertex `w` lying on it. */
export function splitEdgeAt(model: Model, edgeId: Id, w: Id): void {
  const edge = model.edge(edgeId);
  const faces = model.facesOfEdge(edgeId);
  model.removeEdge(edgeId);
  model.addEdge(edge.a, w);
  model.addEdge(w, edge.b);
  for (const id of faces) {
    const face = model.face(id);
    model.putFace({
      ...face,
      outer: insertIntoLoop(face.outer, edge.a, edge.b, w),
      holes: face.holes.map((h) => insertIntoLoop(h, edge.a, edge.b, w)),
    });
  }
}

/** The vertex at `p`: an existing one, a split of the edge under it, or a new one. */
export function vertexAt(model: Model, p: THREE.Vector3): Id {
  const existing = model.findVertex(p);
  if (existing !== undefined) return existing;
  const edge = model.findEdgeContaining(p);
  if (edge !== undefined) return splitEdge(model, edge, p);
  return model.addVertex(p);
}

/**
 * Adds segment pq, splitting it (and the edges it meets) wherever it touches
 * existing geometry. Ids of edges created are added to `created`. Does not
 * update faces; call `updateFaces` once after a batch.
 */
export function insertSegment(model: Model, p: THREE.Vector3, q: THREE.Vector3, created: Set<Id>): void {
  const a = vertexAt(model, p);
  const b = vertexAt(model, q);
  if (a === b) return;
  const A = model.position(a);
  const B = model.position(b);
  const length = A.distanceTo(B);
  const cuts: { t: number; v: Id }[] = [];

  for (const edge of model.allEdges()) {
    if (!model.hasEdge(edge.id)) continue;
    // Existing vertices lying on the new segment (T-junctions, collinear overlaps).
    for (const v of [edge.a, edge.b]) {
      if (v === a || v === b) continue;
      const { t, distance } = projectOnSegment(model.position(v), A, B);
      if (distance < EPS && t * length > EPS && (1 - t) * length > EPS) cuts.push({ t, v });
    }
    // Proper crossings in the interior of both segments.
    if (edge.a === a || edge.a === b || edge.b === a || edge.b === b) continue;
    const C = model.position(edge.a);
    const D = model.position(edge.b);
    const hit = closestBetweenSegments(A, B, C, D);
    if (hit.parallel || hit.distance >= EPS) continue;
    const otherLength = C.distanceTo(D);
    const insideNew = hit.s * length > EPS && (1 - hit.s) * length > EPS;
    const insideOld = hit.t * otherLength > EPS && (1 - hit.t) * otherLength > EPS;
    if (insideNew && insideOld) {
      const point = A.clone().lerp(B, hit.s);
      cuts.push({ t: hit.s, v: splitEdge(model, edge.id, point) });
    }
  }

  cuts.sort((x, y) => x.t - y.t);
  const chain = [a, ...cuts.map((c) => c.v), b].filter((v, i, all) => i === 0 || v !== all[i - 1]);
  for (let i = 0; i + 1 < chain.length; i++) {
    if (model.edgeBetween(chain[i], chain[i + 1]) === undefined) {
      created.add(model.addEdge(chain[i], chain[i + 1]));
    }
  }
}

/** Draws segments and creates the faces they close. Returns the new edge ids. */
export function drawSegments(model: Model, segments: [THREE.Vector3, THREE.Vector3][]): Id[] {
  const created = new Set<Id>();
  for (const [p, q] of segments) insertSegment(model, p, q, created);
  updateFaces(model, created);
  return [...created].filter((e) => model.hasEdge(e));
}

/** Draws a closed polygon (e.g. a rectangle). */
export function drawPolygon(model: Model, points: THREE.Vector3[]): Id[] {
  return drawSegments(
    model,
    points.map((p, i) => [p, points[(i + 1) % points.length]]),
  );
}
