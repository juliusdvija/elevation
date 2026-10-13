import { Emitter } from '../core/emitter';
import type { Id, Model } from '../kernel/Model';

/** Something selectable in the model being edited. */
export type EntityRef = { kind: 'face' | 'edge' | 'instance'; id: Id } | { kind: 'dimension'; id: string };

export class Selection {
  readonly changed = new Emitter<void>();
  readonly faces = new Set<Id>();
  readonly edges = new Set<Id>();
  readonly instances = new Set<Id>();
  /** Dimensions are part of the document, not of a model; they are selected by their id. */
  readonly dimensions = new Set<string>();

  get empty(): boolean {
    return this.faces.size === 0 && this.edges.size === 0 && this.instances.size === 0 && this.dimensions.size === 0;
  }

  clear(): void {
    if (this.empty) return;
    this.faces.clear();
    this.edges.clear();
    this.instances.clear();
    this.dimensions.clear();
    this.changed.emit();
  }

  add(ref: EntityRef): void {
    (this.set(ref) as Set<Id | string>).add(ref.id);
    this.changed.emit();
  }

  /** Adds several entities with a single change event. */
  addAll(refs: EntityRef[]): void {
    if (refs.length === 0) return;
    for (const ref of refs) (this.set(ref) as Set<Id | string>).add(ref.id);
    this.changed.emit();
  }

  toggle(ref: EntityRef): void {
    const set = this.set(ref) as Set<Id | string>;
    if (set.has(ref.id)) set.delete(ref.id);
    else set.add(ref.id);
    this.changed.emit();
  }

  /** Forgets entities that no longer exist in the edited model. */
  prune(model: Model): void {
    let changed = false;
    for (const id of this.faces) if (!model.hasFace(id)) changed = this.faces.delete(id);
    for (const id of this.edges) if (!model.hasEdge(id)) changed = this.edges.delete(id);
    for (const id of this.instances) if (!model.hasInstance(id)) changed = this.instances.delete(id);
    if (changed) this.changed.emit();
  }

  /** Forgets dimensions that were deleted from the document. */
  pruneDimensions(existing: ReadonlySet<string>): void {
    let changed = false;
    for (const id of this.dimensions) if (!existing.has(id)) changed = this.dimensions.delete(id);
    if (changed) this.changed.emit();
  }

  private set(ref: EntityRef): Set<Id> | Set<string> {
    return ref.kind === 'face' ? this.faces : ref.kind === 'edge' ? this.edges : ref.kind === 'dimension' ? this.dimensions : this.instances;
  }
}
