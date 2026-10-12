import { eraseEdges } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

export function createEraserTool(ctx: ToolContext): Tool {
  const marked = new Set<Id>();
  let dragging = false;

  const edgeAt = (e: PointerEvent): Id | null => {
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false });
    return pick.kind === 'edge' || pick.kind === 'midpoint' ? pick.id : null;
  };

  const show = (hovered: Id | null) => {
    const edges = new Set(marked);
    if (hovered !== null) edges.add(hovered);
    ctx.renderer.setHover({ faces: [], edges });
  };

  return {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    hint: 'Click or drag over edges to erase them. Edges between flat faces merge the faces.',
    cursor: 'crosshair',

    pointerDown(e) {
      dragging = true;
      const edge = edgeAt(e);
      if (edge !== null) marked.add(edge);
      show(edge);
    },

    pointerMove(e) {
      const edge = edgeAt(e);
      if (dragging && edge !== null) marked.add(edge);
      show(edge);
    },

    pointerUp() {
      dragging = false;
      if (marked.size > 0) {
        const edges = [...marked];
        ctx.doc.run('Erase', () => eraseEdges(ctx.doc.model, edges));
      }
      marked.clear();
      ctx.renderer.setHover(null);
    },

    cancel() {
      dragging = false;
      marked.clear();
      ctx.renderer.setHover(null);
    },
    deactivate() {
      this.cancel?.();
    },
  };
}
