import * as THREE from 'three';
import type { Face, Model } from './Model';
import { loopPairs, pairKey } from './Model';
import { faceInteriorPoint, faceContainsPoint, newellNormal } from './faces';
import { closestBetweenSegments, EPS, projectOnSegment, samePlane } from './math';

export interface Problem {
  kind: string;
  detail: string;
}

/** Points off a face's plane by more than this (mm) count as not flat. */
const PLANAR_TOLERANCE = 0.01;

/**
 * Checks the model's structural invariants. An empty list means the model is
 * consistent. Used by tests and available from the dev console.
 */
export function validateModel(model: Model, options: { orientation?: boolean } = {}): Problem[] {
  const problems: Problem[] = [];
  const report = (kind: string, detail: string) => problems.push({ kind, detail });

  const pairs = new Map<string, number>();
  for (const e of model.allEdges()) {
    if (e.a === e.b) report('degenerate-edge', `edge ${e.id}`);
    if (!model.hasVertex(e.a) || !model.hasVertex(e.b)) {
      report('dangling-edge', `edge ${e.id} references a missing vertex`);
      continue;
    }
    if (model.position(e.a).distanceTo(model.position(e.b)) < 1e-6) report('zero-length-edge', `edge ${e.id}`);
    const key = pairKey(e.a, e.b);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    if (model.edgeBetween(e.a, e.b) !== e.id) report('edge-index', `edge ${e.id} not indexed by its vertex pair`);
  }
  for (const [key, count] of pairs) if (count > 1) report('duplicate-edge', `${count} edges between ${key}`);

  for (const v of model.allVertices()) {
    if (model.edgesAt(v.id).length === 0) report('orphan-vertex', `vertex ${v.id}`);
    if (!Number.isFinite(v.position.x + v.position.y + v.position.z)) report('non-finite', `vertex ${v.id}`);
  }

  for (const face of model.allFaces()) checkFace(model, face, report);
  checkArrangement(model, report);
  if (options.orientation) checkOrientation(model, report);

  // Coplanar faces must not overlap.
  const faces = model.allFaces();
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const plane = model.facePlane(f);
    const sample = faceInteriorPoint(model, f);
    if (!sample) continue;
    for (let j = 0; j < faces.length; j++) {
      if (i === j) continue;
      const g = faces[j];
      if (!samePlane(plane, model.facePlane(g))) continue;
      if (faceContainsPoint(model, g, sample)) report('overlapping-faces', `faces ${f.id} and ${g.id}`);
    }
  }
  return problems;
}

function checkFace(model: Model, face: Face, report: (kind: string, detail: string) => void): void {
  const loops = model.faceLoops(face);
  for (const loop of loops) {
    if (loop.length < 3) report('short-loop', `face ${face.id}`);
    if (loop.some((v) => !model.hasVertex(v))) {
      report('dangling-face', `face ${face.id} references a missing vertex`);
      return;
    }
    for (const [a, b] of loopPairs(loop)) {
      if (a === b) report('repeated-vertex', `face ${face.id}`);
      else if (model.edgeBetween(a, b) === undefined) report('missing-edge', `face ${face.id} has no edge ${a}-${b}`);
      else if (!model.facesOfEdge(model.edgeBetween(a, b)!).includes(face.id)) report('face-index', `face ${face.id}`);
    }
  }

  const n = face.normal;
  if (Math.abs(n.length() - 1) > 1e-6) report('normal-length', `face ${face.id}`);
  const p0 = model.position(face.outer[0]);
  for (const v of loops.flat()) {
    const off = Math.abs(n.dot(new THREE.Vector3().subVectors(model.position(v), p0)));
    if (off > PLANAR_TOLERANCE) {
      report('not-planar', `face ${face.id} vertex ${v} is ${off.toFixed(4)} mm off its plane`);
      break;
    }
  }

  const outerArea = newellNormal(face.outer.map((v) => model.position(v)));
  if (outerArea.dot(n) <= 0) report('outer-orientation', `face ${face.id} outer loop runs against its normal`);
  for (const hole of face.holes) {
    if (newellNormal(hole.map((v) => model.position(v))).dot(n) >= 0) report('hole-orientation', `face ${face.id}`);
  }
}

/** Edges must meet only at shared vertices: no unsplit crossings or T-junctions. */
function checkArrangement(model: Model, report: (kind: string, detail: string) => void): void {
  const edges = model.allEdges().filter((e) => model.hasVertex(e.a) && model.hasVertex(e.b));
  const vertices = model.allVertices();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const A = model.position(e.a);
    const B = model.position(e.b);
    const length = A.distanceTo(B);
    const interior = (t: number, l: number) => t * l > EPS && (1 - t) * l > EPS;
    for (const w of vertices) {
      if (w.id === e.a || w.id === e.b) continue;
      const { t, distance } = projectOnSegment(w.position, A, B);
      if (distance < EPS && interior(t, length)) report('vertex-on-edge', `vertex ${w.id} lies inside edge ${e.id}`);
    }
    for (let j = i + 1; j < edges.length; j++) {
      const g = edges[j];
      if (g.a === e.a || g.a === e.b || g.b === e.a || g.b === e.b) continue;
      const C = model.position(g.a);
      const D = model.position(g.b);
      const hit = closestBetweenSegments(A, B, C, D);
      if (!hit.parallel && hit.distance < EPS && interior(hit.s, length) && interior(hit.t, C.distanceTo(D))) {
        report('unsplit-crossing', `edges ${e.id} and ${g.id} cross`);
      }
    }
  }
}

/**
 * Neighbouring faces must agree on orientation: an edge shared by exactly two
 * faces is run in opposite directions by their loops (as on any consistently
 * oriented surface). A flipped face breaks this on all its edges.
 */
function checkOrientation(model: Model, report: (kind: string, detail: string) => void): void {
  const uses = new Map<string, { face: number; forward: boolean }[]>();
  for (const face of model.allFaces()) {
    for (const loop of model.faceLoops(face)) {
      for (const [a, b] of loopPairs(loop)) {
        const key = pairKey(a, b);
        const list = uses.get(key) ?? [];
        list.push({ face: face.id, forward: a < b });
        uses.set(key, list);
      }
    }
  }
  for (const [key, list] of uses) {
    if (list.length === 2 && list[0].forward === list[1].forward && list[0].face !== list[1].face) {
      report('inconsistent-orientation', `faces ${list[0].face} and ${list[1].face} both run edge ${key} the same way`);
    }
  }
}

/**
 * Edges piercing the interior of a face: the geometry intersects itself.
 * Expected after pushing or moving shapes into each other, since faces are
 * not intersected automatically (that needs an Intersect Faces command).
 */
export function selfIntersections(model: Model): Problem[] {
  const problems: Problem[] = [];
  const faces = model.allFaces().map((f) => {
    const points = model.faceLoops(f).flat().map((v) => model.position(v));
    return { face: f, box: new THREE.Box3().setFromPoints(points), plane: model.facePlane(f) };
  });
  for (const e of model.allEdges()) {
    const A = model.position(e.a);
    const B = model.position(e.b);
    const edgeBox = new THREE.Box3().setFromPoints([A, B]);
    for (const { face, box, plane } of faces) {
      if (!box.intersectsBox(edgeBox)) continue;
      const da = plane.normal.dot(A) - plane.d;
      const db = plane.normal.dot(B) - plane.d;
      // Must cross the plane properly, not touch it.
      if (!((da > EPS && db < -EPS) || (da < -EPS && db > EPS))) continue;
      const hit = A.clone().lerp(B, da / (da - db));
      if (!faceContainsPoint(model, face, hit)) continue;
      // Ignore hits on the face boundary.
      const onBoundary = model.faceLoops(face).some((loop) =>
        loopPairs(loop).some(([p, q]) => projectOnSegment(hit, model.position(p), model.position(q)).distance < EPS),
      );
      if (!onBoundary) problems.push({ kind: 'self-intersection', detail: `edge ${e.id} pierces face ${face.id}` });
    }
  }
  return problems;
}

/** Exact snapshot of the model, for comparing states (undo/redo). */
export function snapshot(model: Model): string {
  const byId = <T extends { id: number }>(list: T[]) => [...list].sort((a, b) => a.id - b.id);
  return JSON.stringify({
    v: byId(model.allVertices()).map((v) => [v.id, v.position.x, v.position.y, v.position.z]),
    e: byId(model.allEdges()).map((e) => [e.id, e.a, e.b]),
    f: byId(model.allFaces()).map((f) => [f.id, f.outer, f.holes, f.normal.toArray(), f.color ?? null, f.opacity ?? null, f.hatch ?? null, f.material ?? null]),
    g: byId(model.allGuides()).map((g) => [g.id, g.kind, g.point.toArray()]),
  });
}
