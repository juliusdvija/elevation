import { eraseEdges, eraseFaces } from '../kernel/cleanup';
import type { EntityRef } from './Selection';
import type { Tool, ToolContext } from './Tool';

export function createSelectTool(ctx: ToolContext): Tool {
  const entityAt = (e: PointerEvent): EntityRef | null => {
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false });
    if (pick.kind === 'edge' || pick.kind === 'midpoint') return { kind: 'edge', id: pick.id };
    if (pick.kind === 'face') return { kind: 'face', id: pick.id };
    return null;
  };

  return {
    id: 'select',
    label: 'Select',
    shortcut: 'Space',
    hint: 'Click to select, Shift-click to add or remove. Delete erases the selection.',
    cursor: 'default',

    pointerMove(e) {
      if (e.buttons !== 0) return;
      const ref = entityAt(e);
      ctx.renderer.setHover(ref && { faces: ref.kind === 'face' ? [ref.id] : [], edges: ref.kind === 'edge' ? [ref.id] : [] });
    },

    pointerDown(e) {
      const ref = entityAt(e);
      if (!e.shiftKey) ctx.selection.clear();
      if (!ref) return;
      if (e.shiftKey) ctx.selection.toggle(ref);
      else ctx.selection.add(ref);
    },

    keyDown(e) {
      if (e.key === 'Escape') {
        ctx.selection.clear();
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !ctx.selection.empty) {
        const { faces, edges } = ctx.selection;
        ctx.doc.run('Erase', () => {
          eraseFaces(ctx.doc.model, [...faces]);
          eraseEdges(ctx.doc.model, [...edges]);
        });
        ctx.selection.clear();
        return true;
      }
      return false;
    },

    deactivate() {
      ctx.renderer.setHover(null);
    },
  };
}
