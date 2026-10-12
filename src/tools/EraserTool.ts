import { eraseEdges } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

export function createEraserTool(ctx: ToolContext): Tool {
  const marked = { edges: new Set<Id>(), guides: new Set<Id>() };
  let dragging = false;

  type Target = { kind: 'edges' | 'guides'; id: Id };
  const targetAt = (e: PointerEvent): Target | null => {
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false });
    if (pick.kind === 'edge' || pick.kind === 'midpoint') return { kind: 'edges', id: pick.id };
    if (pick.kind === 'guide' || pick.kind === 'guide-point') return { kind: 'guides', id: pick.id };
    return null;
  };

  const show = (hovered: Target | null) => {
    const edges = new Set(marked.edges);
    const guides = new Set(marked.guides);
    if (hovered) (hovered.kind === 'edges' ? edges : guides).add(hovered.id);
    ctx.renderer.setHover({ faces: [], edges, guides });
  };

  const clear = () => {
    marked.edges.clear();
    marked.guides.clear();
  };

  return {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    hint: 'Click or drag over edges and guides to erase them. Edges between flat faces merge the faces.',
    cursor: 'crosshair',

    pointerDown(e) {
      dragging = true;
      const target = targetAt(e);
      if (target) marked[target.kind].add(target.id);
      show(target);
    },

    pointerMove(e) {
      const target = targetAt(e);
      if (dragging && target) marked[target.kind].add(target.id);
      show(target);
    },

    pointerUp() {
      dragging = false;
      const edges = [...marked.edges];
      const guides = [...marked.guides];
      if (edges.length + guides.length > 0) {
        const model = ctx.doc.model;
        ctx.doc.run('Erase', () => {
          for (const id of guides) model.removeGuide(id);
          eraseEdges(model, edges);
        });
      }
      clear();
      ctx.renderer.setHover(null);
    },

    cancel() {
      dragging = false;
      clear();
      ctx.renderer.setHover(null);
    },
    deactivate() {
      this.cancel?.();
    },
  };
}
