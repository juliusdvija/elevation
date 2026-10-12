import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges } from './cleanup';
import { settle } from './transform';
import { insertSegment } from './draw';
import { faceInteriorPoint, setFaceNormal, updateFaces } from './faces';
import { pointInsideSolid } from './solid';
import { EPS, canonicalPlane, planeFrame, pointInPolygon, to2D, distanceToPlane, isParallel, isPerpendicular, planeFromPointNormal, samePlane } from './math';

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
  for (const v of vertices) model.moveVertex(v, model.position(v).clone().add(offset));

  settle(model, vertices);
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

  // Side walls keyed by plane, with the direction that points out of the material.
  const sides = loops.flatMap((loop) =>
    loopPairs(loop).map(([a, b]) => {
      const A = model.position(a);
      const outward = model.position(b).clone().sub(A).cross(n).normalize();
      return { plane: canonicalPlane(planeFromPointNormal(A, outward)), outward };
    }),
  );

  // Existing faces in the side-wall planes, to spot walls built against them.
  const wallsBefore = model
    .allFaces()
    .filter((f) => sides.some((side) => samePlane(side.plane, model.facePlane(f))))
    .map((f) => {
      const frame = planeFrame(model.facePlane(f));
      const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
      return { normal: f.normal.clone(), frame, outer: project(f.outer), holes: f.holes.map(project) };
    });
  const againstWall = (p: THREE.Vector3, normal: THREE.Vector3) =>
    wallsBefore.some((w) => {
      if (w.normal.dot(normal) > -0.5 || Math.abs(w.frame.normal.dot(p) - w.frame.normal.dot(w.frame.origin)) > EPS) return false;
      const q = to2D(w.frame, p);
      return pointInPolygon(q, w.outer) && !w.holes.some((h) => pointInPolygon(q, h));
    });

  const facesBefore = new Set(model.allFaces().map((f) => f.id));
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
    if (facesBefore.has(f.id)) continue;
    if (isParallel(f.normal, n)) {
      setFaceNormal(model, f.id, cap);
      continue;
    }
    const plane = model.facePlane(f);
    const side = sides.find((s) => samePlane(s.plane, plane));
    if (!side) continue;
    const desired = side.outward.clone().multiplyScalar(sideSign);
    // A new wall facing an existing wall back to back is internal: drop it.
    const inside = faceInteriorPoint(model, f);
    if (inside && againstWall(inside, desired)) model.removeFace(f.id);
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
}

/** Signed distance along `face`'s normal from its plane to `point`. */
export function distanceAlongNormal(model: Model, face: Face, point: THREE.Vector3): number {
  return distanceToPlane(model.facePlane(face), point);
}
