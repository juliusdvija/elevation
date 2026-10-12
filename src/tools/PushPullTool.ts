import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import type { Id, ModelEdit } from '../kernel/Model';
import { closestBetweenSegments } from '../kernel/math';
import { pushPull } from '../kernel/pushPull';
import type { Tool, ToolContext } from './Tool';

const HINT_START = 'Click a face to push or pull it.';
const HINT_DRAG = 'Move to set the distance and click, or type a distance and press Enter.';

export function createPushPullTool(ctx: ToolContext): Tool {
  const model = ctx.doc.model;
  let face: { id: Id; anchor: THREE.Vector3; normal: THREE.Vector3 } | null = null;
  let preview: ModelEdit | null = null;
  let distance = 0;

  const revertPreview = () => {
    preview?.revert();
    preview = null;
  };

  const reset = () => {
    revertPreview();
    face = null;
    distance = 0;
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  /** Distance along the face normal to the point on the normal line nearest the cursor. */
  const distanceAt = (e: PointerEvent): number => {
    const { anchor, normal } = face!;
    const ray = ctx.viewport.ray(e.clientX, e.clientY);
    const far = ray.origin.clone().addScaledVector(ray.direction, 1e8);
    const a = anchor.clone().addScaledVector(normal, -1e7);
    const b = anchor.clone().addScaledVector(normal, 1e7);
    const { s } = closestBetweenSegments(a, b, ray.origin, far);
    return a.lerp(b, s).sub(anchor).dot(normal);
  };

  const showPreview = (d: number) => {
    revertPreview();
    distance = d;
    ctx.setMeasurement(formatLength(Math.abs(d)));
    const { edit } = model.edit(() => pushPull(model, face!.id, d));
    preview = edit.empty ? null : edit;
  };

  const commit = (d: number) => {
    if (!face) return;
    const id = face.id;
    revertPreview();
    ctx.doc.run('Push/Pull', () => pushPull(model, id, d));
    reset();
  };

  return {
    id: 'pushpull',
    label: 'Push/Pull',
    shortcut: 'P',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!face) {
        const hit = ctx.picker.face(e.clientX, e.clientY);
        ctx.renderer.setHover(hit && { faces: [hit.id], edges: [] });
        return;
      }
      showPreview(distanceAt(e));
    },

    pointerDown(e) {
      if (face) {
        commit(distance);
        return;
      }
      const hit = ctx.picker.face(e.clientX, e.clientY);
      if (!hit) return;
      face = { id: hit.id, anchor: hit.point, normal: model.face(hit.id).normal.clone() };
      ctx.renderer.setHover(null);
      ctx.setHint(HINT_DRAG);
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!face || length === null) return false;
      commit(distance < 0 ? -length : length);
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && face) {
        reset();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate() {
      reset();
      ctx.renderer.setHover(null);
    },
  };
}
