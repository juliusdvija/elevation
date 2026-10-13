import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs, pairKey } from './Model';
import {
  DIR_EPS,
  EPS,
  canonicalPlane,
  onPlane,
  planeFrame,
  planeFromPoints,
  to3D,
  pointInPolygon,
  samePlane,
  signedArea,
  to2D,
  type Plane,
  type PlaneFrame,
} from './math';

const MIN_AREA = 1e-2; // mm²

export function reverseLoop(loop: readonly Id[]): Id[] {
  return [loop[0], ...loop.slice(1).reverse()];
}

/** Area vector of a closed 3D polygon (Newell); its length is twice the area. */
export function newellNormal(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

export function faceArea(model: Model, face: Face): number {
  const loopArea = (loop: readonly Id[]) => newellNormal(loop.map((v) => model.position(v))).length() / 2;
  return loopArea(face.outer) - face.holes.reduce((sum, h) => sum + loopArea(h), 0);
}

interface Polygon2D {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
}

function facePolygon(model: Model, face: Face, frame: PlaneFrame): Polygon2D {
  const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
  return { outer: project(face.outer), holes: face.holes.map(project) };
}

function insidePolygon2D(p: THREE.Vector2, polygon: Polygon2D): boolean {
  return pointInPolygon(p, polygon.outer) && !polygon.holes.some((h) => pointInPolygon(p, h));
}

/** Triangles of a region as index triples into `[...outer, ...holes.flat()]`. */
function triangulate(outer: THREE.Vector2[], holes: THREE.Vector2[][]): number[][] {
  return THREE.ShapeUtils.triangulateShape(outer, holes);
}

/** A point well inside a region: the centroid of its largest triangle. */
function interiorPoint(outer: THREE.Vector2[], holes: THREE.Vector2[][]): THREE.Vector2 | null {
  const points = [...outer, ...holes.flat()];
  let best: THREE.Vector2 | null = null;
  let bestArea = 0;
  for (const [i, j, k] of triangulate(outer, holes)) {
    const a = points[i];
    const b = points[j];
    const c = points[k];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    if (area > bestArea) {
      bestArea = area;
      best = new THREE.Vector2((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    }
  }
  return best;
}

/** Triangulated face as flat 3D positions (three per triangle). */
export function triangulateFace(model: Model, face: Face): THREE.Vector3[] {
  const frame = planeFrame(model.facePlane(face));
  const loops = model.faceLoops(face);
  const positions = loops.flat().map((v) => model.position(v));
  const polygon = facePolygon(model, face, frame);
  const result: THREE.Vector3[] = [];
  for (const [i, j, k] of triangulate(polygon.outer, polygon.holes)) {
    result.push(positions[i], positions[j], positions[k]);
  }
  return result;
}

/** A point inside the face (not on its boundary), in world space. */
export function faceInteriorPoint(model: Model, face: Face): THREE.Vector3 | null {
  const frame = planeFrame(model.facePlane(face));
  const polygon = facePolygon(model, face, frame);
  const p = interiorPoint(polygon.outer, polygon.holes);
  return p ? frame.origin.clone().addScaledVector(frame.u, p.x).addScaledVector(frame.v, p.y) : null;
}

/** Whether world point `p` (assumed on the face plane) lies inside the face. */
export function faceContainsPoint(model: Model, face: Face, p: THREE.Vector3): boolean {
  const frame = planeFrame(model.facePlane(face));
  return insidePolygon2D(to2D(frame, p), facePolygon(model, face, frame));
}

export function coplanarSameSide(model: Model, f: Face, g: Face): boolean {
  return f.normal.dot(g.normal) > 1 - DIR_EPS && samePlane(model.facePlane(f), model.facePlane(g));
}

/** Flips a face if needed so its normal points along `desired`. */
export function setFaceNormal(model: Model, id: Id, desired: THREE.Vector3): void {
  const face = model.face(id);
  if (face.normal.dot(desired) >= 0) return;
  model.putFace({
    id,
    outer: reverseLoop(face.outer),
    holes: face.holes.map(reverseLoop),
    normal: face.normal.clone().negate(),
    color: face.color,
  });
}

/** Orientation for faces that appear without a parent face (SketchUp-like). */
function defaultNormal(plane: Plane): THREE.Vector3 {
  if (Math.abs(plane.normal.z) > 1 - DIR_EPS) {
    // Faces on the ground face down, other horizontal faces face up.
    return new THREE.Vector3(0, 0, Math.abs(plane.d) < EPS ? -1 : 1);
  }
  return plane.normal.clone();
}

/**
 * Normal for a new face so it agrees with the faces that share its edges:
 * on a consistently oriented surface, neighbours (in any plane) run a shared
 * edge in opposite directions. The outer loop runs counter-clockwise around
 * `plane.normal`, holes clockwise. Returns null when no neighbour decides it.
 */
function orientationFromNeighbours(model: Model, loops: Id[][], plane: Plane): THREE.Vector3 | null {
  let votes = 0;
  for (const [a, b] of loops.flatMap((loop) => loopPairs(loop))) {
    const edge = model.edgeBetween(a, b);
    if (edge === undefined) continue;
    const faces = model.facesOfEdge(edge).map((id) => model.face(id));
    for (const neighbour of faces) {
      // A coplanar neighbour always counts; across planes only a lone
      // neighbour does (with more faces on the edge it is ambiguous).
      const coplanar = samePlane(model.facePlane(neighbour), plane);
      if (!coplanar && faces.length !== 1) continue;
      const weight = coplanar ? 2 : 1;
      for (const l of model.faceLoops(neighbour)) {
        for (const [x, y] of loopPairs(l)) {
          if (x === a && y === b) votes -= weight; // same direction: we must flip
          if (x === b && y === a) votes += weight;
        }
      }
    }
  }
  if (votes === 0) return null;
  return votes > 0 ? plane.normal.clone() : plane.normal.clone().negate();
}

/**
 * Splits a closed walk at edges it traverses twice (dangling edges, bridges
 * between an outer loop and an inner one) into simple cycles.
 */
export function splitAtRepeatedEdges(cycle: Id[]): Id[][] {
  const n = cycle.length;
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = pairKey(cycle[i], cycle[(i + 1) % n]);
    const j = seen.get(key);
    if (j !== undefined) {
      const inner = cycle.slice(j + 1, i);
      const outer = [...cycle.slice(i + 1), ...cycle.slice(0, j)];
      return [...splitAtRepeatedEdges(inner), ...splitAtRepeatedEdges(outer)];
    }
    seen.set(key, i);
  }
  return n >= 3 ? [cycle] : [];
}

function sameLoop(a: readonly Id[], b: readonly Id[]): boolean {
  if (a.length !== b.length) return false;
  const offset = b.indexOf(a[0]);
  if (offset < 0) return false;
  return a.every((v, i) => b[(i + offset) % b.length] === v);
}

function sameFace(face: Face, outer: Id[], holes: Id[][], normal: THREE.Vector3): boolean {
  return (
    face.normal.dot(normal) > 1 - DIR_EPS &&
    sameLoop(face.outer, outer) &&
    face.holes.length === holes.length &&
    holes.every((h) => face.holes.some((fh) => sameLoop(fh, h)))
  );
}

interface Box2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(poly: readonly THREE.Vector2[]): Box2D {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of poly) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  return box;
}

const inBox = (p: THREE.Vector2, b: Box2D) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

interface Cycle {
  loop: Id[];
  poly: THREE.Vector2[];
  area: number;
}

/**
 * Recomputes the faces in one plane from the edges lying in it.
 *
 * Every bounded region of the planar edge graph becomes a face when it lies
 * inside a face that was already there (so splitting a face keeps both
 * halves), or when its outer boundary uses one of `newEdges` (so closing a
 * loop creates a face). Other regions stay empty, so a deleted face does not
 * come back. Each old face's id goes to its largest successor.
 */
/**
 * Optional per-region decision for `rebuildPlane`: given a point inside a
 * region (world space) and the plane normal, return the normal the face
 * there must have, null for no face, or undefined for the default rule.
 */
export type RegionDecision = (sample: THREE.Vector3, planeNormal: THREE.Vector3) => THREE.Vector3 | null | undefined;

export function rebuildPlane(model: Model, rawPlane: Plane, newEdges: ReadonlySet<Id>, decide?: RegionDecision): void {
  const plane = canonicalPlane(rawPlane);
  const frame = planeFrame(plane);

  // Plane membership is per vertex: most vertices are shared by several edges.
  const onVertex = new Map<Id, boolean>();
  const vertexOn = (v: Id) => {
    let on = onVertex.get(v);
    if (on === undefined) onVertex.set(v, (on = onPlane(plane, model.position(v))));
    return on;
  };
  const edges = model.allEdges().filter((e) => vertexOn(e.a) && vertexOn(e.b));
  const oldFaces = model.allFaces().filter((f) => Math.abs(f.normal.dot(plane.normal)) > 1 - DIR_EPS && vertexOn(f.outer[0]));
  if (edges.length === 0 && oldFaces.length === 0) return;

  const coords = new Map<Id, THREE.Vector2>();
  const at = (v: Id) => {
    let p = coords.get(v);
    if (!p) coords.set(v, (p = to2D(frame, model.position(v))));
    return p;
  };

  // Outgoing half-edges per vertex, sorted counter-clockwise.
  const outgoing = new Map<Id, { to: Id; angle: number }[]>();
  const addHalf = (from: Id, to: Id) => {
    const d = at(to).clone().sub(at(from));
    let list = outgoing.get(from);
    if (!list) outgoing.set(from, (list = []));
    list.push({ to, angle: Math.atan2(d.y, d.x) });
  };
  for (const e of edges) {
    addHalf(e.a, e.b);
    addHalf(e.b, e.a);
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  // Trace every half-edge once; each walk keeps its region on the left.
  const visited = new Set<number>();
  const half = (from: Id, to: Id) => from * 67108864 + to; // ids stay far below 2^26
  const cycles: Cycle[] = [];
  for (const e of edges) {
    for (const [start, end] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      if (visited.has(half(start, end))) continue;
      const walk: Id[] = [];
      let from = start;
      let to = end;
      while (!visited.has(half(from, to))) {
        visited.add(half(from, to));
        walk.push(from);
        const list = outgoing.get(to)!;
        const back = list.findIndex((o) => o.to === from);
        const next = list[(back - 1 + list.length) % list.length];
        from = to;
        to = next.to;
      }
      for (const loop of splitAtRepeatedEdges(walk)) {
        const poly = loop.map(at);
        cycles.push({ loop, poly, area: signedArea(poly) });
      }
    }
  }

  const outers = cycles.filter((c) => c.area > MIN_AREA);
  const holeLoops = cycles.filter((c) => c.area < -MIN_AREA);
  const regions = outers.map((c) => ({ ...c, holes: [] as Cycle[], box: boxOf(c.poly) }));

  // Each clockwise cycle is a hole in the smallest region around it.
  for (const hole of holeLoops) {
    const a = hole.poly[0];
    const b = hole.poly[1];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    const probe = mid.add(new THREE.Vector2(-dir.y, dir.x).multiplyScalar(0.05));
    let container: (typeof regions)[number] | undefined;
    for (const r of regions) {
      if (inBox(probe, r.box) && pointInPolygon(probe, r.poly) && (!container || r.area < container.area)) container = r;
    }
    container?.holes.push(hole);
  }

  const oldPolygons = oldFaces.map((face) => {
    const polygon = facePolygon(model, face, frame);
    return { face, polygon, box: boxOf(polygon.outer) };
  });

  const candidates: { region: (typeof regions)[number]; owner: Face | undefined; normal?: THREE.Vector3 }[] = [];
  for (const region of regions) {
    const sample = interiorPoint(
      region.poly,
      region.holes.map((h) => h.poly),
    );
    if (!sample) continue;
    const owner = oldPolygons.find((o) => inBox(sample, o.box) && insidePolygon2D(sample, o.polygon))?.face;
    const closesNewLoop = loopPairs(region.loop).some(([a, b]) => {
      const edge = model.edgeBetween(a, b);
      return edge !== undefined && newEdges.has(edge);
    });
    if (decide) {
      const verdict = decide(to3D(frame, sample), plane.normal);
      if (verdict === null) continue;
      if (verdict) {
        candidates.push({ region, owner, normal: verdict });
        continue;
      }
    }
    if (owner || closesNewLoop) candidates.push({ region, owner });
  }

  // The largest region inside an old face inherits its id.
  const heir = new Map<Id, (typeof candidates)[number]>();
  for (const c of candidates) {
    if (!c.owner) continue;
    const current = heir.get(c.owner.id);
    if (!current || c.region.area > current.region.area) heir.set(c.owner.id, c);
  }

  const kept = new Set<Id>();
  for (const c of candidates) {
    const id = c.owner && heir.get(c.owner.id) === c ? c.owner.id : undefined;
    const normal = c.normal
      ? c.normal.clone()
      : c.owner
      ? c.owner.normal.clone()
      : (orientationFromNeighbours(model, [c.region.loop, ...c.region.holes.map((h) => h.loop)], plane) ?? defaultNormal(plane));
    const flip = normal.dot(plane.normal) < 0;
    const outer = flip ? reverseLoop(c.region.loop) : c.region.loop;
    const holes = c.region.holes.map((h) => (flip ? reverseLoop(h.loop) : h.loop));

    if (id !== undefined && sameFace(model.face(id), outer, holes, normal)) {
      kept.add(id);
      continue;
    }
    // Every piece of a split face keeps its paint.
    kept.add(model.putFace({ id, outer, holes, normal, color: c.owner?.color }));
  }

  for (const face of oldFaces) if (!kept.has(face.id)) model.removeFace(face.id);
}

/**
 * Rebuilds faces in every plane a set of new edges could affect: planes of
 * existing faces that contain an edge, and planes spanned by an edge and a
 * neighbouring edge (where a new loop could close).
 */
export function updateFaces(model: Model, newEdges: Iterable<Id>): void {
  const created = new Set([...newEdges].filter((e) => model.hasEdge(e)));
  if (created.size === 0) return;

  const planes: Plane[] = [];
  const addPlane = (p: Plane) => {
    const c = canonicalPlane(p);
    if (!planes.some((q) => samePlane(q, c))) planes.push(c);
  };
  const facePlanes = model.allFaces().map((f) => model.facePlane(f));

  for (const id of created) {
    const edge = model.edge(id);
    const a = model.position(edge.a);
    const b = model.position(edge.b);
    for (const plane of facePlanes) if (onPlane(plane, a) && onPlane(plane, b)) addPlane(plane);
    for (const v of [edge.a, edge.b]) {
      for (const other of model.edgesAt(v)) {
        if (other === id) continue;
        const c = model.position(model.other(model.edge(other), v));
        const plane = planeFromPoints(a, b, c);
        if (plane) addPlane(plane);
      }
    }
  }

  for (const plane of planes) rebuildPlane(model, plane, created);
}
