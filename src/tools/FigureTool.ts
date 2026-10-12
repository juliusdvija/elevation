import * as THREE from 'three';
import { figureMatrix, figureOutline } from '../kernel/figure';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';

const HINT = 'Click to stand a scale figure (1.78 m) on the ground or a face. It turns to face you; Move and Rotate adjust it.';

/** Scale Figure: places a flat person to judge sizes by, like SketchUp's. */
export function createFigureTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  const { inference, feedback, doc } = ctx;
  const outline = figureOutline();

  /** Where the figure stands and how it is turned, for a pointer position. */
  const placement = (e: PointerEvent) => {
    const p = inference.infer(e, null);
    feedback.show(p);
    if (!p) return null;
    return figureMatrix(p.point, ctx.viewport.rig.camera.position);
  };

  const clear = () => {
    preview.clear();
    feedback.clear();
    inference.release();
  };

  return {
    id: 'figure',
    label: 'Scale Figure',
    shortcut: 'N',
    hint: HINT,
    cursor: 'crosshair',

    pointerMove(e) {
      const matrix = placement(e);
      if (!matrix) return preview.clear();
      const pts = outline.map((q) => q.clone().applyMatrix4(matrix));
      preview.set(pts.map((q, i) => [q, pts[(i + 1) % pts.length]] as [THREE.Vector3, THREE.Vector3]));
    },

    pointerDown(e) {
      const matrix = placement(e);
      if (!matrix) return;
      const id = doc.run('Scale Figure', () => doc.placeFigure(matrix));
      ctx.selection.clear();
      ctx.selection.add({ kind: 'instance', id });
      clear();
    },

    keyDown(e) {
      if (e.key === 'Escape') {
        clear();
        return true;
      }
      return false;
    },

    cancel: clear,
    deactivate: clear,
  };
}
