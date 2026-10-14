import * as THREE from 'three';
import type { Id } from './Model';
import { Model } from './Model';
import { healEdges, removeBareEdges, splitTJunctions } from './cleanup';
import { EPS, canonicalPlane, planeFrame, planeFromPointNormal, pointInPolygon, samePlane, to2D, type Plane } from './math';
import { booleanPass } from './pushPull';
import { insideTester } from './solid';

export type SolidOp = 'union' | 'subtract' | 'intersect';

/** Copies a model's geometry into another, sharing vertices and edges that sit at the same place. */
function appendWelded(target: Model, source: Model): void {
  const map = new Map<Id, Id>();
  const vertex = (id: Id): Id => {
    let v = map.get(id);
    if (v === undefined) {
      const p = source.position(id);
      v = target.findVertex(p) ?? target.addVertex(p.clone());
      map.set(id, v);
    }
    return v;
  };
  for (const e of source.allEdges()) {
    const a = vertex(e.a);
    const b = vertex(e.b);
    if (a !== b && target.edgeBetween(a, b) === undefined) target.addEdge(a, b);
  }
  for (const f of source.allFaces()) {
    target.putFace({ outer: f.outer.map(vertex), holes: f.holes.map((h) => h.map(vertex)), normal: f.normal, color: f.color, opacity: f.opacity, hatch: f.hatch, material: f.material });
  }
}

/**
 * Combines two closed solids (given in one coordinate system) into a new model: everything either holds
 * (`union`), what the first holds and the second does not (`subtract`), or what both hold (`intersect`).
 * Where the surfaces cross, new edges are made; faces are kept, flipped or dropped according to where
 * the material is, so the result is a proper closed solid (or several; or none).
 */
export function combineSolids(a: Model, b: Model, op: SolidOp): Model {
  const inA = insideTester(a);
  const inB = insideTester(b);
  const boxOf = (m: Model) => new THREE.Box3().setFromPoints(m.allVertices().map((v) => v.position));
  const boxA = boxOf(a);
  const boxB = boxOf(b);

  // The second solid's faces, to tell which faces of the combined model lie on its surface.
  const surface = b.allFaces().map((f) => {
    const plane = planeFromPointNormal(b.position(f.outer[0]), f.normal);
    const frame = planeFrame(plane);
    const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, b.position(v)));
    const outer = project(f.outer);
    return { normal: plane.normal, d: plane.d, frame, outer, holes: f.holes.map(project) };
  });
  const onB = (p: THREE.Vector3) =>
    surface.some((s) => {
      if (Math.abs(s.normal.dot(p) - s.d) > EPS) return false;
      const q = to2D(s.frame, p);
      return pointInPolygon(q, s.outer) && !s.holes.some((h) => pointInPolygon(q, h));
    });
  const planes: Plane[] = [];
  for (const f of b.allFaces()) {
    const plane = canonicalPlane(planeFromPointNormal(b.position(f.outer[0]), f.normal));
    if (!planes.some((q) => samePlane(q, plane))) planes.push(plane);
  }

  const material =
    op === 'union' ? (p: THREE.Vector3) => inA(p) || inB(p) : op === 'subtract' ? (p: THREE.Vector3) => inA(p) && !inB(p) : (p: THREE.Vector3) => inA(p) && inB(p);

  const work = new Model();
  work.edit(() => {
    appendWelded(work, a);
    appendWelded(work, b);
    // One solid's vertex may sit on the other's edge.
    splitTJunctions(work);
    const prismBox = op === 'intersect' ? boxA.clone().union(boxB) : boxB.clone();
    const affected = booleanPass(work, { sweep: onB, inPrism: inB, prismBox, planes, oldInside: inA, cutting: false, force: true, material });
    healEdges(work, [...affected, ...work.allEdges().map((e) => e.id)]);
    removeBareEdges(work, new Set());
    for (const v of work.allVertices()) if (work.edgesAt(v.id).length === 0) work.removeVertex(v.id);
  });
  return work;
}
