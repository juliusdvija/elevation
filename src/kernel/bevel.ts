import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { drawPolygon } from './draw';
import { followMe } from './followMe';
import { insideTester } from './solid';
import { arcSegments } from './shapes';

export interface BevelOptions {
  /** Chamfer: the distance cut back along both faces. Fillet: the radius of the round. */
  size: number;
  /** A round (fillet) instead of a flat cut (chamfer). */
  round: boolean;
  /** Straight pieces of a round; by default one per 15 degrees. */
  segments?: number;
}

/** One edge's bevel: the profile at its start, and the path (start, end) it is swept along. */
export interface BevelCutter {
  profile: THREE.Vector3[];
  path: [THREE.Vector3, THREE.Vector3];
  /** Material is removed (a convex edge) rather than added (a concave one). */
  cutting: boolean;
}

/** The direction, in a face's plane and square to the edge, that points into the face from the edge. */
function inwardAcross(model: Model, face: Face, a: Id, b: Id, e: THREE.Vector3): THREE.Vector3 | null {
  for (const [index, loop] of model.faceLoops(face).entries()) {
    for (const [p, q] of loopPairs(loop)) {
      if ((p === a && q === b) || (p === b && q === a)) {
        const travel = p === a ? e : e.clone().negate();
        // Outlines run counter-clockwise about the normal (the face lies on their left), holes clockwise (on their right).
        const left = new THREE.Vector3().crossVectors(face.normal, travel).normalize();
        return index === 0 ? left : left.negate();
      }
    }
  }
  return null;
}

/**
 * Works out the cutter for bevelling an edge: null when it is not an edge between exactly two faces that
 * meet at an angle (flat edges and edges on three faces are left alone), or the size does not fit.
 */
export function bevelCutter(model: Model, edgeId: Id, options: BevelOptions, inside: (p: THREE.Vector3) => boolean): BevelCutter | null {
  if (!model.hasEdge(edgeId)) return null;
  const edge = model.edge(edgeId);
  const faces = model.facesOfEdge(edgeId).map((id) => model.face(id));
  if (faces.length !== 2 || faces[0].normal.dot(faces[1].normal) > 1 - 1e-6) return null;
  const A = model.position(edge.a).clone();
  const B = model.position(edge.b).clone();
  const length = A.distanceTo(B);
  if (length < 1e-6 || options.size <= 0) return null;
  const e = B.clone().sub(A).normalize();
  const t1 = inwardAcross(model, faces[0], edge.a, edge.b, e);
  const t2 = inwardAcross(model, faces[1], edge.a, edge.b, e);
  if (!t1 || !t2) return null;
  const cosTheta = THREE.MathUtils.clamp(t1.dot(t2), -1, 1);
  const theta = Math.acos(cosTheta); // the angle between the two faces, seen across the edge
  if (theta < 1e-3 || theta > Math.PI - 1e-3) return null;
  const bisector = t1.clone().add(t2).normalize();

  // The cut-back along each face: the distance itself for a chamfer, where a circle of that radius touches for a round.
  const setback = options.round ? options.size / Math.tan(theta / 2) : options.size;
  const profile: THREE.Vector3[] = [A.clone()];
  const a = A.clone().addScaledVector(t1, setback);
  const b = A.clone().addScaledVector(t2, setback);
  if (options.round) {
    const c = A.clone().addScaledVector(bisector, options.size / Math.sin(theta / 2));
    const v1 = a.clone().sub(c).normalize();
    const v2 = b.clone().sub(c).normalize();
    const sweep = Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1));
    const axis = new THREE.Vector3().crossVectors(v1, v2).normalize();
    const n = Math.max(2, options.segments ?? arcSegments(sweep));
    for (let k = 0; k <= n; k++) {
      const p = v1.clone().applyAxisAngle(axis, (sweep * k) / n).multiplyScalar(options.size).add(c);
      profile.push(p);
    }
    profile[1] = a;
    profile[profile.length - 1] = b;
  } else {
    profile.push(a, b);
  }

  // Convex edge: the sweep removes material (the profile lies in the wedge). Concave: it adds (the profile lies in air).
  const probe = A.clone().addScaledVector(e, length / 2).addScaledVector(bisector, Math.min(setback, options.size) * 0.1);
  const cutting = inside(probe);
  // A cut can run a little past both ends (harmless air) so slanted ends are cut clean; an addition stops at the ends.
  const over = cutting ? setback * 2 : 0;
  const start = A.clone().addScaledVector(e, -over);
  const end = B.clone().addScaledVector(e, over);
  const shift = start.clone().sub(A);
  return { profile: profile.map((p) => p.clone().add(shift)), path: [start, end], cutting };
}

/**
 * Chamfers or rounds edges: each becomes a small profile swept along the edge with Follow Me, so the
 * result fuses with the solid (cut away on convex edges, filled on concave ones). Edges that cannot be
 * bevelled are skipped. Returns how many were done.
 */
export function bevelEdges(model: Model, edgeIds: Iterable<Id>, options: BevelOptions): number {
  const inside = insideTester(model);
  // Work everything out from the model as it is now, before the first cut changes it.
  const cutters: BevelCutter[] = [];
  for (const id of edgeIds) {
    const cutter = bevelCutter(model, id, options, inside);
    if (cutter) cutters.push(cutter);
  }
  let done = 0;
  for (const cutter of cutters) {
    drawPolygon(model, cutter.profile);
    const profile = model.allFaces().find((f) => f.outer.length === cutter.profile.length && cutter.profile.every((p) => model.faceVertices(f).some((v) => model.position(v).distanceTo(p) < 1e-6)));
    if (!profile) continue;
    const path = cutter.path.map((p) => model.addVertex(p));
    const ok = followMe(model, profile.id, path, false);
    for (const v of path) if (model.hasVertex(v) && model.edgesAt(v).length === 0) model.removeVertex(v);
    if (ok) done++;
    else model.hasFace(profile.id) && model.removeFace(profile.id);
  }
  return done;
}
