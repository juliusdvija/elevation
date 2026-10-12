import * as THREE from 'three';
import type { Face, Id, Model } from './Model';
import { insertSegment } from './draw';
import { canonicalPlane, EPS, isParallel, planeFrame, pointInPolygon, samePlane, to2D, type Plane } from './math';
import { rebuildPlane, type RegionDecision } from './faces';

type Interval = [number, number];

/** Parameter intervals of an infinite line (point + t·dir) that lie inside a planar face. */
function lineInFace(model: Model, face: Face, point: THREE.Vector3, dir: THREE.Vector3): Interval[] {
  const frame = planeFrame(model.facePlane(face));
  const p0 = to2D(frame, point);
  const p1 = to2D(frame, point.clone().add(dir));
  const d = p1.clone().sub(p0);
  const loops = model.faceLoops(face).map((loop) => loop.map((v) => to2D(frame, model.position(v))));

  const ts: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const e = b.clone().sub(a);
      const denom = d.x * e.y - d.y * e.x;
      if (Math.abs(denom) < 1e-12) continue;
      const ap = a.clone().sub(p0);
      const t = (ap.x * e.y - ap.y * e.x) / denom;
      const s = (ap.x * d.y - ap.y * d.x) / denom;
      if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const result: Interval[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const [t0, t1] = [ts[i], ts[i + 1]];
    if (t1 - t0 < 1e-9) continue;
    const mid = p0.clone().addScaledVector(d, (t0 + t1) / 2);
    const inside = pointInPolygon(mid, loops[0]) && !loops.slice(1).some((h) => pointInPolygon(mid, h));
    if (!inside) continue;
    const last = result.at(-1);
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else result.push([t0, t1]);
  }
  return result;
}

/** Segments where two non-coplanar faces cross each other. */
export function faceIntersection(model: Model, f: Face, g: Face): [THREE.Vector3, THREE.Vector3][] {
  if (isParallel(f.normal, g.normal)) return [];
  const pf = model.facePlane(f);
  const pg = model.facePlane(g);
  const dir = new THREE.Vector3().crossVectors(pf.normal, pg.normal).normalize();
  // A point on both planes: solve in the plane spanned by the two normals.
  const n1 = pf.normal;
  const n2 = pg.normal;
  const dot = n1.dot(n2);
  const det = 1 - dot * dot;
  const c1 = (pf.d - pg.d * dot) / det;
  const c2 = (pg.d - pf.d * dot) / det;
  const point = n1.clone().multiplyScalar(c1).addScaledVector(n2, c2);

  const a = lineInFace(model, f, point, dir);
  const b = lineInFace(model, g, point, dir);
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const t0 = Math.max(a0, b0);
      const t1 = Math.min(a1, b1);
      if (t1 - t0 > EPS) segments.push([point.clone().addScaledVector(dir, t0), point.clone().addScaledVector(dir, t1)]);
    }
  }
  return segments;
}

function faceBox(model: Model, face: Face): THREE.Box3 {
  return new THREE.Box3().setFromPoints(model.faceLoops(face).flat().map((v) => model.position(v)));
}

/**
 * Intersects each face in `a` with each face in `b`: their crossing lines
 * become edges and both faces are split along them ("Intersect Faces").
 * Returns the faces of every plane that was rebuilt, plus the new edges.
 */
export function intersectFaces(
  model: Model,
  a: Iterable<Id>,
  b: Iterable<Id>,
  decide?: RegionDecision,
): { edges: Set<Id>; planes: Plane[] } {
  const aFaces = [...a].filter((id) => model.hasFace(id)).map((id) => model.face(id));
  const bFaces = [...b].filter((id) => model.hasFace(id)).map((id) => model.face(id));
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  const planes: Plane[] = [];
  const addPlane = (p: Plane) => {
    const c = canonicalPlane(p);
    if (!planes.some((q) => samePlane(q, c))) planes.push(c);
  };

  for (const f of aFaces) {
    const fb = faceBox(model, f).expandByScalar(EPS);
    for (const g of bFaces) {
      if (f.id === g.id || !fb.intersectsBox(faceBox(model, g))) continue;
      const found = faceIntersection(model, f, g);
      if (found.length === 0) continue;
      segments.push(...found);
      addPlane(model.facePlane(f));
      addPlane(model.facePlane(g));
    }
  }

  const edges = new Set<Id>();
  for (const [p, q] of segments) insertSegment(model, p, q, edges);
  for (const plane of planes) rebuildPlane(model, plane, new Set(), decide);
  return { edges, planes };
}
