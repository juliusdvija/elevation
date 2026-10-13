import { eraseEdges } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import { deleteDimensions, dimensionAt } from './dimensionPick';
import type { Tool, ToolContext } from './Tool';

export function createEraserTool(ctx: ToolContext): Tool {
  const marked = { edges: new Set<Id>(), guides: new Set<Id>(), dimensions: new Set<string>() };
  let dragging = false;

  type Target = { kind: 'edges' | 'guides'; id: Id } | { kind: 'dimensions'; id: string };
  const targetAt = (e: PointerEvent): Target | null => {
    const dimension = dimensionAt(ctx, e.clientX, e.clientY);
    if (dimension) return { kind: 'dimensions', id: dimension };
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false });
    if ((pick.kind === 'edge' || pick.kind === 'midpoint') && ctx.picker.isContext(pick.placement)) return { kind: 'edges', id: pick.id };
    if (pick.kind === 'guide' || pick.kind === 'guide-point') return { kind: 'guides', id: pick.id };
    return null;
  };

  const show = (hovered: Target | null) => {
    const edges = new Set(marked.edges);
    const guides = new Set(marked.guides);
    const dimensions = new Set(marked.dimensions);
    if (hovered?.kind === 'edges') edges.add(hovered.id);
    else if (hovered?.kind === 'guides') guides.add(hovered.id);
    else if (hovered?.kind === 'dimensions') dimensions.add(hovered.id);
    ctx.renderer.setHover({ faces: [], edges, guides });
    ctx.viewport.setDimensionHighlight(dimensions, null);
  };

  const clear = () => {
    marked.edges.clear();
    marked.guides.clear();
    marked.dimensions.clear();
  };

  return {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    hint: 'Click or drag over edges, guides and dimensions to erase them. Edges between flat faces merge the faces.',
    cursor: 'crosshair',

    pointerDown(e) {
      dragging = true;
      const target = targetAt(e);
      if (target) (marked[target.kind] as Set<Id | string>).add(target.id);
      show(target);
    },

    pointerMove(e) {
      const target = targetAt(e);
      if (dragging && target) (marked[target.kind] as Set<Id | string>).add(target.id);
      show(target);
    },

    pointerUp() {
      dragging = false;
      const edges = [...marked.edges];
      const guides = [...marked.guides];
      const dimensions = [...marked.dimensions];
      if (dimensions.length > 0) deleteDimensions(ctx, dimensions);
      if (edges.length + guides.length > 0) {
        const root = ctx.doc.model;
        const model = ctx.doc.context.model;
        ctx.doc.run('Erase', () => {
          for (const id of guides) root.removeGuide(id);
          eraseEdges(model, edges);
        });
      }
      clear();
      ctx.renderer.setHover(null);
      ctx.viewport.setDimensionHighlight([], null);
    },

    cancel() {
      dragging = false;
      clear();
      ctx.renderer.setHover(null);
      ctx.viewport.setDimensionHighlight([], null);
    },
    deactivate() {
      this.cancel?.();
    },
  };
}
