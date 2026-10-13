import { Model, type Id } from '../kernel/Model';
import * as THREE from 'three';

/** A drawn path: points in the file's units, and whether it closes on itself. */
export interface DxfPath {
  points: [number, number, number][];
  closed: boolean;
}

export interface DxfDrawing {
  paths: DxfPath[];
  /** Millimetres per drawing unit from the file's header (`$INSUNITS`), when it says. */
  unitMm?: number;
  /** Entities that were not drawn (blocks, hatches, text, splines ...), by type. */
  skipped: Map<string, number>;
}

/** `$INSUNITS` codes to millimetres. 0 means "unitless". */
const INSUNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 10: 914.4 };

/** An arc from `from` to `to` with a DXF bulge (tan of a quarter of the included angle), as points along it. */
function bulgeArc(from: [number, number], to: [number, number], bulge: number): [number, number][] {
  const included = 4 * Math.atan(bulge);
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (chord < 1e-9) return [];
  const radius = chord / (2 * Math.sin(Math.abs(included) / 2));
  const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  // The centre lies on the chord's normal: on the left for a counter-clockwise arc (positive bulge) up to a
  // half circle, on the right for a clockwise one; the sign of cos(angle / 2) flips it past a half circle.
  const offset = radius * Math.cos(Math.abs(included) / 2) * Math.sign(bulge);
  const centre: [number, number] = [mid[0] - ((to[1] - from[1]) / chord) * offset, mid[1] + ((to[0] - from[0]) / chord) * offset];
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  const steps = Math.max(2, Math.ceil(Math.abs(included) / (Math.PI / 12)));
  const points: [number, number][] = [];
  for (let i = 1; i < steps; i++) {
    const a = start + (included * i) / steps;
    points.push([centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)]);
  }
  return points;
}

/** A path with bulges expanded into arc points. */
function withBulges(vertices: { x: number; y: number; bulge: number }[], closed: boolean): [number, number][] {
  const out: [number, number][] = [];
  vertices.forEach((v, i) => {
    out.push([v.x, v.y]);
    const next = vertices[closed ? (i + 1) % vertices.length : i + 1];
    if (next && v.bulge !== 0) out.push(...bulgeArc([v.x, v.y], [next.x, next.y], v.bulge));
  });
  return out;
}

/**
 * Reads the drawing entities of an ASCII DXF: LINE, LWPOLYLINE, POLYLINE, CIRCLE and ARC (arcs and
 * circles become segments every 15 degrees). Everything else is counted and skipped.
 */
export function parseDxf(text: string): DxfDrawing {
  if (/^\s*AutoCAD Binary DXF/.test(text.slice(0, 32))) throw new Error('Binary DXF files are not supported. Save as ASCII DXF.');
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }

  const drawing: DxfDrawing = { paths: [], skipped: new Map() };
  const skip = (type: string) => drawing.skipped.set(type, (drawing.skipped.get(type) ?? 0) + 1);

  // Header: the drawing units.
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') {
      drawing.unitMm = INSUNITS[Number(pairs[i + 1][1])];
      break;
    }
  }

  // Entities section.
  let at = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1]?.[0] === 0 && pairs[i - 1]?.[1] === 'SECTION');
  if (at < 0) throw new Error('This is not a DXF drawing (no ENTITIES section).');
  at++;
  const entities: { type: string; data: [number, string][] }[] = [];
  for (; at < pairs.length; at++) {
    const [code, value] = pairs[at];
    if (code === 0 && value === 'ENDSEC') break;
    if (code === 0) entities.push({ type: value, data: [] });
    else entities.at(-1)?.data.push([code, value]);
  }

  const num = (data: [number, string][], code: number, fallback = 0) => {
    const found = data.find((d) => d[0] === code);
    return found ? Number(found[1]) : fallback;
  };

  let polyline: { vertices: { x: number; y: number; bulge: number }[]; closed: boolean; z: number } | null = null;
  for (const { type, data } of entities) {
    if (polyline && type !== 'VERTEX' && type !== 'SEQEND') polyline = null;
    switch (type) {
      case 'LINE':
        drawing.paths.push({ points: [[num(data, 10), num(data, 20), num(data, 30)], [num(data, 11), num(data, 21), num(data, 31)]], closed: false });
        break;
      case 'LWPOLYLINE': {
        const vertices: { x: number; y: number; bulge: number }[] = [];
        for (const [code, value] of data) {
          if (code === 10) vertices.push({ x: Number(value), y: 0, bulge: 0 });
          else if (code === 20 && vertices.length > 0) vertices.at(-1)!.y = Number(value);
          else if (code === 42 && vertices.length > 0) vertices.at(-1)!.bulge = Number(value);
        }
        const closed = (num(data, 70) & 1) === 1;
        const z = num(data, 38);
        if (vertices.length >= 2) drawing.paths.push({ points: withBulges(vertices, closed).map(([x, y]) => [x, y, z]), closed });
        break;
      }
      case 'POLYLINE':
        polyline = { vertices: [], closed: (num(data, 70) & 1) === 1, z: num(data, 30) };
        break;
      case 'VERTEX':
        polyline?.vertices.push({ x: num(data, 10), y: num(data, 20), bulge: num(data, 42) });
        break;
      case 'SEQEND':
        if (polyline && polyline.vertices.length >= 2) {
          drawing.paths.push({ points: withBulges(polyline.vertices, polyline.closed).map(([x, y]) => [x, y, polyline!.z]), closed: polyline.closed });
        }
        polyline = null;
        break;
      case 'CIRCLE': {
        const [cx, cy, z, r] = [num(data, 10), num(data, 20), num(data, 30), num(data, 40)];
        const points: [number, number, number][] = Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos((i / 24) * 2 * Math.PI), cy + r * Math.sin((i / 24) * 2 * Math.PI), z]);
        if (r > 0) drawing.paths.push({ points, closed: true });
        break;
      }
      case 'ARC': {
        const [cx, cy, z, r] = [num(data, 10), num(data, 20), num(data, 30), num(data, 40)];
        const start = (num(data, 50) * Math.PI) / 180;
        let end = (num(data, 51) * Math.PI) / 180;
        if (end <= start) end += 2 * Math.PI;
        const steps = Math.max(2, Math.ceil((end - start) / (Math.PI / 12)));
        if (r > 0) drawing.paths.push({ points: Array.from({ length: steps + 1 }, (_, i) => [cx + r * Math.cos(start + ((end - start) * i) / steps), cy + r * Math.sin(start + ((end - start) * i) / steps), z]), closed: false });
        break;
      }
      default:
        skip(type);
    }
  }
  return drawing;
}

/**
 * A model of loose edges (no faces) from a drawing: an underlay to snap to and trace over. `scale` is
 * millimetres per file unit; `recenter` moves the drawing's lower-left corner to the origin.
 */
export function buildUnderlay(drawing: DxfDrawing, scale: number, recenter = false, progress: (fraction: number, stage: string) => void = () => {}): Model {
  const model = new Model();
  model.edit(() => {
    let shift = new THREE.Vector3();
    if (recenter) {
      const box = new THREE.Box3();
      for (const path of drawing.paths) for (const p of path.points) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(scale));
      if (!box.isEmpty()) shift = new THREE.Vector3(-box.min.x, -box.min.y, 0);
    }
    const byCell = new Map<string, Id>();
    const vertex = (p: [number, number, number]): Id => {
      const q = new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(scale).add(shift);
      const key = `${Math.round(q.x / 0.01)},${Math.round(q.y / 0.01)},${Math.round(q.z / 0.01)}`;
      let id = byCell.get(key);
      if (id === undefined) byCell.set(key, (id = model.addVertex(q)));
      return id;
    };
    let done = 0;
    for (const path of drawing.paths) {
      if (++done % 500 === 0) progress(done / drawing.paths.length, 'Drawing lines');
      const ids = path.points.map(vertex);
      const count = path.closed ? ids.length : ids.length - 1;
      for (let i = 0; i < count; i++) {
        const a = ids[i];
        const b = ids[(i + 1) % ids.length];
        if (a !== b && model.edgeBetween(a, b) === undefined) model.addEdge(a, b);
      }
    }
  });
  return model;
}
