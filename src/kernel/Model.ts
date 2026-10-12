import * as THREE from 'three';
import { Emitter } from '../core/emitter';
import type { Operation } from '../core/history';
import { EPS, planeFromPointNormal, projectOnSegment, type Plane } from './math';

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

type Table = 'vertices' | 'edges' | 'faces';
type Entity = Vertex | Edge | Face;

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

  private readonly vertexEdges = new Map<Id, Set<Id>>();
  private readonly edgeByPair = new Map<string, Id>();
  /** Faces by vertex pair, so the index does not depend on edge ids. */
  private readonly pairFaces = new Map<string, Set<Id>>();

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
    for (const v of this.vertices.values()) if (v.position.distanceTo(p) < EPS) return v.id;
    return undefined;
  }

  /** Edge whose interior contains `p` (not counting its endpoints). */
  findEdgeContaining(p: THREE.Vector3): Id | undefined {
    for (const e of this.edges.values()) {
      const a = this.position(e.a);
      const b = this.position(e.b);
      const { t, distance } = projectOnSegment(p, a, b);
      const length = a.distanceTo(b);
      if (distance < EPS && t * length > EPS && (1 - t) * length > EPS) return e.id;
    }
    return undefined;
  }

  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const v of this.vertices.values()) box.expandByPoint(v.position);
    return box;
  }

  // ------------------------------------------------------------- mutations

  /**
   * Runs `fn` with journaling. Returns the result and the recorded edit.
   * Nested calls join the outer edit. If `fn` throws, all changes are undone.
   */
  edit<T>(fn: () => T): { result: T; edit: ModelEdit } {
    if (this.journal) return { result: fn(), edit: new ModelEdit(this, []) };

    const journal = new Map<string, { table: Table; id: Id; before: Entity | undefined }>();
    this.journal = journal;
    let result: T;
    try {
      result = fn();
    } catch (error) {
      for (const entry of journal.values()) this.restore(entry.table, entry.id, entry.before);
      throw error;
    } finally {
      this.journal = null;
    }

    const entries: JournalEntry[] = [];
    for (const { table, id, before } of journal.values()) {
      const after = this.table(table).get(id);
      if (before !== after) entries.push({ table, id, before, after });
    }
    const edit = new ModelEdit(this, entries);
    if (!edit.empty) this.changed.emit();
    return { result, edit };
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
    return (table === 'vertices' ? this.vertices : table === 'edges' ? this.edges : this.faces) as Map<Id, Entity>;
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
    if (id >= this.nextId) this.nextId = id + 1;
  }

  private indexEdge(e: Edge): void {
    for (const v of [e.a, e.b]) {
      let set = this.vertexEdges.get(v);
      if (!set) this.vertexEdges.set(v, (set = new Set()));
      set.add(e.id);
    }
    this.edgeByPair.set(pairKey(e.a, e.b), e.id);
  }

  private unindexEdge(e: Edge): void {
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
