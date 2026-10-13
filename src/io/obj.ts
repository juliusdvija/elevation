import * as THREE from 'three';
import { Model, type Id } from '../kernel/Model';
import { newellNormal } from '../kernel/faces';
import { EPS, closestBetweenSegments, planeFrame, planeFromPointNormal, pointInPolygon, to2D } from '../kernel/math';
import { splitEdgeAt } from '../kernel/draw';
import { settle } from '../kernel/transform';

/** A parsed OBJ: raw positions, polygons (indices into `positions`) with their material, and the materials. */
export interface ObjMesh {
  positions: [number, number, number][];
  faces: { indices: number[]; material: string }[];
  /** Diffuse colours by material name, `#rrggbb`. */
  materials: Map<string, string>;
}

export interface ImportOptions {
  /** Millimetres per OBJ unit. */
  scale: number;
  /** OBJ files are usually Y-up; Elevation is Z-up. */
  yUp: boolean;
  /** Paint faces with their material's colour. Everything else a material holds (textures, transparency) is dropped. */
  colors?: boolean;
  /** Move the model so its footprint is centred on the origin and its lowest point is on the ground. */
  recenter?: boolean;
}

export const UNITS: { id: string; label: string; mm: number }[] = [
  { id: 'mm', label: 'Millimetres', mm: 1 },
  { id: 'cm', label: 'Centimetres', mm: 10 },
  { id: 'm', label: 'Metres', mm: 1000 },
  { id: 'in', label: 'Inches', mm: 25.4 },
  { id: 'ft', label: 'Feet', mm: 304.8 },
];

/** Reads the colours (`Kd`) of a .mtl file. Near-white diffuse colours are what an exporter writes for "no material". */
export function parseMtl(text: string): Map<string, string> {
  const materials = new Map<string, string>();
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('newmtl ')) current = line.slice(7).trim();
    else if (current && line.startsWith('Kd ')) {
      const [r, g, b] = line.slice(3).trim().split(/\s+/).map(Number);
      if ([r, g, b].every(Number.isFinite)) {
        const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
        materials.set(current, `#${hex(r)}${hex(g)}${hex(b)}`);
      }
    }
  }
  return materials;
}

/** Parses the geometry of a Wavefront OBJ (vertices and polygons; normals and texture coordinates are ignored). */
export function parseObj(text: string, mtl?: string): ObjMesh {
  const positions: [number, number, number][] = [];
  const faces: ObjMesh['faces'] = [];
  let material = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      positions.push([x, y, z]);
    } else if (line.startsWith('f ')) {
      const indices = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((token) => {
          const i = parseInt(token.split('/')[0], 10);
          return i < 0 ? positions.length + i : i - 1; // negative indices count back from the last vertex
        });
      if (indices.length >= 3 && indices.every((i) => i >= 0 && i < positions.length)) faces.push({ indices, material });
    } else if (line.startsWith('usemtl ')) {
      material = line.slice(7).trim();
    }
  }
  return { positions, faces, materials: mtl ? parseMtl(mtl) : new Map() };
}

/** Size of the mesh's bounding box in OBJ units. */
export function meshSize(mesh: ObjMesh): [number, number, number] {
  if (mesh.positions.length === 0) return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/** The unit that makes the largest dimension a believable building size (2 m to 500 m); metres when unsure. */
export function guessUnit(mesh: ObjMesh): string {
  const largest = Math.max(...meshSize(mesh));
  for (const unit of UNITS.slice(0, 3)) {
    const metres = (largest * unit.mm) / 1000;
    if (metres >= 2 && metres <= 500) return unit.id;
  }
  return 'm';
}

/** `Kd` colours that exporters write for "no material" stay unpainted. */
function paintOf(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r >= 245 && g >= 245 && b >= 245 ? undefined : hex;
}

interface Triangle {
  v: [Id, Id, Id];
  normal: THREE.Vector3;
  d: number;
  color: string | undefined;
}

const WELD = 0.01; // mm: vertices closer than this are one
// Exporters round coordinates, so coplanar triangles are only coplanar to within a hair; the kernel accepts 0.01 mm.
const PLANE_TOLERANCE = 4e-3; // mm
const NORMAL_TOLERANCE = 1e-6;
const GROUP_FLATNESS = 8e-3; // mm: how far any vertex of a merged face may lie from its plane

/**
 * Builds a model from a mesh: welds vertices, merges coplanar triangles of one colour back into
 * faces (with holes where there are any), paints the faces from their material, and settles
 * the result so it satisfies the kernel's invariants (T-junctions split, and so on).
 */
export function buildModel(mesh: ObjMesh, options: ImportOptions): Model {
  const model = new Model();
  model.edit(() => {
    // Transform the positions: units, then Y-up to Z-up (a rotation, so winding is kept).
    let points = mesh.positions.map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z).multiplyScalar(options.scale);
      return options.yUp ? new THREE.Vector3(p.x, -p.z, p.y) : p;
    });
    if (options.recenter && points.length > 0) {
      const box = new THREE.Box3().setFromPoints(points);
      const shift = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
      points = points.map((p) => p.add(shift));
    }

    // Weld, creating vertices as they are first used.
    const byCell = new Map<string, Id>();
    const welded: (Id | undefined)[] = new Array(points.length);
    const vertexAt = (index: number): Id => {
      const cached = welded[index];
      if (cached !== undefined) return cached;
      const p = points[index];
      const cx = Math.round(p.x / WELD);
      const cy = Math.round(p.y / WELD);
      const cz = Math.round(p.z / WELD);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const hit = byCell.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (hit !== undefined && model.position(hit).distanceTo(p) < WELD) return (welded[index] = hit);
          }
        }
      }
      const id = model.addVertex(p);
      byCell.set(`${cx},${cy},${cz}`, id);
      return (welded[index] = id);
    };

    // Triangles (polygons are fanned), without slivers.
    const triangles: Triangle[] = [];
    const seenTriangles = new Set<string>();
    for (const face of mesh.faces) {
      const color = options.colors === false ? undefined : paintOf(mesh.materials.get(face.material));
      for (let i = 1; i + 1 < face.indices.length; i++) {
        const v: [Id, Id, Id] = [vertexAt(face.indices[0]), vertexAt(face.indices[i]), vertexAt(face.indices[i + 1])];
        if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
        // The same triangle twice (double-sided exports) would overlap itself.
        const key = [...v].sort((a, b) => a - b).join(':');
        if (seenTriangles.has(key)) continue;
        seenTriangles.add(key);
        const [a, b, c] = v.map((id) => model.position(id));
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (normal.length() / 2 < 1e-4) continue;
        normal.normalize();
        triangles.push({ v, normal, d: normal.dot(a), color });
      }
    }

    // Group triangles that share an edge and lie in one plane, facing one way, in one colour.
    const parent = triangles.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const edgeUsers = new Map<string, number[]>();
    triangles.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k];
        const b = t.v[(k + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        (edgeUsers.get(key) ?? edgeUsers.set(key, []).get(key)!).push(i);
      }
    });
    for (const users of edgeUsers.values()) {
      if (users.length !== 2) continue;
      const [s, t] = users.map((i) => triangles[i]);
      if (s.color === t.color && s.normal.dot(t.normal) > 1 - NORMAL_TOLERANCE && Math.abs(s.d - t.d) < PLANE_TOLERANCE) parent[find(users[0])] = find(users[1]);
    }
    const groups = new Map<number, number[]>();
    triangles.forEach((_, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i));

    const addFace = (outer: Id[], holes: Id[][], normal: THREE.Vector3, color: string | undefined) => {
      for (const loop of [outer, ...holes]) {
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k];
          const b = loop[(k + 1) % loop.length];
          if (model.edgeBetween(a, b) === undefined) model.addEdge(a, b);
        }
      }
      model.putFace({ outer, holes, normal, color });
    };

    for (const members of groups.values()) {
      const first = triangles[members[0]];
      const merged = members.length > 1 ? mergeGroup(model, members.map((i) => triangles[i]), first) : null;
      if (merged) for (const f of merged) addFace(f.outer, f.holes, first.normal, first.color);
      else for (const i of members) addFace([...triangles[i].v], [], triangles[i].normal, triangles[i].color);
    }

    // T-junctions and the like: the kernel's own settle splits and welds what is left.
    splitTJunctions(model);
    settleCrossings(model);
  });
  return model;
}

/**
 * Splits every edge that has a vertex lying in its interior (a T-junction: the mesh was not conforming),
 * so faces on both sides meet at the same points. Uses the model's spatial grid, so it stays fast.
 */
function splitTJunctions(model: Model): void {
  const queue = model.allVertices().map((v) => v.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (!model.hasVertex(id)) continue;
    for (let guard = 0; guard < 8; guard++) {
      const edge = model.findEdgeContaining(model.position(id));
      if (edge === undefined) break;
      // The vertex joins the edge: both halves of the edge may in turn contain other vertices.
      splitEdgeAt(model, edge, id);
    }
  }
  // Vertices no edge uses (merged away) only add noise.
  for (const v of model.allVertices()) if (model.edgesAt(v.id).length === 0) model.removeVertex(v.id);
}

/**
 * Where edges of separate parts cross each other (a pane through a wall), the kernel needs a vertex at
 * the crossing. Finds those edges with the spatial grid and lets `settle` split them, only there.
 */
function settleCrossings(model: Model): void {
  const around = new Set<Id>();
  for (const edge of model.allEdges()) {
    const a = model.position(edge.a);
    const b = model.position(edge.b);
    const length = a.distanceTo(b);
    for (const other of model.edgesNear(new THREE.Box3().setFromPoints([a, b]))) {
      if (other.id <= edge.id || other.a === edge.a || other.a === edge.b || other.b === edge.a || other.b === edge.b) continue;
      const c = model.position(other.a);
      const d = model.position(other.b);
      const hit = closestBetweenSegments(a, b, c, d);
      if (hit.parallel || hit.distance >= EPS) continue;
      const inside = (t: number, len: number) => t * len > EPS && (1 - t) * len > EPS;
      if (inside(hit.s, length) && inside(hit.t, c.distanceTo(d))) for (const v of [edge.a, edge.b, other.a, other.b]) around.add(v);
    }
  }
  if (around.size > 0) settle(model, around);
}

/**
 * The outline of a group of coplanar triangles: the half-edges that have no partner inside the group,
 * chained into loops. Counter-clockwise loops are outers, clockwise loops are holes. Returns null when
 * the outline is not simple (a vertex where it touches itself); the caller then keeps the triangles.
 */
function mergeGroup(model: Model, group: Triangle[], reference: Triangle): { outer: Id[]; holes: Id[][] }[] | null {
  const half = new Map<string, [Id, Id]>();
  for (const t of group) {
    for (let k = 0; k < 3; k++) half.set(`${t.v[k]}>${t.v[(k + 1) % 3]}`, [t.v[k], t.v[(k + 1) % 3]]);
  }
  const next = new Map<Id, Id>();
  for (const [a, b] of half.values()) {
    if (half.has(`${b}>${a}`)) continue; // inside the group
    if (next.has(a)) return null; // the outline touches itself here
    next.set(a, b);
  }
  const loops: Id[][] = [];
  const seen = new Set<Id>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Id[] = [];
    let at = start;
    while (!seen.has(at)) {
      seen.add(at);
      loop.push(at);
      const to = next.get(at);
      if (to === undefined) return null;
      at = to;
    }
    if (at !== start || loop.length < 3) return null;
    loops.push(loop);
  }

  const plane = planeFromPointNormal(model.position(group[0].v[0]), reference.normal);
  // Chains of nearly-coplanar triangles can drift: the merged face must really be flat.
  for (const t of group) for (const id of t.v) if (Math.abs(plane.normal.dot(model.position(id)) - plane.d) > GROUP_FLATNESS) return null;
  const frame = planeFrame(plane);
  const polygons = loops.map((loop) => ({ loop, poly: loop.map((id) => to2D(frame, model.position(id))) }));
  const areaOf = (loop: Id[]) => newellNormal(loop.map((id) => model.position(id))).dot(reference.normal) / 2;
  const outers = polygons.filter((p) => areaOf(p.loop) > 0).map((p) => ({ ...p, holes: [] as Id[][], area: areaOf(p.loop) }));
  const holes = polygons.filter((p) => areaOf(p.loop) < 0);
  if (outers.length === 0) return null;
  for (const hole of holes) {
    const probe = hole.poly[0].clone().lerp(hole.poly[1], 0.5);
    const container = outers.filter((o) => pointInPolygon(probe, o.poly)).sort((a, b) => a.area - b.area)[0];
    if (!container) return null;
    container.holes.push(hole.loop);
  }
  return outers.map((o) => ({ outer: o.loop, holes: o.holes }));
}
