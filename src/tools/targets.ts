import type { Id } from '../kernel/Model';
import { verticesOf } from '../kernel/transform';
import type { Highlight } from '../viewport/ModelRenderer';
import type { ToolContext } from './Tool';

/** What Move and Rotate act on: faces and edges (copied or moved) and loose vertices (moved). */
export interface Targets {
  faces: Id[];
  edges: Id[];
  vertices: Id[];
}

/** The selection, or else whatever is under the cursor (like SketchUp's hover-select). */
export function targetsAt(ctx: ToolContext, e: PointerEvent): Targets | null {
  const { selection } = ctx;
  if (!selection.empty) return { faces: [...selection.faces], edges: [...selection.edges], vertices: [] };
  const pick = ctx.picker.pick(e.clientX, e.clientY, { guides: false });
  if (pick.kind === 'vertex') return { faces: [], edges: [], vertices: [pick.id] };
  if (pick.kind === 'edge' || pick.kind === 'midpoint') return { faces: [], edges: [pick.id], vertices: [] };
  if (pick.kind === 'face') return { faces: [pick.id], edges: [], vertices: [] };
  return null;
}

export function targetVertices(ctx: ToolContext, targets: Targets): Id[] {
  return [...verticesOf(ctx.doc.model, targets.faces, targets.edges), ...targets.vertices];
}

export function highlightOf(targets: Targets | null): Highlight | null {
  return targets && { faces: targets.faces, edges: targets.edges };
}
