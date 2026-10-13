import { enclosedVolume } from './kernel/measure';
import { combineSolids, type SolidOp } from './kernel/solidOps';
import * as THREE from 'three';
import { Emitter } from './core/emitter';
import { History, type Operation, type Transaction } from './core/history';
import { Model, type Id, type ModelData, type ModelEdit } from './kernel/Model';
import { removeBareEdges, eraseFaces } from './kernel/cleanup';
import { copyBetweenModels } from './kernel/transform';
import { drawPolygon } from './kernel/draw';
import { figureOutline } from './kernel/figure';
import { DEFAULT_SETTINGS, type DrawingSettings, type SunSettings } from './drawing/settings';

const UNTITLED = 'Untitled';
const FIGURE_NAME = 'Scale figure';

/** A group or component: geometry with its own coordinates, placed by instances. */
export interface Definition {
  id: number;
  name: string;
  kind: 'group' | 'component';
  model: Model;
  /** Instances turn about the vertical axis to face the viewer (a scale figure). */
  faceMe?: boolean;
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
  faceMe?: boolean;
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
  /** The sun moved during an animation: only the 3D view and the sun panel follow; the drawings wait for `settingsChanged`. */
  readonly sunMoved = new Emitter<void>();
  /** A group or component was renamed. */
  readonly namesChanged = new Emitter<void>();
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

  private addDefinition(kind: 'group' | 'component', name: string, model: Model, id = this.nextDefinitionId++, faceMe = false): Definition {
    const definition: Definition = { id, name, kind, model, ...(faceMe ? { faceMe } : {}) };
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

  /** Renames a group or component as one undoable step. Blank names are ignored. */
  renameDefinition(id: number, name: string): void {
    const def = this.definition(id);
    const next = name.trim();
    if (!next || next === def.name) return;
    const before = def.name;
    this.history.transact('Rename', (tx) =>
      tx.run({
        apply: () => {
          def.name = next;
          this.namesChanged.emit();
        },
        revert: () => {
          def.name = before;
          this.namesChanged.emit();
        },
      }),
    );
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

  /**
   * Where the viewer's camera is, for face-me instances. Set by the viewport;
   * not saved. Null leaves them as stored.
   */
  private viewer: THREE.Vector3 | null = null;
  private faceMeSignature = '';

  /** Whether any definition turns its instances to face the viewer. */
  get hasFaceMe(): boolean {
    for (const d of this.definitions.values()) if (d.faceMe) return true;
    return false;
  }

  /** The matrix of an instance: as stored, or turned to face `viewer` when its definition asks. */
  private instanceMatrix(instance: { matrix: readonly number[] }, def: Definition, parent: THREE.Matrix4, viewer: THREE.Vector3 | null): THREE.Matrix4 {
    const stored = new THREE.Matrix4().fromArray(instance.matrix);
    if (!def.faceMe || !viewer) return stored;
    const position = new THREE.Vector3().setFromMatrixPosition(stored);
    const world = position.clone().applyMatrix4(parent);
    const dx = viewer.x - world.x;
    const dy = viewer.y - world.y;
    if (Math.hypot(dx, dy) < 1e-6) return stored;
    // Turn about the vertical in world space, whatever the parent's own turn.
    const parentYaw = Math.atan2(parent.elements[1], parent.elements[0]);
    const yaw = Math.atan2(-dx, dy) - parentYaw;
    const scale = new THREE.Vector3().setFromMatrixColumn(stored, 0).length();
    return new THREE.Matrix4()
      .makeRotationZ(yaw)
      .scale(new THREE.Vector3(scale, scale, scale))
      .setPosition(position);
  }

  /**
   * Tells the document where the camera is so face-me instances can turn
   * towards it. Returns true when something visibly turned.
   */
  setViewer(position: THREE.Vector3 | null): boolean {
    this.viewer = position ? position.clone() : null;
    if (!this.hasFaceMe) return false;
    const signature = this.placements()
      .filter((p) => p.definition?.faceMe)
      .map((p) => `${p.matrix.elements[0].toFixed(3)},${p.matrix.elements[1].toFixed(3)}`)
      .join(';');
    if (signature === this.faceMeSignature) return false;
    this.faceMeSignature = signature;
    this.geometryChanged.emit();
    return true;
  }

  /**
   * Every placed model in the world, starting with the root. Face-me
   * instances face `viewer`: the camera by default, or as stored with null.
   */
  placements(viewer: THREE.Vector3 | null | undefined = undefined): Placement[] {
    const eye = viewer === undefined ? this.viewer : viewer;
    const hidden = this.hiddenTags();
    const result: Placement[] = [];
    const visit = (model: Model, path: Id[], matrix: THREE.Matrix4, definition: Definition | undefined, seen: Set<number>) => {
      result.push({ model, path, matrix, inverse: matrix.clone().invert(), definition });
      for (const instance of model.allInstances()) {
        const def = this.definitions.get(instance.definition);
        if (!def || seen.has(def.id)) continue;
        // A hidden tag takes its instances (and what is inside them) out of sight: no drawing, picking or snapping.
        if (instance.tag && hidden.has(instance.tag)) continue;
        const m = matrix.clone().multiply(this.instanceMatrix(instance, def, matrix, eye));
        visit(def.model, [...path, instance.id], m, def, new Set([...seen, def.id]));
      }
    };
    visit(this.model, [], new THREE.Matrix4(), undefined, new Set());
    return result;
  }

  /** The ids of the tags that are switched off. */
  hiddenTags(): Set<string> {
    return new Set(this.drawingSettings.tags.filter((t) => !t.visible).map((t) => t.id));
  }

  /**
   * Shows or hides tags without an undo step (it is a view state, like the camera; scenes remember it).
   * `hidden` lists the tags to hide; every other tag is shown.
   */
  setHiddenTags(hidden: Iterable<string>): void {
    const off = new Set(hidden);
    const tags = this.drawingSettings.tags.map((t) => ({ ...t, visible: !off.has(t.id) }));
    if (tags.every((t, i) => t.visible === this.drawingSettings.tags[i].visible)) return;
    this.drawingSettings = { ...this.drawingSettings, tags };
    this.settingsChanged.emit();
    this.geometryChanged.emit();
  }

  /** Changes the 3D view's sun without an undo step (a view state, like the camera). */
  setSun(sun: SunSettings, live = false): void {
    this.drawingSettings = { ...this.drawingSettings, sun };
    (live ? this.sunMoved : this.settingsChanged).emit();
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
      matrix.multiply(this.instanceMatrix(instance, definition, matrix.clone(), this.viewer));
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
        geometry.addInstance(inst.definition, new THREE.Matrix4().fromArray(inst.matrix), inst.tag);
      }
    });

    // Remove the originals; edges still used by remaining faces stay.
    const looseBefore = new Set(source.allEdges().filter((e) => source.facesOfEdge(e.id).length === 0 && !edges.includes(e.id)).map((e) => e.id));
    eraseFaces(source, faces);
    for (const id of instances) source.removeInstance(id);
    removeBareEdges(source, looseBefore);
    return source.addInstance(def.id, new THREE.Matrix4());
  }

  /**
   * Puts a finished model (e.g. an imported file) into the current context as a new group.
   * Call inside `run`. Returns the instance.
   */
  addGroupFromModel(model: Model, name: string, kind: 'group' | 'component' = 'group'): Id {
    const def = this.addDefinition(kind, name, model);
    return this.context.model.addInstance(def.id, new THREE.Matrix4());
  }

  /**
   * Puts a scale figure (a flat person, shared component) into the current
   * context. `world` places it in world space. Call inside `run`. Returns the instance.
   */
  placeFigure(world: THREE.Matrix4): Id {
    let def = [...this.definitions.values()].find((d) => d.kind === 'component' && d.name === FIGURE_NAME);
    if (!def) {
      const geometry = new Model();
      geometry.edit(() => drawPolygon(geometry, figureOutline()));
      def = this.addDefinition('component', FIGURE_NAME, geometry, undefined, true);
    }
    const ctx = this.context;
    return ctx.model.addInstance(def.id, world.clone().premultiply(ctx.inverse));
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
      target.addInstance(child.definition, matrix.clone().multiply(new THREE.Matrix4().fromArray(child.matrix)), child.tag);
    }
  }

  /**
   * World-space bounds and enclosed volume of a group or component in the edited model, with everything
   * inside it. The volume is null when some geometry in it is not a closed solid.
   */
  instanceStats(instanceId: Id): { bounds: THREE.Box3; volume: number | null } {
    const prefix = [...this.contextPath, instanceId];
    const bounds = new THREE.Box3();
    let volume: number | null = 0;
    for (const p of this.placements()) {
      if (p.path.length < prefix.length || !prefix.every((id, i) => p.path[i] === id)) continue;
      for (const v of p.model.allVertices()) bounds.expandByPoint(v.position.clone().applyMatrix4(p.matrix));
      const faces = p.model.allFaces().map((f) => f.id);
      if (faces.length === 0) continue;
      const enclosed = enclosedVolume(p.model, faces);
      volume = enclosed === null || volume === null ? null : volume + enclosed * Math.abs(p.matrix.determinant());
    }
    return { bounds, volume };
  }

  /** A group or component of the edited model, with everything inside it, as one model in the edited model's coordinates. */
  flattenInstance(instanceId: Id): Model {
    const prefix = [...this.contextPath, instanceId];
    const into = new Model();
    const toContext = this.context.inverse;
    into.edit(() => {
      for (const p of this.placements()) {
        if (p.path.length < prefix.length || !prefix.every((id, i) => p.path[i] === id)) continue;
        copyBetweenModels(p.model, into, p.model.allFaces().map((f) => f.id), p.model.allEdges().map((e) => e.id), toContext.clone().multiply(p.matrix), false);
      }
    });
    return into;
  }

  /**
   * Combines two groups or components of the edited model with a solid operation (the first is the one kept in a
   * subtraction) into a new group. Call inside `run`. Returns the new instance, or the reason it could not be done.
   */
  combineInstances(op: SolidOp, firstId: Id, secondId: Id): { instance: Id } | { error: string } {
    const model = this.context.model;
    if (!model.hasInstance(firstId) || !model.hasInstance(secondId)) return { error: 'Select two groups or components.' };
    const a = this.flattenInstance(firstId);
    const b = this.flattenInstance(secondId);
    const solid = (m: Model) => m.faceCount > 0 && enclosedVolume(m, m.allFaces().map((f) => f.id)) !== null;
    if (!solid(a) || !solid(b)) return { error: 'Both must be closed solids (no holes in their surface).' };
    const result = combineSolids(a, b, op);
    if (result.faceCount === 0) return { error: op === 'intersect' ? 'They do not overlap.' : 'Nothing is left.' };
    const tag = model.instance(firstId).tag;
    const names = { union: 'Union', subtract: 'Difference', intersect: 'Intersection' } as const;
    model.removeInstance(firstId);
    model.removeInstance(secondId);
    const def = this.addDefinition('group', names[op], result);
    return { instance: model.addInstance(def.id, new THREE.Matrix4(), tag) };
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
   * Groups' faces are copied as they are; nothing is merged. Face-me
   * instances face `viewer`, or stay as stored.
   */
  flatten(viewer: THREE.Vector3 | null = null): Model {
    const flat = new Model();
    flat.edit(() => {
      for (const p of this.placements(viewer)) {
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
        return { id, name: d.name, kind: d.kind, model: d.model.toData(), ...(d.faceMe ? { faceMe: true } : {}) };
      });
  }

  /** Replaces the document with loaded data. Clears undo history. */
  load(
    data: ModelData,
    name: string,
    handle: FileSystemFileHandle | null,
    options: { unsaved?: boolean; definitions?: DefinitionData[]; drawing?: DrawingSettings } = {},
  ): void {
    this.drawingSettings = { ...structuredClone(DEFAULT_SETTINGS), ...structuredClone(options.drawing ?? {}) };
    this.definitions.clear();
    this.nextDefinitionId = 1;
    for (const d of options.definitions ?? []) {
      const model = new Model();
      model.load(d.model);
      this.addDefinition(d.kind, d.name, model, d.id, d.faceMe);
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

  /** Starts a new document: empty but for a scale figure standing on the origin. */
  reset(): void {
    this.load({ nextId: 1, vertices: [], edges: [], faces: [], guides: [] }, UNTITLED, null);
    this.addDefaultFigure();
  }

  /** Puts a scale figure on the origin without making an undo step or marking the file changed. */
  addDefaultFigure(): void {
    this.run('Scale Figure', () => this.placeFigure(new THREE.Matrix4()));
    this.history.clear();
    this.savedHead = this.history.head;
    this.geometryChanged.emit();
    this.changed.emit();
  }
}
