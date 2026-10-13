import * as THREE from 'three';
import type { Model } from '../kernel/Model';
import { pointInPolygon } from '../kernel/math';
import type { ViewSetup } from './views';

/** Depth tolerance (mm): a face this close to an edge does not hide it. */
const DEPTH_EPS = 0.5;
const CUT_EPS = 1e-3;
/** Distance (mm) over which projected lines fade to the lightest weight. */
const FADE_DISTANCE = 12_000;

export interface DrawingLine {
  a: THREE.Vector2;
  b: THREE.Vector2;
  /** 0 = nearest projected geometry, 1 = farthest. */
  depth: number;
}

/** A computed 2D drawing in model millimetres (u right, v up). */
export interface Drawing {
  /** Closed section polygons, filled with the even-odd rule. */
  cutLoops: THREE.Vector2[][];
  /** Outline of the cut. */
  cutSegments: [THREE.Vector2, THREE.Vector2][];
  /** Visible projected edges beyond the cut. */
  lines: DrawingLine[];
  /** Colour fills, far to near (only when something is painted). */
  fills: DrawingFill[];
  bounds: THREE.Box2;
}

/** A face seen from the front: its outline (and holes) in drawing coordinates, and its paint (null = paper). */
export interface DrawingFill {
  loops: THREE.Vector2[][];
  color: string | null;
  /** Below 1 for glass. */
  opacity?: number;
}

type Interval = [number, number];

interface Occluder {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
  box: THREE.Box2;
  /** Depth of the face plane at (u, v): w = a·u + b·v + c. */
  a: number;
  b: number;
  c: number;
}

function toView(setup: ViewSetup, p: THREE.Vector3): THREE.Vector3 {
  const rel = new THREE.Vector3().subVectors(p, setup.origin);
  return new THREE.Vector3(rel.dot(setup.u), rel.dot(setup.v), rel.dot(setup.w));
}

/** Parameters in (0, 1) where segment ab crosses the polygon's edges. */
function crossings(a: THREE.Vector2, b: THREE.Vector2, polygon: THREE.Vector2[], out: number[]): void {
  const d = new THREE.Vector2().subVectors(b, a);
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const e = new THREE.Vector2().subVectors(q, p);
    const denom = d.x * e.y - d.y * e.x;
    if (Math.abs(denom) < 1e-12) continue;
    const ap = new THREE.Vector2().subVectors(p, a);
    const t = (ap.x * e.y - ap.y * e.x) / denom;
    const s = (ap.x * d.y - ap.y * d.x) / denom;
    if (t > 0 && t < 1 && s >= -1e-9 && s <= 1 + 1e-9) out.push(t);
  }
}

/** Parts of segment ab that lie inside a polygon with holes. */
function insideIntervals(a: THREE.Vector2, b: THREE.Vector2, o: Occluder): Interval[] {
  const ts = [0, 1];
  crossings(a, b, o.outer, ts);
  for (const h of o.holes) crossings(a, b, h, ts);
  ts.sort((x, y) => x - y);
  const result: Interval[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const [t0, t1] = [ts[i], ts[i + 1]];
    if (t1 - t0 < 1e-9) continue;
    const mid = a.clone().lerp(b, (t0 + t1) / 2);
    const inside = pointInPolygon(mid, o.outer) && !o.holes.some((h) => pointInPolygon(mid, h));
    if (!inside) continue;
    const last = result.at(-1);
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else result.push([t0, t1]);
  }
  return result;
}

/** Where a linear function f(t) = f0 + (f1 - f0)·t satisfies f(t) < 0, within [0, 1]. */
function negativeInterval(f0: number, f1: number): Interval | null {
  if (f0 < 0 && f1 < 0) return [0, 1];
  if (f0 >= 0 && f1 >= 0) return null;
  const root = f0 / (f0 - f1);
  return f0 < 0 ? [0, root] : [root, 1];
}

function intersect(a: Interval, b: Interval): Interval | null {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi - lo > 1e-9 ? [lo, hi] : null;
}

/** [0, 1] minus the union of `hidden`. */
function complement(hidden: Interval[]): Interval[] {
  hidden.sort((x, y) => x[0] - y[0]);
  const visible: Interval[] = [];
  let cursor = 0;
  for (const [lo, hi] of hidden) {
    if (lo > cursor + 1e-9) visible.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < 1 - 1e-9) visible.push([cursor, 1]);
  return visible;
}

function buildOccluders(model: Model, setup: ViewSetup): Occluder[] {
  const occluders: Occluder[] = [];
  for (const face of model.allFaces()) {
    // Glass hides nothing: the edges behind a pane are still drawn.
    if (face.opacity !== undefined && face.opacity < 1) continue;
    const n = new THREE.Vector3(face.normal.dot(setup.u), face.normal.dot(setup.v), face.normal.dot(setup.w));
    // Faces seen edge-on cover no area.
    if (Math.abs(n.z) < 1e-6) continue;
    const p0 = toView(setup, model.position(face.outer[0]));
    const project = (loop: readonly number[]) =>
      loop.map((id) => {
        const p = toView(setup, model.position(id));
        return new THREE.Vector2(p.x, p.y);
      });
    const outer = project(face.outer);
    occluders.push({
      outer,
      holes: face.holes.map(project),
      box: new THREE.Box2().setFromPoints(outer),
      a: -n.x / n.z,
      b: -n.y / n.z,
      c: p0.z + (n.x * p0.x + n.y * p0.y) / n.z,
    });
  }
  return occluders;
}

/** Keeps the part of a polygon (view coordinates) where `keep` holds, by walking its edges. */
function clipPolygon(points: THREE.Vector3[], inside: (p: THREE.Vector3) => number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const P = points[i];
    const Q = points[(i + 1) % points.length];
    const dp = inside(P);
    const dq = inside(Q);
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) out.push(P.clone().lerp(Q, dp / (dp - dq)));
  }
  return out;
}

/**
 * Painter's-algorithm fills: every face seen from some side, far to near, with
 * its paint when seen from its front. Faces in front of the cut are dropped and
 * faces across it are clipped (faces with holes across it are left out).
 * Empty when nothing is painted, so unpainted models draw as before.
 */
function buildFills(model: Model, setup: ViewSetup): DrawingFill[] {
  if (!model.allFaces().some((f) => f.color || f.opacity !== undefined)) return [];
  const items: { fill: DrawingFill; depth: number }[] = [];
  for (const face of model.allFaces()) {
    const n = new THREE.Vector3(face.normal.dot(setup.u), face.normal.dot(setup.v), face.normal.dot(setup.w));
    if (Math.abs(n.z) < 1e-6) continue;
    const loops = model.faceLoops(face).map((loop) => loop.map((id) => toView(setup, model.position(id))));
    let outer = loops[0];
    let holes = loops.slice(1);
    const cut = setup.cut;
    const limit = setup.depthLimit;
    const needsClip = (cut !== null && outer.some((p) => p.z < cut)) || (limit !== null && outer.some((p) => p.z > limit));
    if (needsClip) {
      if (holes.length > 0) continue;
      if (cut !== null) outer = clipPolygon(outer, (p) => p.z - cut);
      if (limit !== null) outer = clipPolygon(outer, (p) => limit - p.z);
      if (outer.length < 3) continue;
      holes = [];
    }
    const front = n.z < 0;
    items.push({
      depth: outer.reduce((sum, p) => sum + p.z, 0) / outer.length,
      fill: {
        loops: [outer, ...holes].map((loop) => loop.map((p) => new THREE.Vector2(p.x, p.y))),
        color: front ? face.color ?? null : null,
        ...(face.opacity !== undefined && face.opacity < 1 ? { opacity: face.opacity } : {}),
      },
    });
  }
  return items.sort((a, b) => b.depth - a.depth).map((i) => i.fill);
}

/** Visible pieces of every edge beyond the cut (hidden-line removal). */
function projectEdges(model: Model, setup: ViewSetup, occluders: Occluder[]) {
  const pieces: { a: THREE.Vector2; b: THREE.Vector2; w: number }[] = [];
  const cut = setup.cut;

  for (const edge of model.allEdges()) {
    let A = toView(setup, model.position(edge.a));
    let B = toView(setup, model.position(edge.b));

    if (cut !== null) {
      // Keep only the part beyond the cut plane.
      if (A.z < cut && B.z < cut) continue;
      if (A.z < cut) A = A.clone().lerp(B, (cut - A.z) / (B.z - A.z));
      else if (B.z < cut) B = B.clone().lerp(A, (cut - B.z) / (A.z - B.z));
    }
    const limit = setup.depthLimit;
    if (limit !== null) {
      // And nothing deeper than the view reaches (a plan stops at its floor).
      if (A.z > limit && B.z > limit) continue;
      if (A.z > limit) A = A.clone().lerp(B, (A.z - limit) / (A.z - B.z));
      else if (B.z > limit) B = B.clone().lerp(A, (B.z - limit) / (B.z - A.z));
    }

    const a2 = new THREE.Vector2(A.x, A.y);
    const b2 = new THREE.Vector2(B.x, B.y);
    if (a2.distanceTo(b2) < 0.01) continue;
    const box = new THREE.Box2().setFromPoints([a2, b2]);

    const hidden: Interval[] = [];
    for (const o of occluders) {
      if (!o.box.intersectsBox(box)) continue;
      const faceA = o.a * A.x + o.b * A.y + o.c;
      const faceB = o.a * B.x + o.b * B.y + o.c;
      // In front of the edge...
      let depth = negativeInterval(faceA - A.z + DEPTH_EPS, faceB - B.z + DEPTH_EPS);
      if (!depth) continue;
      // ...and not cut away.
      if (cut !== null) {
        const behindCut = negativeInterval(cut - faceA, cut - faceB);
        depth = behindCut && intersect(depth, behindCut);
        if (!depth) continue;
      }
      for (const inside of insideIntervals(a2, b2, o)) {
        const h = intersect(inside, depth);
        if (h) hidden.push(h);
      }
    }

    for (const [t0, t1] of complement(hidden)) {
      if (t1 - t0 < 1e-6) continue;
      const p = A.clone().lerp(B, t0);
      const q = A.clone().lerp(B, t1);
      pieces.push({ a: new THREE.Vector2(p.x, p.y), b: new THREE.Vector2(q.x, q.y), w: (p.z + q.z) / 2 });
    }
  }
  return pieces;
}

/** Segments where the cut plane slices through faces, in view coordinates. */
function cutFaces(model: Model, setup: ViewSetup, cut: number): [THREE.Vector2, THREE.Vector2][] {
  const segments: [THREE.Vector2, THREE.Vector2][] = [];
  for (const face of model.allFaces()) {
    // Direction of the intersection line within the face.
    const line = new THREE.Vector3().crossVectors(face.normal, setup.w);
    if (line.lengthSq() < 1e-12) continue;
    const lineView = new THREE.Vector2(line.dot(setup.u), line.dot(setup.v)).normalize();

    const hits: { t: number; p: THREE.Vector2 }[] = [];
    for (const loop of model.faceLoops(face)) {
      const pts = loop.map((id) => toView(setup, model.position(id)));
      for (let i = 0; i < pts.length; i++) {
        const P = pts[i];
        const Q = pts[(i + 1) % pts.length];
        // Points exactly on the plane count as beyond it (symbolic perturbation).
        const sp = P.z - cut >= -CUT_EPS;
        const sq = Q.z - cut >= -CUT_EPS;
        if (sp === sq) continue;
        const X = P.clone().lerp(Q, (cut - P.z) / (Q.z - P.z));
        const p = new THREE.Vector2(X.x, X.y);
        hits.push({ t: p.dot(lineView), p });
      }
    }
    hits.sort((x, y) => x.t - y.t);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i].p.distanceTo(hits[i + 1].p) > 1e-6) segments.push([hits[i].p, hits[i + 1].p]);
    }
  }
  return segments;
}

/** Chains cut segments into closed loops by matching endpoints. */
export function chainLoops(segments: [THREE.Vector2, THREE.Vector2][], eps = 0.01): THREE.Vector2[][] {
  const key = (p: THREE.Vector2) => `${Math.round(p.x / eps)},${Math.round(p.y / eps)}`;
  const at = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      at.set(k, [...(at.get(k) ?? []), i]);
    }
  });

  const used = new Set<number>();
  const loops: THREE.Vector2[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) continue;
    used.add(start);
    const loop = [segments[start][0]];
    let current = segments[start][1];
    const first = key(segments[start][0]);
    while (key(current) !== first) {
      loop.push(current);
      const next = (at.get(key(current)) ?? []).find((i) => !used.has(i));
      if (next === undefined) break;
      used.add(next);
      const [a, b] = segments[next];
      current = key(a) === key(current) ? b : a;
    }
    if (key(current) === first && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Merges overlapping collinear pieces so every stretch of line is drawn once,
 * at the depth of the nearest piece covering it.
 */
export function mergeCollinear(pieces: { a: THREE.Vector2; b: THREE.Vector2; w: number }[]) {
  const groups = new Map<string, { dir: THREE.Vector2; spans: { t0: number; t1: number; w: number }[]; normal: THREE.Vector2; offset: number }>();
  for (const p of pieces) {
    const dir = new THREE.Vector2().subVectors(p.b, p.a).normalize();
    // Canonical direction so opposite segments share a group.
    if (dir.x < -1e-9 || (Math.abs(dir.x) <= 1e-9 && dir.y < 0)) dir.negate();
    const normal = new THREE.Vector2(-dir.y, dir.x);
    const offset = normal.dot(p.a);
    const key = `${Math.round(Math.atan2(dir.y, dir.x) * 1e5)}:${Math.round(offset * 100)}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { dir, normal, offset, spans: [] }));
    const ta = group.dir.dot(p.a);
    const tb = group.dir.dot(p.b);
    group.spans.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb), w: p.w });
  }

  const merged: { a: THREE.Vector2; b: THREE.Vector2; w: number }[] = [];
  for (const { dir, normal, offset, spans } of groups.values()) {
    const cuts = [...new Set(spans.flatMap((s) => [s.t0, s.t1]))].sort((x, y) => x - y);
    let open: { t0: number; t1: number; w: number } | null = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [t0, t1] = [cuts[i], cuts[i + 1]];
      const mid = (t0 + t1) / 2;
      let w = Infinity;
      for (const s of spans) if (s.t0 <= mid && mid <= s.t1) w = Math.min(w, s.w);
      if (w === Infinity) {
        if (open) merged.push(toPiece(open));
        open = null;
      } else if (open && Math.abs(open.w - w) < 1e-6 && Math.abs(open.t1 - t0) < 1e-9) {
        open.t1 = t1;
      } else {
        if (open) merged.push(toPiece(open));
        open = { t0, t1, w };
      }
    }
    if (open) merged.push(toPiece(open));

    function toPiece(span: { t0: number; t1: number; w: number }) {
      const base = normal.clone().multiplyScalar(offset);
      return { a: base.clone().addScaledVector(dir, span.t0), b: base.clone().addScaledVector(dir, span.t1), w: span.w };
    }
  }
  return merged;
}

/** Computes a hidden-line vector drawing of the model for one view. */
export function computeDrawing(model: Model, setup: ViewSetup): Drawing {
  const occluders = buildOccluders(model, setup);
  const pieces = mergeCollinear(projectEdges(model, setup, occluders));
  const cutSegments = setup.cut === null ? [] : cutFaces(model, setup, setup.cut);

  const bounds = new THREE.Box2();
  for (const p of pieces) bounds.expandByPoint(p.a).expandByPoint(p.b);
  for (const [a, b] of cutSegments) bounds.expandByPoint(a).expandByPoint(b);

  // Depth cueing: lines fade with distance behind the cut (or the nearest
  // line), over a fixed distance so a small projection does not wash out the
  // facade behind it.
  let near = setup.cut ?? Infinity;
  if (setup.cut === null) for (const p of pieces) near = Math.min(near, p.w);

  return {
    fills: buildFills(model, setup),
    cutLoops: chainLoops(cutSegments),
    cutSegments,
    lines: pieces.map((p) => ({ a: p.a, b: p.b, depth: THREE.MathUtils.clamp((p.w - near) / FADE_DISTANCE, 0, 1) })),
    bounds,
  };
}
