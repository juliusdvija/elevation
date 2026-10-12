import { Emitter } from '../core/emitter';
import type { Id, Model } from '../kernel/Model';

/** Something selectable in the model being edited. */
export type EntityRef = { kind: 'face' | 'edge' | 'instance'; id: Id };

export class Selection {
  readonly changed = new Emitter<void>();
  readonly faces = new Set<Id>();
  readonly edges = new Set<Id>();
  readonly instances = new Set<Id>();

  get empty(): boolean {
    return this.faces.size === 0 && this.edges.size === 0 && this.instances.size === 0;
  }

  clear(): void {
    if (this.empty) return;
    this.faces.clear();
    this.edges.clear();
    this.instances.clear();
    this.changed.emit();
  }

  add(ref: EntityRef): void {
    this.set(ref).add(ref.id);
    this.changed.emit();
  }

  /** Adds several entities with a single change event. */
  addAll(refs: EntityRef[]): void {
    if (refs.length === 0) return;
    for (const ref of refs) this.set(ref).add(ref.id);
    this.changed.emit();
  }

  toggle(ref: EntityRef): void {
    const set = this.set(ref);
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

  private set(ref: EntityRef): Set<Id> {
    return ref.kind === 'face' ? this.faces : ref.kind === 'edge' ? this.edges : this.instances;
  }
}
