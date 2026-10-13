import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { loopPairs } from './Model';
import { healEdges, removeBareEdges } from './cleanup';
import { settle } from './transform';
import { closeOpenings, isClosed, isClosedExcept } from './close';
import { insertSegment } from './draw';
import { faceInteriorPoint, rebuildPlane, setFaceNormal, updateFaces, type RegionDecision } from './faces';
import { insideTester } from './solid';
import { intersectFaces } from './intersect';
import { EPS, canonicalPlane, planeFrame, pointInPolygon, projectOnSegment, to2D, distanceToPlane, isParallel, isPerpendicular, planeFromPointNormal, samePlane, type Plane } from './math';

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
  const wasClosed = isClosedExcept(model, model.faceEdges(model.face(faceId)));
  // A solid must stay a solid: if the edit leaves it open even after capping, refuse it.
  return model.attempt(
    () => {
      const changed = pushPullFace(model, faceId, distance, wasClosed);
      return changed;
    },
    (changed) => !changed || !wasClosed || isClosed(model),
  ) ?? false;
}

function pushPullFace(model: Model, faceId: Id, distance: number, wasClosed: boolean): boolean {
  const face = model.face(faceId);
  let changed = true;
  if (canMoveFace(model, face) && !passesNeighbourVertex(model, face, distance) && !sweepMeetsOtherGeometry(model, face, distance)) changed = moveFace(model, face, distance);
  else extrude(model, face, distance);
  // Whatever stood on the swept face is left open at the cut: put its cap back.
  if (changed) closeOpenings(model, wasClosed);
  return changed;
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
 * Whether sweeping the face over `distance` would run into geometry that is
 * not attached to it. Then the face is extruded (with the boolean pass)
 * rather than just moved.
 */
function sweepMeetsOtherGeometry(model: Model, face: Face, distance: number): boolean {
  const offset = face.normal.clone().multiplyScalar(distance);
  const points = model.faceVertices(face).map((v) => model.position(v));
  const box = new THREE.Box3().setFromPoints([...points, ...points.map((p) => p.clone().add(offset))]).expandByScalar(-EPS);
  const own = new Set<Id>([face.id]);
  for (const v of model.faceVertices(face)) for (const f of model.facesAtVertex(v)) own.add(f);
  return model.allFaces().some((f) => {
    if (own.has(f.id)) return false;
    return box.intersectsBox(new THREE.Box3().setFromPoints(model.faceLoops(f).flat().map((v) => model.position(v))));
  });
}

/**
 * Whether moving the face forward by `distance` would carry one of its vertices past a
 * vertex of an attached face (a wall standing ahead of it, or another solid's face meeting
 * it at an edge): that edge would flip over, so the move needs the boolean extrusion.
 */
function passesNeighbourVertex(model: Model, face: Face, distance: number): boolean {
  if (distance <= 0) return false; // pushing back stops at the nearest wall vertex instead
  const plane = model.facePlane(face);
  for (const v of model.faceVertices(face)) {
    for (const f of model.facesAtVertex(v)) {
      if (f === face.id) continue;
      for (const w of model.faceVertices(model.face(f))) {
        const ahead = distanceToPlane(plane, model.position(w));
        if (ahead > EPS && ahead < distance - EPS) return true;
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
  // The solid as it was, for classifying faces after the edit.
  // A face with an open rim (a footprint drawn beside a solid) is no part of the solid.
  const loose = model.faceEdges(face).some((e) => model.facesOfEdge(e).length === 1);
  const oldInside = insideTester(model, loose ? face.id : undefined);
  const ahead = sample !== null && oldInside(sample.clone().addScaledVector(dir, PROBE * 2));
  const behind = sample !== null && oldInside(sample.clone().addScaledVector(dir, -PROBE * 2));
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

  // Faces already in the cap's plane facing the other way: a cap landing on one of them
  // (pushing right through a wall) is back to back with it, even where splitting gave the
  // piece a new id.
  const capNormal = cutting ? dir.clone().negate() : dir;
  const opposedBefore = model
    .allFaces()
    .filter((f) => isParallel(f.normal, n) && f.normal.dot(capNormal) < 0 && Math.abs(n.dot(model.position(f.outer[0])) - capPlaneD) < EPS)
    .map((f) => {
      const frame = planeFrame(model.facePlane(f));
      const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
      return { frame, outer: project(f.outer), holes: f.holes.map(project) };
    });
  const backToBack = (p: THREE.Vector3) =>
    opposedBefore.some((w) => {
      const q = to2D(w.frame, p);
      return pointInPolygon(q, w.outer) && !w.holes.some((h) => pointInPolygon(q, h));
    });

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
      if ((facesBefore.has(f.id) && f.normal.dot(cap) < 0) || backToBack(inside)) model.removeFace(f.id);
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

  // Where the sweep runs into other geometry, intersect and keep only true boundaries.
  const affected = booleanPass(model, {
    sweep: (p) => !!sideContaining(p) || inCap(p),
    inPrism: (p) => {
      const t = p.clone().sub(model.position(face.outer[0]).clone()).dot(n) / distance;
      if (Math.abs(n.dot(p) - n.dot(base[0][0])) < EPS || t <= 0 || t >= 1) return false;
      const q = to2D(baseFrame, p.clone().addScaledVector(n, -distance * t));
      return pointInPolygon(q, baseOuter) && !baseHoles.some((h) => pointInPolygon(q, h));
    },
    prismBox: new THREE.Box3().setFromPoints(base.flat().flatMap((p) => [p, p.clone().add(offset)])),
    planes: [
      ...sides.map((side) => side.plane),
      canonicalPlane(planeFromPointNormal(base[0][0].clone().add(offset), n)),
      canonicalPlane(planeFromPointNormal(base[0][0], n)),
    ],
    oldInside,
    cutting,
  });

  // The new walls and cap carry the paint of the face that was pulled.
  if (face.color || face.hatch) {
    for (const f of model.allFaces()) {
      if (facesBefore.has(f.id) || f.color || f.hatch) continue;
      const inside = faceInteriorPoint(model, f);
      if (inside && (sideContaining(inside) || inCap(inside))) model.putFace({ ...f, color: face.color, opacity: face.opacity, hatch: face.hatch });
    }
  }

  // Merge new walls that continue an existing coplanar wall.
  const edges = new Set<Id>(affected);
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

/** How far (mm) off a face to test for material on each side: far above the tolerance, far below any feature of a small part. */
export const PROBE = 0.02;

/**
 * Makes a push/pull a proper boolean when its sweep meets other geometry:
 * intersects the swept faces with the faces they cross, then keeps a face
 * only where it separates material (behind) from empty space (in front),
 * flipping or dropping the rest. Material is the old solid plus the prism
 * (adding) or minus it (cutting). Returns edges worth healing.
 */
export function booleanPass(
  model: Model,
  opts: {
    sweep: (p: THREE.Vector3) => boolean;
    inPrism: (p: THREE.Vector3) => boolean;
    prismBox: THREE.Box3;
    planes: Plane[];
    oldInside: (p: THREE.Vector3) => boolean;
    cutting: boolean;
    /** Rebuild the planes even when the sweep crosses nothing (it may only coincide with existing faces). */
    force?: boolean;
    /** Where there is material in the result, when it is not simply the old solid plus or minus the prism (solid tools). */
    material?: (p: THREE.Vector3) => boolean;
  },
): Set<Id> {
  const { sweep, inPrism, prismBox, oldInside, cutting } = opts;
  const box = prismBox.clone().expandByScalar(EPS * 10);
  const boxOf = (f: Face) => new THREE.Box3().setFromPoints(model.faceLoops(f).flat().map((v) => model.position(v)));
  const sweepFaces: Id[] = [];
  const others: Id[] = [];
  for (const f of model.allFaces()) {
    if (!box.intersectsBox(boxOf(f))) continue;
    const p = faceInteriorPoint(model, f);
    if (p && sweep(p)) sweepFaces.push(f.id);
    else others.push(f.id);
  }

  const material = opts.material ?? ((p: THREE.Vector3) => (cutting ? oldInside(p) && !inPrism(p) : oldInside(p) || inPrism(p)));
  /**
   * Whether a face belongs at `p`: where material ends there must be one,
   * pointing away from it; where the old solid had a boundary that is now
   * inside or outside, none; anything else (loose faces) keeps the default.
   */
  const decide: RegionDecision = (p, normal) => {
    if (!box.containsPoint(p)) return undefined;
    const front = p.clone().addScaledVector(normal, PROBE);
    const back = p.clone().addScaledVector(normal, -PROBE);
    const behind = material(back);
    if (behind !== material(front)) return behind ? normal.clone() : normal.clone().negate();
    // No boundary here now: drop faces the sweep made, and old boundaries
    // that ended up inside or outside; leave loose faces alone.
    if (sweep(p) || inPrism(p) || oldInside(back) !== oldInside(front)) return null;
    return undefined;
  };

  const swallowed = model.allVertices().some((v) => inPrism(v.position));
  const { edges, planes: cutPlanes } = intersectFaces(model, sweepFaces, others, decide);
  if (edges.size === 0 && !swallowed && !opts.force) return new Set();

  // Recompute the faces of every plane the sweep touches from the material.
  const done = [...cutPlanes];
  for (const plane of opts.planes) {
    if (done.some((q) => samePlane(q, plane))) continue;
    done.push(plane);
    rebuildPlane(model, plane, new Set(), decide);
  }

  // Faces in other planes: keep, flip or drop by the same rule.
  const affected = new Set<Id>(edges);
  for (const f of model.allFaces()) {
    if (!box.intersectsBox(boxOf(f))) continue;
    const p = faceInteriorPoint(model, f);
    if (!p) continue;
    const verdict = decide(p, f.normal);
    if (verdict === undefined) continue;
    if (verdict === null) {
      for (const e of model.faceEdges(f)) affected.add(e);
      model.removeFace(f.id);
    } else if (verdict.dot(f.normal) < 0) {
      setFaceNormal(model, f.id, verdict);
    }
  }
  for (const f of model.allFaces()) if (box.intersectsBox(boxOf(f))) for (const e of model.faceEdges(f)) affected.add(e);
  return affected;
}

/** Signed distance along `face`'s normal from its plane to `point`. */
export function distanceAlongNormal(model: Model, face: Face, point: THREE.Vector3): number {
  return distanceToPlane(model.facePlane(face), point);
}
