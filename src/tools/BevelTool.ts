import { formatLength, parseLength } from '../core/units';
import { bevelEdges } from '../kernel/bevel';
import type { Id } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

const HINT = 'Click edges to select them (or select first), type a size and press Enter. Tab switches between Round and Chamfer.';

/**
 * Round or chamfer edges. Click edges to add them to the selection (click again to remove), type a size and
 * press Enter: the size is the radius for a round, the cut-back along both faces for a chamfer.
 */
export function createBevelTool(ctx: ToolContext): Tool {
  let round = true;
  let size = 2;

  const status = () => ctx.setMeasurement(`${round ? 'Round' : 'Chamfer'} ${formatLength(size)}`);

  const edgeAt = (e: PointerEvent): Id | null => {
    const pick = ctx.picker.pick(e.clientX, e.clientY, { vertices: false, guides: false });
    return (pick.kind === 'edge' || pick.kind === 'midpoint') && ctx.picker.isContext(pick.placement) ? pick.id : null;
  };

  const show = () => ctx.renderer.setHover({ faces: [], edges: [...ctx.selection.edges] });

  return {
    id: 'bevel',
    label: 'Round / Chamfer',
    shortcut: 'V',
    hint: HINT,
    cursor: 'crosshair',

    activate() {
      status();
      show();
    },

    pointerMove(e) {
      const id = edgeAt(e);
      ctx.renderer.setHover({ faces: [], edges: id === null ? [...ctx.selection.edges] : [...ctx.selection.edges, id] });
    },

    pointerDown(e) {
      const id = edgeAt(e);
      if (id === null) return;
      ctx.selection.toggle({ kind: 'edge', id });
      show();
    },

    onMeasurement(text) {
      const value = parseLength(text);
      if (value === null || value <= 0) return false;
      size = value;
      const edges = [...ctx.selection.edges];
      if (edges.length === 0) {
        ctx.setHint('Select the edges to round or chamfer first.');
        status();
        return true;
      }
      const model = ctx.doc.context.model;
      let done = 0;
      ctx.doc.run(round ? 'Round Edges' : 'Chamfer Edges', () => {
        done = bevelEdges(model, edges, { size, round });
      });
      ctx.selection.clear();
      ctx.renderer.setHover(null);
      ctx.setHint(done > 0 ? `${round ? 'Rounded' : 'Chamfered'} ${done} edge${done > 1 ? 's' : ''}. ${HINT}` : 'Nothing changed: those edges are flat, or the size does not fit.');
      status();
      return true;
    },

    keyDown(e) {
      if (e.key === 'Tab') {
        round = !round;
        status();
        return true;
      }
      return false;
    },

    cancel() {
      ctx.renderer.setHover(null);
    },
    deactivate() {
      ctx.renderer.setHover(null);
    },
  };
}
