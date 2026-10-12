import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges, weldVertices } from './cleanup';
import { insertSegment } from './draw';
import { coplanarSameSide, setFaceNormal, updateFaces } from './faces';
import { EPS, canonicalPlane, distanceToPlane, isParallel, isPerpendicular, planeFromPointNormal, samePlane } from './math';

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

/**
 * Whether the face lies on the surface of a solid: it, or a coplanar face
 * connected to it (e.g. the box top around a rectangle drawn on it), borders a
 * face in another plane.
 */
function isOnSolid(model: Model, face: Face): boolean {
  const seen = new Set<Id>([face.id]);
  const queue = [face];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const list of neighbours(model, current)) {
      for (const g of list) {
        if (!isParallel(g.normal, current.normal)) return true;
        if (!seen.has(g.id) && coplanarSameSide(model, g, current)) {
          seen.add(g.id);
          queue.push(g);
        }
      }
    }
  }
  return false;
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

  const survivors = weldVertices(model, vertices);
  const edges = new Set<Id>();
  for (const v of survivors) if (model.hasVertex(v)) for (const e of model.edgesAt(v)) edges.add(e);
  healEdges(model, edges);
  return true;
}

function extrude(model: Model, face: Face, distance: number): void {
  const n = face.normal.clone();
  const sign = Math.sign(distance);
  const offset = n.clone().multiplyScalar(distance);
  const loops = model.faceLoops(face).map((loop) => [...loop]);

  const attached = isOnSolid(model, face);

  // Side walls keyed by plane, with the direction that points out of the material.
  const sides = loops.flatMap((loop) =>
    loopPairs(loop).map(([a, b]) => {
      const A = model.position(a);
      const outward = model.position(b).clone().sub(A).cross(n).normalize();
      return { plane: canonicalPlane(planeFromPointNormal(A, outward)), outward };
    }),
  );

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

  const cap = attached ? n : n.clone().multiplyScalar(sign);
  const sideSign = !attached || distance > 0 ? 1 : -1;

  if (model.hasFace(face.id)) {
    if (attached) model.removeFace(face.id);
    else setFaceNormal(model, face.id, n.clone().multiplyScalar(-sign));
  }

  for (const f of model.allFaces()) {
    if (facesBefore.has(f.id)) continue;
    if (isParallel(f.normal, n)) {
      setFaceNormal(model, f.id, cap);
      continue;
    }
    const plane = model.facePlane(f);
    const side = sides.find((s) => samePlane(s.plane, plane));
    if (side) setFaceNormal(model, f.id, side.outward.clone().multiplyScalar(sideSign));
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
