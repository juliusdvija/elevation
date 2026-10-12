import type { Id } from '../kernel/Model';
import { verticesOf } from '../kernel/transform';
import type { Highlight } from '../viewport/ModelRenderer';
import type { Pick } from './Picker';
import type { EntityRef } from './Selection';
import type { ToolContext } from './Tool';

/**
 * What Move and Rotate act on, in the model being edited: faces and edges
 * (copied or moved), loose vertices (moved) and group/component instances.
 */
export interface Targets {
  faces: Id[];
  edges: Id[];
  vertices: Id[];
  instances: Id[];
}

/** The selectable entity a pick lands on: an entity of the edited model, or a group in it. */
export function entityOf(ctx: ToolContext, pick: Pick): EntityRef | null {
  if (pick.kind !== 'edge' && pick.kind !== 'midpoint' && pick.kind !== 'face' && pick.kind !== 'vertex') return null;
  const instance = ctx.picker.childInstance(pick.placement);
  if (instance !== undefined) return { kind: 'instance', id: instance };
  if (!ctx.picker.isContext(pick.placement)) return null;
  if (pick.kind === 'face') return { kind: 'face', id: pick.id };
  if (pick.kind === 'edge' || pick.kind === 'midpoint') return { kind: 'edge', id: pick.id };
  return null;
}

/** The selection, or else whatever is under the cursor (like SketchUp's hover-select). */
export function targetsAt(ctx: ToolContext, e: PointerEvent): Targets | null {
  const { selection } = ctx;
  if (!selection.empty) return { faces: [...selection.faces], edges: [...selection.edges], vertices: [], instances: [...selection.instances] };
  const pick = ctx.picker.pick(e.clientX, e.clientY, { guides: false });
  if (pick.kind === 'vertex' && ctx.picker.isContext(pick.placement)) return { faces: [], edges: [], vertices: [pick.id], instances: [] };
  const ref = entityOf(ctx, pick);
  if (!ref) return null;
  return {
    faces: ref.kind === 'face' ? [ref.id] : [],
    edges: ref.kind === 'edge' ? [ref.id] : [],
    vertices: [],
    instances: ref.kind === 'instance' ? [ref.id] : [],
  };
}

export function targetVertices(ctx: ToolContext, targets: Targets): Id[] {
  return [...verticesOf(ctx.doc.context.model, targets.faces, targets.edges), ...targets.vertices];
}

export function highlightOf(targets: Targets | null): Highlight | null {
  return targets && { faces: targets.faces, edges: targets.edges, instances: targets.instances };
}
