import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges, removeBareEdges } from './cleanup';
import { settle } from './transform';
import { insertSegment } from './draw';
import { faceInteriorPoint, setFaceNormal, updateFaces } from './faces';
import { pointInsideSolid } from './solid';
import { EPS, canonicalPlane, planeFrame, pointInPolygon, projectOnSegment, to2D, distanceToPlane, isParallel, isPerpendicular, planeFromPointNormal, samePlane } from './math';

/**
 * Push/Pull a face by `distance` along its normal (negative pushes in).
 *
 * When every side of the face is a wall standing square on it (a box top),
 * the face just moves and the walls stretch. Otherwise new geometry is
 * extruded: a free-standing face becomes a solid, a face on a solid adds a
 * bump (pull) or cuts a recess (push). Returns false when nothing changed.
 */
export function pushPull(model: Model, faceId: Id, distance: number): boolean {
  if (Math.abs(distance) < EPS || !model.hasFace(faceId)) return false;
  const face = model.face(faceId);
  if (canMoveFace(model, face)) return moveFace(model, face, distance);
  extrude(model, face, distance);
  return true;
}

/** Other faces on the face's boundary edges, per edge. */
function neighbours(model: Model, face: Face): Face[][] {
  return model.faceEdges(face).map((e) =>
    model
      .facesOfEdge(e)
      .filter((f) => f !== face.id)
      .map((f) => model.face(f)),
  );
}

function canMoveFace(model: Model, face: Face): boolean {
  if (neighbours(model, face).some((list) => list.length === 0)) return false;
  for (const v of model.faceVertices(face)) {
    for (const f of model.facesAtVertex(v)) {
      if (f !== face.id && !isPerpendicular(model.face(f).normal, face.normal)) return false;
    }
  }
  return true;
}

function moveFace(model: Model, face: Face, distance: number): boolean {
  const plane = model.facePlane(face);
  const vertices = model.faceVertices(face);

  if (distance < 0) {
    // Walls must not turn inside out: stop at the nearest wall vertex behind the face.
    let limit = Infinity;
    for (const v of vertices) {
      for (const f of model.facesAtVertex(v)) {
        if (f === face.id) continue;
        for (const w of model.faceVertices(model.face(f))) {
          const depth = -distanceToPlane(plane, model.position(w));
          if (depth > EPS) limit = Math.min(limit, depth);
        }
      }
    }
    if (-distance > limit + EPS) return false;
    if (Math.abs(-distance - limit) < EPS) distance = -limit;
  }

  const offset = face.normal.clone().multiplyScalar(distance);
  const looseBefore = new Set(model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 0).map((e) => e.id));
  for (const v of vertices) model.moveVertex(v, model.position(v).clone().add(offset));

  settle(model, vertices);
  // Pushing a face onto the opposite one removes the volume: drop its bare outline.
  removeBareEdges(model, looseBefore);
  return true;
}

function extrude(model: Model, face: Face, distance: number): void {
  const n = face.normal.clone();
  const sign = Math.sign(distance);
  const offset = n.clone().multiplyScalar(distance);
  const loops = model.faceLoops(face).map((loop) => [...loop]);

  // Probe for material just ahead of and behind the face, along the travel direction.
  const dir = n.clone().multiplyScalar(sign);
  const sample = faceInteriorPoint(model, face);
  const ahead = sample !== null && pointInsideSolid(model, sample.clone().addScaledVector(dir, 1));
  const behind = sample !== null && pointInsideSolid(model, sample.clone().addScaledVector(dir, -1));
  // Moving into material cuts a recess; otherwise material is added.
  const cutting = ahead;

  // Side walls: each base edge sweeps a quad; `outward` points out of the material.
  const sides = loops.flatMap((loop) =>
    loopPairs(loop).map(([a, b]) => {
      const A = model.position(a).clone();
      const B = model.position(b).clone();
      const outward = B.clone().sub(A).cross(n).normalize();
      return { plane: canonicalPlane(planeFromPointNormal(A, outward)), outward, A, B };
    }),
  );
  // The base outline, to recognise the cap (the base moved by `offset`) by position.
  const baseFrame = planeFrame(model.facePlane(face));
  const baseOuter = face.outer.map((v) => to2D(baseFrame, model.position(v)));
  const baseHoles = face.holes.map((h) => h.map((v) => to2D(baseFrame, model.position(v))));
  const capPlaneD = n.dot(model.position(face.outer[0])) + distance;
  const inCap = (p: THREE.Vector3) => {
    if (Math.abs(n.dot(p) - capPlaneD) > EPS) return false;
    const q = to2D(baseFrame, p.clone().sub(offset));
    return pointInPolygon(q, baseOuter) && !baseHoles.some((h) => pointInPolygon(q, h));
  };

  /** The side whose swept quad contains `p` (strictly between base and cap). */
  const sideContaining = (p: THREE.Vector3) =>
    sides.find((side) => {
      if (Math.abs(side.outward.dot(p) - side.outward.dot(side.A)) > EPS) return false;
      const t = p.clone().sub(side.A).dot(n) / distance;
      if (t <= 1e-6 || t >= 1 - 1e-6) return false;
      const base = p.clone().addScaledVector(n, -distance * t);
      const { t: along, distance: off } = projectOnSegment(base, side.A, side.B);
      return off < EPS && along > 0 && along < 1;
    });

  // Existing faces in the side-wall planes, to spot walls built against them.
  const wallsBefore = model
    .allFaces()
    .filter((f) => sides.some((side) => samePlane(side.plane, model.facePlane(f))))
    .map((f) => {
      const frame = planeFrame(model.facePlane(f));
      const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
      return { normal: f.normal.clone(), frame, outer: project(f.outer), holes: f.holes.map(project) };
    });
  const inWallBefore = (p: THREE.Vector3, accept: (normal: THREE.Vector3) => boolean) =>
    wallsBefore.some((w) => {
      if (!accept(w.normal) || Math.abs(w.frame.normal.dot(p) - w.frame.normal.dot(w.frame.origin)) > EPS) return false;
      const q = to2D(w.frame, p);
      return pointInPolygon(q, w.outer) && !w.holes.some((h) => pointInPolygon(q, h));
    });
  const againstWall = (p: THREE.Vector3, normal: THREE.Vector3) => inWallBefore(p, (w) => w.dot(normal) < -0.5);

  const facesBefore = new Set(model.allFaces().map((f) => f.id));
  const looseBefore = new Set(model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 0).map((e) => e.id));
  const created = new Set<Id>();
  const base = loops.map((loop) => loop.map((v) => model.position(v).clone()));

  for (const loop of base) {
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      insertSegment(model, p, p.clone().add(offset), created);
      insertSegment(model, p.clone().add(offset), q.clone().add(offset), created);
    }
  }
  updateFaces(model, created);

  // New faces point away from material: out of an added block, into a cut recess.
  const cap = cutting ? dir.clone().negate() : dir;
  const sideSign = cutting ? -1 : 1;

  // The original face becomes an opening (cut) or an internal face (bump on a
  // solid); a free-standing face stays as the base of the new block.
  if (model.hasFace(face.id)) {
    if (ahead || behind) model.removeFace(face.id);
    else setFaceNormal(model, face.id, dir.clone().negate());
  }

  for (const f of model.allFaces()) {
    const inside = faceInteriorPoint(model, f);
    if (!inside) continue;
    if (isParallel(f.normal, n)) {
      if (!inCap(inside)) {
        // The cap's holes close into loops of new edges; those are openings, not faces.
        const inCapPlane = Math.abs(n.dot(inside) - capPlaneD) < EPS;
        if (inCapPlane && !facesBefore.has(f.id)) model.removeFace(f.id);
        continue;
      }
      // A cap landing back to back on an existing face (pushing right through,
      // or onto another solid) leaves nothing there.
      if (facesBefore.has(f.id) && f.normal.dot(cap) < 0) model.removeFace(f.id);
      else setFaceNormal(model, f.id, cap);
      continue;
    }
    // Faces inside the swept sides, found by position (rebuilt planes may
    // have handed them old ids).
    const side = sideContaining(inside);
    if (!side) {
      // A new face that is neither a side, the cap, nor part of a face that
      // was already there is a loop that closed by coincidence (e.g. across
      // the mouth of an opening): drop it.
      if (!facesBefore.has(f.id) && !inWallBefore(inside, () => true)) model.removeFace(f.id);
      continue;
    }
    const desired = side.outward.clone().multiplyScalar(sideSign);
    // A side built back to back against an existing wall is internal: the
    // shared region goes, from both.
    if (againstWall(inside, desired)) model.removeFace(f.id);
    else setFaceNormal(model, f.id, desired);
  }

  // Merge new walls that continue an existing coplanar wall.
  const edges = new Set<Id>();
  for (const loop of base) {
    for (const p of loop) {
      for (const point of [p, p.clone().add(offset)]) {
        const v = model.findVertex(point);
        if (v !== undefined) for (const e of model.edgesAt(v)) edges.add(e);
      }
    }
  }
  healEdges(model, edges);
  removeBareEdges(model, looseBefore);
}

/** Signed distance along `face`'s normal from its plane to `point`. */
export function distanceAlongNormal(model: Model, face: Face, point: THREE.Vector3): number {
  return distanceToPlane(model.facePlane(face), point);
}
