import * as THREE from 'three';
import type { Id, Model } from './Model';
import { healEdges, removeBareEdges } from './cleanup';
import { closeOpenings, isClosed, isClosedExcept } from './close';
import { insertSegment } from './draw';
import { faceInteriorPoint, newellNormal, setFaceNormal, updateFaces } from './faces';
import { EPS, canonicalPlane, planeFrame, planeFromPointNormal, pointInPolygon, samePlane, to2D, type Plane } from './math';
import { booleanPass } from './pushPull';
import { insideTester, insideTesterOf } from './solid';

/** A face of the swept solid: its corners and the normal pointing out of the solid. */
export interface SweepPolygon {
  points: THREE.Vector3[];
  normal: THREE.Vector3;
}

/**
 * The faces of the solid made by carrying `profile` along `path`. Corners are mitred: the profile at a
 * path vertex lies in the plane that bisects the two segments there, and each ring is found by sliding
 * the previous one along its segment onto that plane, so every side face is flat. An open path gets
 * two caps (the profile itself at the start); a closed path joins back up with none. Null when the path
 * doubles back on itself, a segment is parallel to a mitre plane, or something has no length.
 */
export function sweepShell(profile: THREE.Vector3[], path: THREE.Vector3[], closed: boolean): SweepPolygon[] | null {
  const n = path.length;
  if (profile.length < 3 || n < 2 || (closed && n < 3)) return null;
  const segments = closed ? n : n - 1;
  const dirs: THREE.Vector3[] = [];
  for (let j = 0; j < segments; j++) {
    const d = path[(j + 1) % n].clone().sub(path[j]);
    if (d.length() < EPS) return null;
    dirs.push(d.normalize());
  }
  // The plane the profile lies in at vertex `j`: bisecting the segments around it, square to the path at an open end.
  const mitre = (j: number): THREE.Vector3 | null => {
    const before = closed ? dirs[(j - 1 + segments) % segments] : j > 0 ? dirs[j - 1] : null;
    const after = closed ? dirs[j % segments] : j < segments ? dirs[j] : null;
    if (!before) return after!.clone();
    if (!after) return before.clone();
    const m = before.clone().add(after);
    return m.length() < 1e-6 ? null : m.normalize();
  };

  const slide = (ring: THREE.Vector3[], j: number, to: number): THREE.Vector3[] | null => {
    const m = mitre(to % n);
    if (!m) return null;
    const along = dirs[j].dot(m);
    if (Math.abs(along) < 1e-6) return null;
    const vertex = path[to % n];
    return ring.map((q) => q.clone().addScaledVector(dirs[j], vertex.clone().sub(q).dot(m) / along));
  };

  let rings: THREE.Vector3[][] = [profile.map((p) => p.clone())];
  if (closed) {
    // The start ring must lie in the mitre plane of vertex 0: slide it there along the first segment.
    const m0 = mitre(0);
    if (!m0 || Math.abs(dirs[0].dot(m0)) < 1e-6) return null;
    rings = [profile.map((q) => q.clone().addScaledVector(dirs[0], path[0].clone().sub(q).dot(m0) / dirs[0].dot(m0)))];
  }
  for (let j = 0; j < segments; j++) {
    const next = slide(rings[j], j, j + 1);
    if (!next) return null;
    rings.push(next);
  }

  const m = profile.length;
  const polygons: THREE.Vector3[][] = [];
  for (let j = 0; j < segments; j++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      polygons.push([rings[j][k], rings[j][k2], rings[j + 1][k2], rings[j + 1][k]]);
    }
  }
  if (!closed) {
    polygons.push([...rings[0]].reverse(), [...rings[segments]]);
  }

  // One orientation for all of them: outward, by the sign of the enclosed volume.
  let volume = 0;
  for (const points of polygons) volume += newellNormal(points).dot(points[0]) / 6;
  const flip = volume < 0;
  return polygons
    .map((points) => (flip ? [...points].reverse() : points))
    .map((points) => ({ points, normal: newellNormal(points).normalize() }))
    .filter((polygon) => Number.isFinite(polygon.normal.x));
}

/**
 * Follow Me: sweeps a face (the profile) along a path of vertices and adds the result to the model.
 * The new solid fuses with what it touches (like a pulled face): a gutter or trim joins its wall, and a
 * profile that cuts into material cuts a groove. Returns false when nothing changed, or the sweep would
 * leave a closed solid open.
 */
export function followMe(model: Model, profileId: Id, path: Id[], closed: boolean): boolean {
  if (!model.hasFace(profileId)) return false;
  const profile = model.face(profileId);
  if (profile.holes.length > 0 || path.some((v) => !model.hasVertex(v))) return false;
  const wasClosed = isClosedExcept(model, model.faceEdges(profile));
  return (
    model.attempt(
      () => sweepInto(model, profile.id, path, closed, wasClosed),
      (changed) => !changed || !wasClosed || isClosed(model),
    ) ?? false
  );
}

function sweepInto(model: Model, profileId: Id, path: Id[], closed: boolean, wasClosed: boolean): boolean {
  const profile = model.face(profileId);
  const shell = sweepShell(
    profile.outer.map((v) => model.position(v)),
    path.map((v) => model.position(v)),
    closed,
  );
  if (!shell) return false;
  const first = model.position(path[1]).clone().sub(model.position(path[0]));

  // The solid as it was (a loose profile is no part of it), and whether the sweep cuts or adds.
  const loose = model.faceEdges(profile).some((e) => model.facesOfEdge(e).length === 1);
  const oldInside = insideTester(model, loose ? profile.id : undefined);
  const sample = faceInteriorPoint(model, profile);
  const cutting = sample !== null && oldInside(sample.clone().addScaledVector(first.clone().normalize(), first.length() / 2));
  const inShell = insideTesterOf(shell.flatMap((p) => fan(p.points)));

  // Faces that were there, to tell a stray new face from a piece of an old one.
  const wallsBefore = model.allFaces().map((f) => {
    const frame = planeFrame(model.facePlane(f));
    const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
    return { frame, outer: project(f.outer), holes: f.holes.map(project) };
  });
  const inOldFace = (p: THREE.Vector3) =>
    wallsBefore.some((w) => {
      if (Math.abs(w.frame.normal.dot(p) - w.frame.normal.dot(w.frame.origin)) > EPS) return false;
      const q = to2D(w.frame, p);
      return pointInPolygon(q, w.outer) && !w.holes.some((h) => pointInPolygon(q, h));
    });
  const looseBefore = new Set(model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 0).map((e) => e.id));

  // The profile is consumed by the sweep; its outline comes back as the first cap.
  model.removeFace(profile.id);
  const facesBefore = new Set(model.allFaces().map((f) => f.id));

  const created = new Set<Id>();
  for (const { points } of shell) {
    for (let i = 0; i < points.length; i++) insertSegment(model, points[i], points[(i + 1) % points.length], created);
  }
  updateFaces(model, created);

  // Where a face lies on the swept surface it faces away from the solid (into it when cutting).
  const frames = shell.map((s) => {
    const frame = planeFrame(planeFromPointNormal(s.points[0], s.normal));
    return { s, frame, flat: s.points.map((p) => to2D(frame, p)) };
  });
  let coincident = false;
  const onShell = (p: THREE.Vector3) => frames.find(({ s, frame, flat }) => Math.abs(s.normal.dot(p) - s.normal.dot(s.points[0])) < EPS && pointInPolygon(to2D(frame, p), flat));
  for (const f of model.allFaces()) {
    const inside = faceInteriorPoint(model, f);
    if (!inside) continue;
    const hit = onShell(inside);
    if (hit) {
      // An old face on the swept surface (a wall the sweep runs along) needs the boolean pass even if nothing crosses.
      if (facesBefore.has(f.id) || inOldFace(inside)) coincident = true;
      setFaceNormal(model, f.id, cutting ? hit.s.normal.clone().negate() : hit.s.normal);
    }
    else if (!facesBefore.has(f.id) && !inOldFace(inside)) model.removeFace(f.id); // a loop that closed by coincidence
  }

  const planes: Plane[] = [];
  for (const polygon of shell) {
    const plane = canonicalPlane(planeFromPointNormal(polygon.points[0], polygon.normal));
    if (!planes.some((q) => samePlane(q, plane))) planes.push(plane);
  }
  const affected = booleanPass(model, {
    sweep: (p) => !!onShell(p),
    inPrism: inShell,
    prismBox: new THREE.Box3().setFromPoints(shell.flatMap((s) => s.points)),
    planes,
    oldInside,
    cutting,
    force: coincident,
  });

  const edges = new Set<Id>(affected);
  for (const { points } of shell) {
    for (const p of points) {
      const v = model.findVertex(p);
      if (v !== undefined) for (const e of model.edgesAt(v)) edges.add(e);
    }
  }
  healEdges(model, edges);
  removeBareEdges(model, looseBefore);
  closeOpenings(model, wasClosed);
  return true;
}

/** A polygon as triangles (one flat list of points, three per triangle), also when it is concave. */
function fan(points: THREE.Vector3[]): THREE.Vector3[][] {
  if (points.length === 3) return [[...points]];
  const frame = planeFrame(planeFromPointNormal(points[0], newellNormal(points).normalize()));
  const flat = points.map((p) => to2D(frame, p));
  const out: THREE.Vector3[] = [];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) out.push(points[i], points[j], points[k]);
  return out.length > 0 ? [out] : [];
}

/**
 * Orders selected edges into a path of vertices. Open paths run from the end nearest `near` (the
 * profile); a closed loop starts at its vertex nearest `near`. Null when the edges do not form one
 * simple chain (a branch, or separate pieces).
 */
export function chainEdges(model: Model, edgeIds: Iterable<Id>, near: THREE.Vector3): { vertices: Id[]; closed: boolean } | null {
  const edges = [...edgeIds].filter((e) => model.hasEdge(e)).map((e) => model.edge(e));
  if (edges.length === 0) return null;
  const adjacent = new Map<Id, Id[]>();
  for (const e of edges) {
    for (const [a, b] of [[e.a, e.b], [e.b, e.a]] as const) (adjacent.get(a) ?? adjacent.set(a, []).get(a)!).push(b);
  }
  if ([...adjacent.values()].some((list) => list.length > 2)) return null;
  const ends = [...adjacent].filter(([, list]) => list.length === 1).map(([v]) => v);
  const closed = ends.length === 0;
  if (!closed && ends.length !== 2) return null;
  const distance = (v: Id) => model.position(v).distanceTo(near);
  const start = closed ? [...adjacent.keys()].sort((a, b) => distance(a) - distance(b))[0] : ends.sort((a, b) => distance(a) - distance(b))[0];
  const vertices = [start];
  let previous = -1;
  let current = start;
  while (vertices.length <= adjacent.size) {
    const next = adjacent.get(current)!.find((v) => v !== previous) ?? null;
    if (next === null || next === start) break;
    vertices.push(next);
    previous = current;
    current = next;
  }
  // Every selected edge must be on the one chain.
  if (vertices.length !== adjacent.size) return null;
  return { vertices, closed };
}
