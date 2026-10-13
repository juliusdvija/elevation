import * as THREE from 'three';
import { Emitter } from '../core/emitter';
import type { Operation } from '../core/history';
import { EPS, planeFromPointNormal, projectOnSegment, type Plane } from './math';
import { SpatialIndex } from './spatial';

export type Id = number;

export interface Vertex {
  readonly id: Id;
  readonly position: THREE.Vector3;
}

export interface Edge {
  readonly id: Id;
  readonly a: Id;
  readonly b: Id;
}

/**
 * A planar face. `outer` runs counter-clockwise seen from the side `normal`
 * points to; `holes` run clockwise. Consecutive loop vertices are joined by
 * an edge.
 */
export interface Face {
  readonly id: Id;
  readonly outer: readonly Id[];
  readonly holes: readonly (readonly Id[])[];
  readonly normal: THREE.Vector3;
}

/**
 * A construction guide: an infinite line or a point. Guides help drawing
 * (they can be snapped to) but are not geometry and never form faces.
 */
export type Guide =
  | { readonly id: Id; readonly kind: 'line'; readonly point: THREE.Vector3; readonly direction: THREE.Vector3 }
  | { readonly id: Id; readonly kind: 'point'; readonly point: THREE.Vector3 };

/**
 * A placed group or component: a definition (by id, owned by the document)
 * and a column-major 4x4 transform from the definition's coordinates into
 * this model's.
 */
export interface Instance {
  readonly id: Id;
  readonly definition: number;
  readonly matrix: readonly number[];
}

type Table = 'vertices' | 'edges' | 'faces' | 'guides' | 'instances';
type Entity = Vertex | Edge | Face | Guide | Instance;

interface JournalEntry {
  table: Table;
  id: Id;
  before: Entity | undefined;
  after: Entity | undefined;
}

export function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Vertex pairs (edges) of a closed loop. */
export function loopPairs(loop: readonly Id[]): [Id, Id][] {
  return loop.map((v, i) => [v, loop[(i + 1) % loop.length]]);
}

/** Plain-data form of a model, as stored in files. */
export interface ModelData {
  nextId: number;
  vertices: [Id, number, number, number][];
  edges: [Id, Id, Id][];
  faces: { id: Id; outer: Id[]; holes: Id[][]; normal: [number, number, number] }[];
  guides: ({ id: Id; kind: 'line'; point: [number, number, number]; direction: [number, number, number] } | { id: Id; kind: 'point'; point: [number, number, number] })[];
  instances?: { id: Id; definition: number; matrix: number[] }[];
}

/**
 * A recorded set of model changes. Reverting and re-applying it is how undo,
 * redo and tool previews work.
 */
export class ModelEdit implements Operation {
  constructor(
    private readonly model: Model,
    readonly entries: readonly JournalEntry[],
  ) {}

  get empty(): boolean {
    return this.entries.length === 0;
  }

  apply(): void {
    for (const e of this.entries) this.model.restore(e.table, e.id, e.after);
    this.model.changed.emit();
  }

  revert(): void {
    for (const e of this.entries) this.model.restore(e.table, e.id, e.before);
    this.model.changed.emit();
  }
}

/**
 * Geometry store: vertices, edges and faces, with adjacency indexes.
 * Entities are immutable records, replaced on change. Mutations are only
 * allowed inside `edit()`, which journals them.
 */
export class Model {
  readonly changed = new Emitter<void>();

  private readonly vertices = new Map<Id, Vertex>();
  private readonly edges = new Map<Id, Edge>();
  private readonly faces = new Map<Id, Face>();
  private readonly guides = new Map<Id, Guide>();
  private readonly instances = new Map<Id, Instance>();

  private readonly vertexEdges = new Map<Id, Set<Id>>();
  private readonly edgeByPair = new Map<string, Id>();
  /** Faces by vertex pair, so the index does not depend on edge ids. */
  private readonly pairFaces = new Map<string, Set<Id>>();
  private readonly spatial = new SpatialIndex();

  private nextId = 1;
  private journal: Map<string, { table: Table; id: Id; before: Entity | undefined }> | null = null;

  // ---------------------------------------------------------------- queries

  vertex(id: Id): Vertex {
    const v = this.vertices.get(id);
    if (!v) throw new Error(`No vertex ${id}`);
    return v;
  }

  edge(id: Id): Edge {
    const e = this.edges.get(id);
    if (!e) throw new Error(`No edge ${id}`);
    return e;
  }

  face(id: Id): Face {
    const f = this.faces.get(id);
    if (!f) throw new Error(`No face ${id}`);
    return f;
  }

  hasVertex(id: Id): boolean {
    return this.vertices.has(id);
  }

  hasEdge(id: Id): boolean {
    return this.edges.has(id);
  }

  hasFace(id: Id): boolean {
    return this.faces.has(id);
  }

  get vertexCount(): number {
    return this.vertices.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  get faceCount(): number {
    return this.faces.size;
  }

  allVertices(): Vertex[] {
    return [...this.vertices.values()];
  }

  allEdges(): Edge[] {
    return [...this.edges.values()];
  }

  allFaces(): Face[] {
    return [...this.faces.values()];
  }

  allInstances(): Instance[] {
    return [...this.instances.values()];
  }

  instance(id: Id): Instance {
    const i = this.instances.get(id);
    if (!i) throw new Error(`No instance ${id}`);
    return i;
  }

  hasInstance(id: Id): boolean {
    return this.instances.has(id);
  }

  allGuides(): Guide[] {
    return [...this.guides.values()];
  }

  hasGuide(id: Id): boolean {
    return this.guides.has(id);
  }

  position(id: Id): THREE.Vector3 {
    return this.vertex(id).position;
  }

  edgesAt(vertex: Id): Id[] {
    return [...(this.vertexEdges.get(vertex) ?? [])];
  }

  edgeBetween(a: Id, b: Id): Id | undefined {
    return this.edgeByPair.get(pairKey(a, b));
  }

  /** The vertex at the other end of `edge`. */
  other(edge: Edge, vertex: Id): Id {
    return edge.a === vertex ? edge.b : edge.a;
  }

  facesOfEdge(edge: Id): Id[] {
    const e = this.edge(edge);
    return [...(this.pairFaces.get(pairKey(e.a, e.b)) ?? [])];
  }

  facesAtVertex(vertex: Id): Id[] {
    const faces = new Set<Id>();
    for (const e of this.edgesAt(vertex)) for (const f of this.facesOfEdge(e)) faces.add(f);
    return [...faces];
  }

  faceLoops(face: Face): readonly (readonly Id[])[] {
    return [face.outer, ...face.holes];
  }

  faceEdges(face: Face): Id[] {
    const ids: Id[] = [];
    for (const loop of this.faceLoops(face)) {
      for (const [a, b] of loopPairs(loop)) {
        const e = this.edgeBetween(a, b);
        if (e !== undefined) ids.push(e);
      }
    }
    return ids;
  }

  faceVertices(face: Face): Id[] {
    return [...new Set(this.faceLoops(face).flat())];
  }

  /** Oriented plane of a face (normal = face normal). */
  facePlane(face: Face): Plane {
    return planeFromPointNormal(this.position(face.outer[0]), face.normal);
  }

  /** Existing vertex within tolerance of `p`. */
  findVertex(p: THREE.Vector3): Id | undefined {
    for (const id of this.spatial.verticesNear(p, p)) {
      const v = this.vertices.get(id);
      if (v && v.position.distanceTo(p) < EPS) return id;
    }
    return undefined;
  }

  /** Edge whose interior contains `p` (not counting its endpoints). */
  findEdgeContaining(p: THREE.Vector3): Id | undefined {
    for (const id of this.spatial.edgesNear(p, p)) {
      const e = this.edges.get(id);
      if (!e) continue;
      const a = this.position(e.a);
      const b = this.position(e.b);
      const { t, distance } = projectOnSegment(p, a, b);
      const length = a.distanceTo(b);
      if (distance < EPS && t * length > EPS && (1 - t) * length > EPS) return e.id;
    }
    return undefined;
  }

  /** Edges that may touch the box: those in the same grid cells (check geometry yourself). */
  edgesNear(box: THREE.Box3, pad = EPS): Edge[] {
    return this.spatial.edgesNear(box.min, box.max, pad).map((id) => this.edges.get(id)!).filter(Boolean);
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const v of this.vertices.values()) box.expandByPoint(v.position);
    return box;
  }

  // ------------------------------------------------------------ persistence

  toData(): ModelData {
    const byId = <T extends { id: Id }>(list: T[]) => [...list].sort((a, b) => a.id - b.id);
    return {
      nextId: this.nextId,
      vertices: byId(this.allVertices()).map((v) => [v.id, v.position.x, v.position.y, v.position.z]),
      edges: byId(this.allEdges()).map((e) => [e.id, e.a, e.b]),
      faces: byId(this.allFaces()).map((f) => ({
        id: f.id,
        outer: [...f.outer],
        holes: f.holes.map((h) => [...h]),
        normal: f.normal.toArray() as [number, number, number],
      })),
      instances: byId(this.allInstances()).map((i) => ({ id: i.id, definition: i.definition, matrix: [...i.matrix] })),
      guides: byId(this.allGuides()).map((g) =>
        g.kind === 'line'
          ? { id: g.id, kind: 'line' as const, point: g.point.toArray() as [number, number, number], direction: g.direction.toArray() as [number, number, number] }
          : { id: g.id, kind: 'point' as const, point: g.point.toArray() as [number, number, number] },
      ),
    };
  }

  /** Replaces the whole model with `data` (not undoable; clear history after). */
  load(data: ModelData): void {
    if (this.journal) throw new Error('Cannot load during an edit');
    for (const table of ['faces', 'edges', 'guides', 'instances', 'vertices'] as const) {
      for (const id of [...this.table(table).keys()]) this.set(table, id, undefined);
    }
    for (const [id, x, y, z] of data.vertices) this.set('vertices', id, { id, position: new THREE.Vector3(x, y, z) });
    for (const [id, a, b] of data.edges) this.set('edges', id, { id, a, b });
    for (const f of data.faces) {
      this.set('faces', f.id, { id: f.id, outer: [...f.outer], holes: f.holes.map((h) => [...h]), normal: new THREE.Vector3(...f.normal) });
    }
    for (const g of data.guides ?? []) {
      this.set(
        'guides',
        g.id,
        g.kind === 'line'
          ? { id: g.id, kind: 'line', point: new THREE.Vector3(...g.point), direction: new THREE.Vector3(...g.direction) }
          : { id: g.id, kind: 'point', point: new THREE.Vector3(...g.point) },
      );
    }
    for (const i of data.instances ?? []) this.set('instances', i.id, { id: i.id, definition: i.definition, matrix: [...i.matrix] });
    this.nextId = Math.max(data.nextId, this.nextId);
    this.changed.emit();
  }

  // ------------------------------------------------------------- mutations

  /**
   * Runs `fn` with journaling. Returns the result and the recorded edit.
   * Nested calls join the outer edit. If `fn` throws, all changes are undone.
   */
  edit<T>(fn: () => T): { result: T; edit: ModelEdit } {
    if (this.journal) return { result: fn(), edit: new ModelEdit(this, []) };
    this.beginJournal();
    let result: T;
    try {
      result = fn();
    } catch (error) {
      this.abortJournal();
      throw error;
    }
    return { result, edit: this.endJournal() };
  }

  /**
   * Runs `fn` as a trial inside the current edit: when `accept` rejects its
   * result, everything `fn` changed is undone and `undefined` is returned.
   */
  attempt<T>(fn: () => T, accept: (result: T) => boolean): T | undefined {
    const outer = this.journal;
    if (!outer) throw new Error('Model changes must happen inside model.edit()');
    const inner = new Map<string, { table: Table; id: Id; before: Entity | undefined }>();
    this.journal = inner;
    let result: T;
    try {
      result = fn();
    } catch (error) {
      this.journal = outer;
      for (const entry of inner.values()) this.restore(entry.table, entry.id, entry.before);
      throw error;
    }
    this.journal = outer;
    if (accept(result)) {
      // What was there before the trial is what the outer edit must restore.
      for (const [key, entry] of inner) if (!outer.has(key)) outer.set(key, entry);
      return result;
    }
    for (const entry of inner.values()) this.restore(entry.table, entry.id, entry.before);
    return undefined;
  }

  /** Whether changes are being recorded (inside `edit` or a document step). */
  get journaling(): boolean {
    return this.journal !== null;
  }

  /** Starts recording changes. Pair with `endJournal` or `abortJournal`. */
  beginJournal(): void {
    if (this.journal) throw new Error('Already recording');
    this.journal = new Map();
  }

  /** Stops recording and returns the changes made since `beginJournal`. */
  endJournal(): ModelEdit {
    const journal = this.journal;
    if (!journal) throw new Error('Not recording');
    this.journal = null;
    const entries: JournalEntry[] = [];
    for (const { table, id, before } of journal.values()) {
      const after = this.table(table).get(id);
      if (before !== after) entries.push({ table, id, before, after });
    }
    const edit = new ModelEdit(this, entries);
    if (!edit.empty) this.changed.emit();
    return edit;
  }

  /** Stops recording and undoes everything recorded. */
  abortJournal(): void {
    const journal = this.journal;
    if (!journal) return;
    this.journal = null;
    for (const entry of journal.values()) this.restore(entry.table, entry.id, entry.before);
  }

  addInstance(definition: number, matrix: THREE.Matrix4): Id {
    const id = this.nextId++;
    this.write('instances', id, { id, definition, matrix: matrix.toArray() });
    return id;
  }

  setInstanceMatrix(id: Id, matrix: THREE.Matrix4): void {
    const i = this.instance(id);
    this.write('instances', id, { ...i, matrix: matrix.toArray() });
  }

  setInstanceDefinition(id: Id, definition: number): void {
    const i = this.instance(id);
    this.write('instances', id, { ...i, definition });
  }

  removeInstance(id: Id): void {
    this.write('instances', id, undefined);
  }

  addVertex(position: THREE.Vector3): Id {
    const id = this.nextId++;
    this.write('vertices', id, { id, position: position.clone() });
    return id;
  }

  moveVertex(id: Id, position: THREE.Vector3): void {
    this.vertex(id);
    this.write('vertices', id, { id, position: position.clone() });
  }

  removeVertex(id: Id): void {
    if (this.vertexEdges.get(id)?.size) throw new Error(`Vertex ${id} still has edges`);
    this.write('vertices', id, undefined);
  }

  /** Adds an edge between two vertices, or returns the existing one. */
  addEdge(a: Id, b: Id): Id {
    if (a === b) throw new Error('Degenerate edge');
    const existing = this.edgeBetween(a, b);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.write('edges', id, { id, a, b });
    return id;
  }

  removeEdge(id: Id): void {
    this.write('edges', id, undefined);
  }

  /** Creates or replaces a face. Pass `id` to keep an existing face's identity. */
  putFace(face: Omit<Face, 'id'> & { id?: Id }): Id {
    const id = face.id ?? this.nextId++;
    this.write('faces', id, {
      id,
      outer: [...face.outer],
      holes: face.holes.map((h) => [...h]),
      normal: face.normal.clone().normalize(),
    });
    return id;
  }

  removeFace(id: Id): void {
    this.write('faces', id, undefined);
  }

  addGuideLine(point: THREE.Vector3, direction: THREE.Vector3): Id {
    const id = this.nextId++;
    this.write('guides', id, { id, kind: 'line', point: point.clone(), direction: direction.clone().normalize() });
    return id;
  }

  addGuidePoint(point: THREE.Vector3): Id {
    const id = this.nextId++;
    this.write('guides', id, { id, kind: 'point', point: point.clone() });
    return id;
  }

  removeGuide(id: Id): void {
    this.write('guides', id, undefined);
  }

  /** Writes an entity without journaling; used by undo/redo. */
  restore(table: Table, id: Id, value: Entity | undefined): void {
    this.set(table, id, value);
  }

  private write(table: Table, id: Id, value: Entity | undefined): void {
    const journal = this.journal;
    if (!journal) throw new Error('Model changes must happen inside model.edit()');
    const key = `${table}:${id}`;
    if (!journal.has(key)) journal.set(key, { table, id, before: this.table(table).get(id) });
    this.set(table, id, value);
  }

  private table(table: Table): Map<Id, Entity> {
    const tables = { vertices: this.vertices, edges: this.edges, faces: this.faces, guides: this.guides, instances: this.instances };
    return tables[table] as Map<Id, Entity>;
  }

  private set(table: Table, id: Id, value: Entity | undefined): void {
    const map = this.table(table);
    const previous = map.get(id);
    if (table === 'edges' && previous) this.unindexEdge(previous as Edge);
    if (table === 'faces' && previous) this.unindexFace(previous as Face);
    if (value) map.set(id, value);
    else map.delete(id);
    if (table === 'edges' && value) this.indexEdge(value as Edge);
    if (table === 'faces' && value) this.indexFace(value as Face);
    if (table === 'vertices') {
      this.spatial.setVertex(id, (value as Vertex | undefined)?.position);
      // Edges at a vertex that appeared, moved or went away change their place in the grid.
      for (const e of this.vertexEdges.get(id) ?? []) this.placeEdge(this.edges.get(e));
    }
    if (id >= this.nextId) this.nextId = id + 1;
  }

  private placeEdge(e: Edge | undefined): void {
    if (!e) return;
    const a = this.vertices.get(e.a);
    const b = this.vertices.get(e.b);
    this.spatial.setEdge(e.id, a?.position, b?.position);
  }

  private indexEdge(e: Edge): void {
    this.placeEdge(e);
    for (const v of [e.a, e.b]) {
      let set = this.vertexEdges.get(v);
      if (!set) this.vertexEdges.set(v, (set = new Set()));
      set.add(e.id);
    }
    this.edgeByPair.set(pairKey(e.a, e.b), e.id);
  }

  private unindexEdge(e: Edge): void {
    this.spatial.setEdge(e.id, undefined, undefined);
    for (const v of [e.a, e.b]) {
      const set = this.vertexEdges.get(v);
      set?.delete(e.id);
      if (set?.size === 0) this.vertexEdges.delete(v);
    }
    if (this.edgeByPair.get(pairKey(e.a, e.b)) === e.id) this.edgeByPair.delete(pairKey(e.a, e.b));
  }

  private indexFace(f: Face): void {
    for (const loop of [f.outer, ...f.holes]) {
      for (const [a, b] of loopPairs(loop)) {
        const key = pairKey(a, b);
        let set = this.pairFaces.get(key);
        if (!set) this.pairFaces.set(key, (set = new Set()));
        set.add(f.id);
      }
    }
  }

  private unindexFace(f: Face): void {
    for (const loop of [f.outer, ...f.holes]) {
      for (const [a, b] of loopPairs(loop)) {
        const key = pairKey(a, b);
        const set = this.pairFaces.get(key);
        set?.delete(f.id);
        if (set?.size === 0) this.pairFaces.delete(key);
      }
    }
  }
}
