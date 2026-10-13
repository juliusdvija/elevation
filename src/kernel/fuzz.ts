import * as THREE from 'three';
import { Model } from './Model';
import { drawPolygon, drawSegments } from './draw';
import { eraseEdges, eraseFaces, paintFaces } from './cleanup';
import { pushPull } from './pushPull';
import { copyEntities, transformVertices, verticesOf } from './transform';
import { circlePoints, offsetHolds, offsetPolygon } from './shapes';
import { faceArea, faceContainsPoint, faceInteriorPoint } from './faces';
import { planeFrame } from './math';
import { selfIntersections, snapshot, validateModel, type Problem } from './validate';
import { computeDrawing } from '../drawing/project';
import { viewSetup } from '../drawing/views';
import { DEFAULT_SETTINGS, allViews } from '../drawing/settings';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(list: T[]): T | undefined => (list.length ? list[Math.floor(next() * list.length)] : undefined),
    /** A multiple of `step` in [lo, hi]. */
    grid: (lo: number, hi: number, step: number) => step * (Math.floor(lo / step) + Math.floor(next() * (Math.floor(hi / step) - Math.floor(lo / step) + 1))),
  };
}

type Rng = ReturnType<typeof rng>;
const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];

interface Op {
  name: string;
  run: (model: Model, r: Rng) => string | null; // description, or null when not applicable
}

/** A rectangle inside (or overlapping) a face, in the face's plane. */
function rectOnFace(model: Model, r: Rng): string | null {
  const face = r.pick(model.allFaces());
  if (!face) return null;
  const center = faceInteriorPoint(model, face);
  if (!center) return null;
  const frame = planeFrame(model.facePlane(face));
  const w = r.grid(250, 2000, 250);
  const h = r.grid(250, 2000, 250);
  const ox = r.grid(-1000, 1000, 250);
  const oy = r.grid(-1000, 1000, 250);
  const corner = center.clone().addScaledVector(frame.u, ox - w / 2).addScaledVector(frame.v, oy - h / 2);
  const pts = [
    corner,
    corner.clone().addScaledVector(frame.u, w),
    corner.clone().addScaledVector(frame.u, w).addScaledVector(frame.v, h),
    corner.clone().addScaledVector(frame.v, h),
  ];
  drawPolygon(model, pts);
  return `rect ${w}x${h} on face ${face.id}`;
}

const OPS: Op[] = [
  {
    name: 'ground rect',
    run: (m, r) => {
      const x = r.grid(-6000, 6000, 500);
      const y = r.grid(-6000, 6000, 500);
      const w = r.grid(500, 4000, 500);
      const h = r.grid(500, 4000, 500);
      drawPolygon(m, rect(x, y, x + w, y + h));
      return `ground rect ${x},${y} ${w}x${h}`;
    },
  },
  { name: 'rect on face', run: rectOnFace },
  {
    name: 'push/pull',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const d = r.grid(-2000, 2000, 250) || 500;
      pushPull(m, face.id, d);
      return `push/pull face ${face.id} by ${d}`;
    },
  },
  {
    name: 'move face',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const d = [v(r.grid(-1000, 1000, 250), 0, 0), v(0, r.grid(-1000, 1000, 250), 0), v(0, 0, r.grid(-1000, 1000, 250))][r.int(0, 2)];
      transformVertices(m, verticesOf(m, [face.id], []), new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      return `move face ${face.id} by ${d.toArray()}`;
    },
  },
  {
    name: 'move face out',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const d = face.normal.clone().multiplyScalar(r.grid(250, 1000, 250));
      transformVertices(m, verticesOf(m, [face.id], []), new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      return `move face ${face.id} out by ${d.length()}`;
    },
  },
  {
    name: 'move all',
    run: (m, r) => {
      const d = v(r.grid(-3000, 3000, 500), r.grid(-3000, 3000, 500), 0);
      transformVertices(m, m.allVertices().map((x) => x.id), new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      return `move all by ${d.toArray()}`;
    },
  },
  {
    name: 'copy faces',
    run: (m, r) => {
      const faces = m.allFaces().filter(() => r.next() < 0.5).map((f) => f.id);
      if (faces.length === 0) return null;
      const d = v(r.grid(-6000, 6000, 500), r.grid(-6000, 6000, 500), 0);
      copyEntities(m, faces, [], new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      return `copy ${faces.length} faces by ${d.toArray()}`;
    },
  },
  {
    name: 'rotate all',
    run: (m, r) => {
      const angle = [Math.PI / 2, Math.PI / 4, -Math.PI / 6][r.int(0, 2)];
      const c = v(r.grid(-2000, 2000, 500), r.grid(-2000, 2000, 500), 0);
      const mat = new THREE.Matrix4()
        .makeTranslation(c.x, c.y, c.z)
        .multiply(new THREE.Matrix4().makeRotationZ(angle))
        .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      transformVertices(m, m.allVertices().map((x) => x.id), mat);
      return `rotate all ${((angle * 180) / Math.PI).toFixed(0)}° about ${c.toArray()}`;
    },
  },
  {
    name: 'move vertex',
    run: (m, r) => {
      const vertex = r.pick(m.allVertices());
      if (!vertex) return null;
      const d = v(0, 0, r.grid(-500, 500, 250) || 250);
      transformVertices(m, [vertex.id], new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      return `move vertex ${vertex.id} by ${d.z}`;
    },
  },
  {
    name: 'erase edge',
    run: (m, r) => {
      const edge = r.pick(m.allEdges());
      if (!edge) return null;
      eraseEdges(m, [edge.id]);
      return `erase edge ${edge.id}`;
    },
  },
  {
    name: 'paint',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const color = r.pick(['#c0392b', '#2e86c1', '#f4d03f', undefined]);
      paintFaces(m, [face.id], color);
      return `paint face ${face.id} ${color ?? 'clear'}`;
    },
  },
  {
    name: 'erase face',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      eraseFaces(m, [face.id]);
      return `erase face ${face.id}`;
    },
  },
  {
    name: 'offset',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face || faceArea(m, face) < 1_000_000) return null;
      const d = r.grid(-300, 300, 100) || 100;
      const outline = face.outer.map((x) => m.position(x).clone());
      const shape = offsetPolygon(outline, face.normal, d);
      if (!offsetHolds(shape, face.normal, outline)) return null; // collapsed
      drawPolygon(m, shape);
      return `offset face ${face.id} by ${d}`;
    },
  },
  {
    name: 'circle on face',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const c = faceInteriorPoint(m, face);
      if (!c) return null;
      const radius = r.grid(100, 800, 100);
      drawPolygon(m, circlePoints(c, face.normal, radius, 12));
      return `circle r${radius} on face ${face.id}`;
    },
  },
  {
    name: 'line between vertices',
    run: (m, r) => {
      const a = r.pick(m.allVertices());
      const b = r.pick(m.allVertices());
      if (!a || !b || a.id === b.id) return null;
      drawSegments(m, [[a.position.clone(), b.position.clone()]]);
      return `line ${a.id}-${b.id}`;
    },
  },
];

/** The face in `plane` containing `p` (after drawing, to push/pull the new shape). */
function faceAt(model: Model, p: THREE.Vector3, normal: THREE.Vector3): number | undefined {
  return model
    .allFaces()
    .find((f) => Math.abs(Math.abs(f.normal.dot(normal)) - 1) < 1e-9 && Math.abs(f.normal.dot(p) - f.normal.dot(model.position(f.outer[0]))) < 1e-3 && faceContainsPoint(model, f, p))?.id;
}

/** Thrown when a push/pull of a compound operation is refused; the operation is then skipped (undone). */
class Refused extends Error {}

/** Push/pull as the last step of a compound operation: a refusal undoes the drawing as well. */
function pull(m: Model, id: number, d: number): void {
  if (!pushPull(m, id, d)) throw new Refused();
}

/** Compound operations that keep closed solids closed: draw a shape, then push/pull it. */
const SOLID_COMPOUND_OPS: Op[] = [
  {
    name: 'block',
    run: (m, r) => {
      const x = r.grid(-6000, 6000, 500);
      const y = r.grid(-6000, 6000, 500);
      const w = r.grid(500, 4000, 500);
      const h = r.grid(500, 4000, 500);
      // Footprints may touch existing geometry on the ground but not overlap it
      // (an overlapped footprint splits, and only part of it would be pulled).
      const inside = (p: THREE.Vector3) => Math.abs(p.z) < 1e-3 && p.x > x + 1e-3 && p.x < x + w - 1e-3 && p.y > y + 1e-3 && p.y < y + h - 1e-3;
      const crosses = m.allEdges().some((e) => {
        const [a, b] = [m.position(e.a), m.position(e.b)];
        if (Math.abs(a.z) > 1e-3 || Math.abs(b.z) > 1e-3) return false;
        for (let t = 0; t <= 1; t += 0.05) if (inside(a.clone().lerp(b, t))) return true;
        return false;
      });
      const covering = m.allFaces().some((f) => Math.abs(f.normal.z) > 0.999 && Math.abs(m.position(f.outer[0]).z) < 1e-3 && faceContainsPoint(m, f, v(x + w / 2, y + h / 2)));
      if (crosses || covering) return null;
      drawPolygon(m, rect(x, y, x + w, y + h));
      const id = faceAt(m, v(x + w / 2, y + h / 2), v(0, 0, 1));
      if (id === undefined) return `block footprint ${x},${y} ${w}x${h} (covered)`;
      const height = r.grid(500, 3000, 500);
      // Upwards: ground faces normally point down, so that is against the normal.
      pull(m, id, m.face(id).normal.z < 0 ? -height : height);
      return `block ${x},${y} ${w}x${h} up ${height}`;
    },
  },
  {
    name: 'feature',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const center = faceInteriorPoint(m, face);
      if (!center) return null;
      const frame = planeFrame(m.facePlane(face));
      const w = r.grid(250, 1500, 250);
      const h = r.grid(250, 1500, 250);
      const corner = center.clone().addScaledVector(frame.u, -w / 2).addScaledVector(frame.v, -h / 2);
      const shape = [corner, corner.clone().addScaledVector(frame.u, w), corner.clone().addScaledVector(frame.u, w).addScaledVector(frame.v, h), corner.clone().addScaledVector(frame.v, h)];
      if (!shape.every((p) => faceContainsPoint(m, face, p))) return null; // features sit inside their face
      drawPolygon(m, shape);
      const id = faceAt(m, center, face.normal);
      if (id === undefined) return `feature ${w}x${h} on face ${face.id} (no face)`;
      const d = r.grid(-1000, 1000, 250) || 250;
      pull(m, id, d);
      return `feature ${w}x${h} on face ${face.id}, push/pull ${d}`;
    },
  },
  {
    name: 'round feature',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face) return null;
      const center = faceInteriorPoint(m, face);
      if (!center) return null;
      const radius = r.grid(100, 600, 100);
      const shape = circlePoints(center, face.normal, radius, 12);
      if (!shape.every((p) => faceContainsPoint(m, face, p))) return null; // features sit inside their face
      drawPolygon(m, shape);
      const id = faceAt(m, center, face.normal);
      if (id === undefined) return `round feature r${radius} on face ${face.id} (no face)`;
      const d = r.grid(-1000, 1000, 250) || 250;
      pull(m, id, d);
      return `round feature r${radius} on face ${face.id}, push/pull ${d}`;
    },
  },
  {
    name: 'inset',
    run: (m, r) => {
      const face = r.pick(m.allFaces());
      if (!face || face.holes.length > 0 || faceArea(m, face) < 1_000_000) return null;
      const inset = r.grid(100, 300, 100);
      const center = faceInteriorPoint(m, face);
      const outline = face.outer.map((x) => m.position(x).clone());
      const shape = offsetPolygon(outline, face.normal, inset);
      if (!offsetHolds(shape, face.normal, outline)) return null; // collapsed
      if (!shape.every((p) => faceContainsPoint(m, face, p))) return null; // inset must stay inside
      drawPolygon(m, shape);
      const id = center && faceAt(m, center, face.normal);
      if (id === undefined || id === null) return `inset ${inset} on face ${face.id} (no face)`;
      const d = r.grid(-500, 500, 250) || 250;
      pull(m, id, d);
      return `inset ${inset} on face ${face.id}, push/pull ${d}`;
    },
  },
];

export interface FuzzFailure {
  seed: number;
  step: number;
  log: string[];
  problems: Problem[];
  model: Model;
}

const VIEWS = allViews(DEFAULT_SETTINGS);

/** Operations people use on solids; these must also keep faces consistently oriented. */
const SOLID_OPS = new Set(['push/pull', 'move all', 'rotate all']);

export interface FuzzOptions {
  /** Only operations that model solids, and check orientation and outward normals too. */
  solids?: boolean;
  inspect?: (model: Model, step: number) => void;
}

/** Signed volume enclosed by the faces (positive when normals point outwards). */
function signedVolume(model: Model): number {
  let total = 0;
  for (const face of model.allFaces()) total += (faceArea(model, face) * face.normal.dot(model.position(face.outer[0]))) / 3;
  return total;
}

/** Runs `steps` random operations; returns the first failure, if any. */
export function fuzz(seed: number, steps: number, options: FuzzOptions | ((model: Model, step: number) => void) = {}): FuzzFailure | null {
  const { solids = false, inspect } = typeof options === 'function' ? { inspect: options } : options;
  const ops = solids
    ? [...OPS.filter((op) => SOLID_OPS.has(op.name)), ...SOLID_COMPOUND_OPS]
    : OPS.filter((op) => op.name !== 'move face out');
  const r = rng(seed);
  const model = new Model();
  const log: string[] = [];
  // Start from a box so most operations have something to act on.
  model.edit(() => drawPolygon(model, rect(0, 0, 3000, 2000)));
  model.edit(() => pushPull(model, model.allFaces()[0].id, -2500));
  log.push('box 3000x2000x2500');

  for (let step = 0; step < steps; step++) {
    inspect?.(model, step);
    const op = ops[r.int(0, ops.length - 1)];
    const before = snapshot(model);
    const wasConsistent = solids && validateModel(model, { orientation: true }).length === 0;
    // Two solids may touch along an edge (four faces); one or an odd number of faces is a hole or a bad joint.
    const sound = (id: number) => {
      const n = model.facesOfEdge(id).length;
      return n >= 2 && n % 2 === 0;
    };
    const isClosed = () => model.allEdges().every((e) => sound(e.id));
    const wasClosed = solids && isClosed();
    let description: string | null = null;
    let edit;
    try {
      ({ result: description, edit } = model.edit(() => op.run(model, r)));
    } catch (error) {
      if (error instanceof Refused) continue;
      log.push(`${op.name}: THREW ${(error as Error).message}`);
      return { seed, step, log, problems: [{ kind: 'exception', detail: `${op.name}: ${(error as Error).stack}` }], model };
    }
    if (description === null) continue;
    log.push(description);

    // Orientation is only checked when the operation started from a consistent model.
    const problems = validateModel(model, { orientation: wasConsistent });
    const closed = isClosed();
    if (wasClosed && !closed) {
      const bad = model.allEdges().find((e) => !sound(e.id))!;
      problems.push({ kind: 'not-closed', detail: `edge ${bad.id} has ${model.facesOfEdge(bad.id).length} faces` });
    }
    if (wasConsistent && closed && model.faceCount > 0 && signedVolume(model) <= 0) {
      problems.push({ kind: 'inside-out', detail: `closed model has volume ${signedVolume(model).toFixed(0)}` });
    }
    const after = snapshot(model);
    edit.revert();
    if (snapshot(model) !== before) problems.push({ kind: 'undo', detail: 'revert did not restore the previous state' });
    edit.apply();
    if (snapshot(model) !== after) problems.push({ kind: 'redo', detail: 'apply did not restore the edited state' });

    for (const kind of VIEWS) {
      try {
        computeDrawing(model, viewSetup(kind, DEFAULT_SETTINGS, model.bounds()));
      } catch (error) {
        problems.push({ kind: 'drawing', detail: `${kind.kind}: ${(error as Error).message}` });
      }
    }
    // Orientation is undefined on self-intersecting geometry; report that instead.
    if (problems.some((p) => p.kind === 'inconsistent-orientation' || p.kind === 'inside-out' || p.kind === 'not-closed')) {
      const crossing = selfIntersections(model);
      if (crossing.length > 0) return { seed, step, log, problems: [crossing[0], ...problems], model };
    }
    if (problems.length > 0) return { seed, step, log, problems, model };
  }
  return null;
}
