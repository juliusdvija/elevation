import { chainEdges, followMe } from '../kernel/followMe';
import { faceInteriorPoint } from '../kernel/faces';
import type { Id, ModelEdit } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Select the path edges first (Select tool), then click the profile face that touches the path.';
const HINT_READY = 'Click to sweep this face along the selected path.';
const HINT_BLOCKED = 'That path does not work for this face (it must form one chain), or it would leave the solid open.';

/**
 * Follow Me: sweeps a face along the selected edges. Hovering a face previews the result; clicking applies it.
 * The path is whatever edges are selected; the face must touch one end of an open path, or any corner of a loop.
 */
export function createFollowMeTool(ctx: ToolContext): Tool {
  const model = () => ctx.doc.context.model;
  let preview: ModelEdit | null = null;
  let previewFor: Id | null = null;

  const revertPreview = () => {
    preview?.revert();
    preview = null;
    previewFor = null;
  };

  const faceAt = (e: PointerEvent): Id | null => {
    const hit = ctx.picker.face(e.clientX, e.clientY);
    return hit && ctx.picker.isContext(hit.placement) ? hit.id : null;
  };

  /** The sweep of `faceId` along the selected edges, in the open edit. Returns whether it worked. */
  const sweep = (faceId: Id): boolean => {
    const m = model();
    const face = m.face(faceId);
    const own = new Set(m.faceEdges(face));
    const edges = [...ctx.selection.edges].filter((e) => !own.has(e));
    const centre = faceInteriorPoint(m, face) ?? m.position(face.outer[0]);
    const chain = chainEdges(m, edges, centre);
    return !!chain && followMe(m, faceId, chain.vertices, chain.closed);
  };

  return {
    id: 'followme',
    label: 'Follow Me',
    shortcut: 'W',
    hint: HINT_START,
    cursor: 'crosshair',

    activate() {
      ctx.setHint(ctx.selection.edges.size > 0 ? HINT_READY : HINT_START);
    },

    pointerMove(e) {
      const id = faceAt(e);
      if (id === previewFor) return;
      revertPreview();
      ctx.renderer.setHover(id === null ? null : { faces: [id], edges: [] });
      if (id === null || ctx.selection.edges.size === 0) return;
      const m = model();
      const { result, edit } = m.edit(() => sweep(id));
      preview = edit.empty ? null : edit;
      previewFor = id;
      ctx.setHint(result ? HINT_READY : HINT_BLOCKED);
    },

    pointerDown(e) {
      const id = faceAt(e);
      if (id === null) return;
      revertPreview();
      if (ctx.selection.edges.size === 0) {
        ctx.setHint(HINT_START);
        return;
      }
      let applied = false;
      ctx.doc.run('Follow Me', () => {
        applied = sweep(id);
      });
      ctx.renderer.setHover(null);
      ctx.setHint(applied ? 'Done. Click another face, or choose a different tool.' : HINT_BLOCKED);
    },

    cancel() {
      revertPreview();
      ctx.renderer.setHover(null);
    },
    deactivate() {
      revertPreview();
      ctx.renderer.setHover(null);
    },
  };
}
