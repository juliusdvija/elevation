import { Emitter } from '../core/emitter';
import type { Id, Model } from '../kernel/Model';

export type EntityRef = { kind: 'face' | 'edge'; id: Id };

export class Selection {
  readonly changed = new Emitter<void>();
  readonly faces = new Set<Id>();
  readonly edges = new Set<Id>();

  get empty(): boolean {
    return this.faces.size === 0 && this.edges.size === 0;
  }

  clear(): void {
    if (this.empty) return;
    this.faces.clear();
    this.edges.clear();
    this.changed.emit();
  }

  add(ref: EntityRef): void {
    this.set(ref).add(ref.id);
    this.changed.emit();
  }

  toggle(ref: EntityRef): void {
    const set = this.set(ref);
    if (set.has(ref.id)) set.delete(ref.id);
    else set.add(ref.id);
    this.changed.emit();
  }

  /** Forgets entities that no longer exist. */
  prune(model: Model): void {
    let changed = false;
    for (const id of this.faces) if (!model.hasFace(id)) changed = this.faces.delete(id);
    for (const id of this.edges) if (!model.hasEdge(id)) changed = this.edges.delete(id);
    if (changed) this.changed.emit();
  }

  private set(ref: EntityRef): Set<Id> {
    return ref.kind === 'face' ? this.faces : this.edges;
  }
}
