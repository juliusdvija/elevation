import * as THREE from 'three';
import { Emitter } from './core/emitter';
import { History, type Operation, type Transaction } from './core/history';
import { Model, type Id, type ModelData, type ModelEdit } from './kernel/Model';
import { removeBareEdges, eraseFaces } from './kernel/cleanup';
import { copyBetweenModels } from './kernel/transform';
import { DEFAULT_SETTINGS, type DrawingSettings } from './drawing/settings';

const UNTITLED = 'Untitled';

/** A group or component: geometry with its own coordinates, placed by instances. */
export interface Definition {
  id: number;
  name: string;
  kind: 'group' | 'component';
  model: Model;
}

/**
 * Where a model sits in the world: the root model, or a definition reached
 * through a chain of instances (`path`). `matrix` maps the model's
 * coordinates to world coordinates.
 */
export interface Placement {
  model: Model;
  path: Id[];
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /** The definition this placement shows (undefined for the root). */
  definition?: Definition;
}

export interface DefinitionData {
  id: number;
  name: string;
  kind: 'group' | 'component';
  model: ModelData;
}

/** Several models' edits applied as one undo step. */
class CompositeEdit implements Operation {
  constructor(private readonly edits: ModelEdit[]) {}
  apply(): void {
    for (const e of this.edits) e.apply();
  }
  revert(): void {
    for (const e of [...this.edits].reverse()) e.revert();
  }
}

/**
 * A model plus its groups/components, undo history, editing context and file
 * state. All user edits go through `run`.
 *
 * `changed` fires when the name or saved state changes; `geometryChanged`
 * when any model's geometry changes; `contextChanged` when entering or
 * leaving a group.
 */
export class Document {
  readonly model = new Model();
  readonly history = new History();
  readonly changed = new Emitter<void>();
  readonly geometryChanged = new Emitter<void>();
  readonly contextChanged = new Emitter<void>();
  readonly definitions = new Map<number, Definition>();
  /** Fires when levels, plan cut height or sections change. */
  readonly settingsChanged = new Emitter<void>();
  drawingSettings: DrawingSettings = structuredClone(DEFAULT_SETTINGS);

  name = UNTITLED;
  /** Where the document was opened from or saved to, when the browser allows writing back. */
  fileHandle: FileSystemFileHandle | null = null;
  private savedHead: Transaction | undefined = undefined;
  /** Set when restored work had not been saved to a file. */
  private restoredUnsaved = false;
  private nextDefinitionId = 1;
  private contextPath: Id[] = [];

  constructor() {
    this.history.changed.on(() => {
      this.changed.emit();
      // Undo can remove the group being edited.
      if (this.placementOf(this.contextPath) === null) this.setContext([]);
    });
    this.model.changed.on(() => this.geometryChanged.emit());
  }

  // --------------------------------------------------------------- editing

  /** Runs an edit (in any models) as one undoable step. */
  run<T>(label: string, fn: () => T): T {
    return this.history.transact(label, (tx) => {
      const models = this.allModels().filter((m) => !m.journaling);
      for (const m of models) m.beginJournal();
      let result: T;
      try {
        result = fn();
      } catch (error) {
        for (const m of models) m.abortJournal();
        throw error;
      }
      const edits = models.map((m) => m.endJournal()).filter((e) => !e.empty);
      if (edits.length > 0) tx.record(new CompositeEdit(edits));
      return result;
    });
  }

  allModels(): Model[] {
    return [this.model, ...[...this.definitions.values()].map((d) => d.model)];
  }

  definition(id: number): Definition {
    const d = this.definitions.get(id);
    if (!d) throw new Error(`No definition ${id}`);
    return d;
  }

  private addDefinition(kind: 'group' | 'component', name: string, model: Model, id = this.nextDefinitionId++): Definition {
    const definition = { id, name, kind, model };
    this.definitions.set(id, definition);
    this.nextDefinitionId = Math.max(this.nextDefinitionId, id + 1);
    model.changed.on(() => this.geometryChanged.emit());
    return definition;
  }

  private defaultName(kind: 'group' | 'component'): string {
    const base = kind === 'group' ? 'Group' : 'Component';
    const taken = new Set([...this.definitions.values()].map((d) => d.name));
    let n = 1;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  /** Changes the drawing settings as one undoable step. */
  updateDrawingSettings(label: string, next: DrawingSettings): void {
    const before = this.drawingSettings;
    const after = structuredClone(next);
    this.history.transact(label, (tx) =>
      tx.run({
        apply: () => {
          this.drawingSettings = after;
          this.settingsChanged.emit();
        },
        revert: () => {
          this.drawingSettings = before;
          this.settingsChanged.emit();
        },
      }),
    );
  }

  // ------------------------------------------------------------ placements

  /** Every placed model in the world, starting with the root. */
  placements(): Placement[] {
    const result: Placement[] = [];
    const visit = (model: Model, path: Id[], matrix: THREE.Matrix4, definition: Definition | undefined, seen: Set<number>) => {
      result.push({ model, path, matrix, inverse: matrix.clone().invert(), definition });
      for (const instance of model.allInstances()) {
        const def = this.definitions.get(instance.definition);
        if (!def || seen.has(def.id)) continue;
        const m = matrix.clone().multiply(new THREE.Matrix4().fromArray(instance.matrix));
        visit(def.model, [...path, instance.id], m, def, new Set([...seen, def.id]));
      }
    };
    visit(this.model, [], new THREE.Matrix4(), undefined, new Set());
    return result;
  }

  /** The placement at a path of instance ids, or null if it no longer exists. */
  placementOf(path: Id[]): Placement | null {
    let model = this.model;
    let definition: Definition | undefined;
    const matrix = new THREE.Matrix4();
    for (const id of path) {
      if (!model.hasInstance(id)) return null;
      const instance = model.instance(id);
      definition = this.definitions.get(instance.definition);
      if (!definition) return null;
      matrix.multiply(new THREE.Matrix4().fromArray(instance.matrix));
      model = definition.model;
    }
    return { model, path: [...path], matrix, inverse: matrix.clone().invert(), definition };
  }

  /** The placement being edited: the root, or a group/component entered by double-clicking. */
  get context(): Placement {
    return this.placementOf(this.contextPath) ?? this.placementOf([])!;
  }

  setContext(path: Id[]): void {
    this.contextPath = this.placementOf(path) ? [...path] : [];
    this.contextChanged.emit();
    this.geometryChanged.emit();
  }

  /**
   * Opens an instance in the current context for editing. A group shared by
   * several instances (after copying) is made unique first, so editing one
   * copy does not change the others; components stay shared.
   */
  enter(instanceId: Id): void {
    const ctx = this.context;
    const instance = ctx.model.instance(instanceId);
    const def = this.definition(instance.definition);
    if (def.kind === 'group' && this.instanceCount(def.id) > 1) {
      this.run('Make Unique', () => this.makeUnique(ctx.model, instanceId));
    }
    this.setContext([...ctx.path, instanceId]);
  }

  /** Leaves the group being edited. */
  exit(): void {
    if (this.contextPath.length > 0) this.setContext(this.contextPath.slice(0, -1));
  }

  /** How many instances (anywhere) use a definition. */
  instanceCount(definition: number): number {
    return this.allModels().reduce((n, m) => n + m.allInstances().filter((i) => i.definition === definition).length, 0);
  }

  /** Gives an instance its own copy of its definition. */
  makeUnique(model: Model, instanceId: Id): Definition {
    const instance = model.instance(instanceId);
    const source = this.definition(instance.definition);
    const copy = new Model();
    copy.load(source.model.toData());
    const def = this.addDefinition(source.kind, source.kind === 'component' ? `${source.name} copy` : this.defaultName('group'), copy);
    model.setInstanceDefinition(instanceId, def.id);
    return def;
  }

  // ------------------------------------------------------- group/component

  /**
   * Turns entities of the current context into a group or component and puts
   * an instance of it in their place. Call inside `run`. Returns the instance.
   */
  makeDefinition(kind: 'group' | 'component', faces: Id[], edges: Id[], instances: Id[]): Id {
    const ctx = this.context;
    const source = ctx.model;
    const geometry = new Model();
    const def = this.addDefinition(kind, this.defaultName(kind), geometry);

    geometry.edit(() => {
      copyBetweenModels(source, geometry, faces, edges, new THREE.Matrix4(), false);
      for (const id of instances) {
        const inst = source.instance(id);
        geometry.addInstance(inst.definition, new THREE.Matrix4().fromArray(inst.matrix));
      }
    });

    // Remove the originals; edges still used by remaining faces stay.
    const looseBefore = new Set(source.allEdges().filter((e) => source.facesOfEdge(e.id).length === 0 && !edges.includes(e.id)).map((e) => e.id));
    eraseFaces(source, faces);
    for (const id of instances) source.removeInstance(id);
    removeBareEdges(source, looseBefore);
    return source.addInstance(def.id, new THREE.Matrix4());
  }

  /** Replaces an instance in the current context by its contents. Call inside `run`. */
  explode(instanceId: Id): void {
    const target = this.context.model;
    const instance = target.instance(instanceId);
    const def = this.definition(instance.definition);
    const matrix = new THREE.Matrix4().fromArray(instance.matrix);
    target.removeInstance(instanceId);
    const src = def.model;
    copyBetweenModels(
      src,
      target,
      src.allFaces().map((f) => f.id),
      src.allEdges().map((e) => e.id),
      matrix,
      true,
    );
    for (const child of src.allInstances()) {
      target.addInstance(child.definition, matrix.clone().multiply(new THREE.Matrix4().fromArray(child.matrix)));
    }
  }

  /** World-space bounds of everything. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.placements()) {
      for (const v of p.model.allVertices()) box.expandByPoint(v.position.clone().applyMatrix4(p.matrix));
    }
    return box;
  }

  /**
   * All geometry flattened into one world-space model (for drawings).
   * Groups' faces are copied as they are; nothing is merged.
   */
  flatten(): Model {
    const flat = new Model();
    flat.edit(() => {
      for (const p of this.placements()) {
        copyBetweenModels(p.model, flat, p.model.allFaces().map((f) => f.id), p.model.allEdges().map((e) => e.id), p.matrix, false);
      }
    });
    return flat;
  }

  // ------------------------------------------------------------ file state

  /** Whether there are changes since the last save or load. */
  get dirty(): boolean {
    return this.restoredUnsaved || this.history.head !== this.savedHead;
  }

  markSaved(name: string, handle: FileSystemFileHandle | null): void {
    this.name = name;
    this.fileHandle = handle;
    this.savedHead = this.history.head;
    this.restoredUnsaved = false;
    this.changed.emit();
  }

  /** Definitions reachable from the root, for saving. */
  definitionsInUse(): DefinitionData[] {
    const used = new Set<number>();
    for (const p of this.placements()) if (p.definition) used.add(p.definition.id);
    return [...used]
      .sort((a, b) => a - b)
      .map((id) => {
        const d = this.definition(id);
        return { id, name: d.name, kind: d.kind, model: d.model.toData() };
      });
  }

  /** Replaces the document with loaded data. Clears undo history. */
  load(
    data: ModelData,
    name: string,
    handle: FileSystemFileHandle | null,
    options: { unsaved?: boolean; definitions?: DefinitionData[]; drawing?: DrawingSettings } = {},
  ): void {
    this.drawingSettings = structuredClone(options.drawing ?? DEFAULT_SETTINGS);
    this.definitions.clear();
    this.nextDefinitionId = 1;
    for (const d of options.definitions ?? []) {
      const model = new Model();
      model.load(d.model);
      this.addDefinition(d.kind, d.name, model, d.id);
    }
    this.contextPath = [];
    this.model.load(data);
    this.history.clear();
    this.markSaved(name, handle);
    if (options.unsaved) {
      this.restoredUnsaved = true;
      this.changed.emit();
    }
    this.contextChanged.emit();
    this.settingsChanged.emit();
    this.geometryChanged.emit();
  }

  /** Starts an empty document. */
  reset(): void {
    this.load({ nextId: 1, vertices: [], edges: [], faces: [], guides: [] }, UNTITLED, null);
  }
}
