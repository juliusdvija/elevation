import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import type { Id, ModelEdit } from '../kernel/Model';
import { closestBetweenSegments } from '../kernel/math';
import { pushPull } from '../kernel/pushPull';
import type { Tool, ToolContext } from './Tool';
import { GRID_SPACING } from './inference';
import { worldFacePlane } from './space';

const HINT_START = 'Click a face to push or pull it.';
const HINT_DRAG = 'Move to set the distance and click, or type a distance and press Enter.';

export function createPushPullTool(ctx: ToolContext): Tool {
  const model = () => ctx.doc.context.model;
  let face: { id: Id; anchor: THREE.Vector3; normal: THREE.Vector3; vertices: Set<Id> } | null = null;
  let preview: ModelEdit | null = null;
  let distance = 0;
  /** Unsnapped cursor distance: its sign is the direction a typed distance goes. */
  let direction = 1;

  const revertPreview = () => {
    preview?.revert();
    preview = null;
  };

  const reset = () => {
    revertPreview();
    ctx.feedback.clear();
    face = null;
    distance = 0;
    direction = 1;
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
    const m = model();
    const { edit } = m.edit(() => pushPull(m, face!.id, d));
    preview = edit.empty ? null : edit;
  };

  const commit = (d: number) => {
    if (!face) return;
    const id = face.id;
    revertPreview();
    const m = model();
    ctx.doc.run('Push/Pull', () => pushPull(m, id, d));
    reset();
  };

  /** A distance that puts the face on a world-grid plane, if one is near the cursor. */
  const gridDistance = (anchor: THREE.Vector3, normal: THREE.Vector3, raw: number, e: PointerEvent): number | null => {
    if (!ctx.inference.gridSnap) return null;
    const axis = (['x', 'y', 'z'] as const).find((a) => Math.abs(normal[a]) > 0.9999);
    if (!axis) return null;
    const position = anchor[axis] + normal[axis] * raw;
    const target = Math.round(position / GRID_SPACING) * GRID_SPACING;
    const d = (target - anchor[axis]) / normal[axis];
    const snapped = ctx.viewport.toScreen(anchor.clone().addScaledVector(normal, d));
    const step = ctx.viewport.toScreen(anchor.clone().addScaledVector(normal, d + GRID_SPACING));
    if (!snapped || !step || snapped.distanceTo(step) < 24) return null;
    return snapped.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 10 ? d : null;
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
        ctx.renderer.setHover(hit && ctx.picker.isContext(hit.placement) ? { faces: [hit.id], edges: [] } : null);
        return;
      }
      // Snap the distance to the height of an existing point (not the preview's own).
      const raw = distanceAt(e);
      if (Math.abs(raw) > 1e-6) direction = Math.sign(raw);
      const { anchor, normal, vertices } = face;
      const pick = ctx.picker.pick(e.clientX, e.clientY, {
        edges: false,
        vertexFilter: (v, placement) => !ctx.picker.isContext(placement) || vertices.has(v),
      });
      if (pick.kind === 'vertex' || pick.kind === 'origin' || pick.kind === 'guide-point' || pick.kind === 'intersection') {
        const d = pick.point.clone().sub(anchor).dot(normal);
        const onNormal = anchor.clone().addScaledVector(normal, d);
        ctx.feedback.show({ point: pick.point, kind: pick.kind, pick, guides: [{ from: pick.point, to: onNormal }] });
        showPreview(d);
      } else {
        // Land the face on a whole metre from the origin when its plane is axis-aligned.
        const grid = gridDistance(anchor, normal, raw, e);
        if (grid !== null) {
          const at = anchor.clone().addScaledVector(normal, grid);
          ctx.feedback.show({ point: at, kind: 'grid', label: 'Grid', pick, guides: [] });
          showPreview(grid);
        } else {
          ctx.feedback.clear();
          showPreview(raw);
        }
      }
    },

    pointerDown(e) {
      if (face) {
        commit(distance);
        return;
      }
      const hit = ctx.picker.face(e.clientX, e.clientY);
      // Only faces of the model being edited (not inside groups).
      if (!hit || !ctx.picker.isContext(hit.placement)) return;
      const m = model();
      const own = new Set(m.faceVertices(m.face(hit.id)));
      face = {
        id: hit.id,
        anchor: hit.point,
        normal: worldFacePlane(hit.placement, hit.id).normal,
        // Points to snap to: everything except the face itself, which moves.
        vertices: new Set(m.allVertices().map((v) => v.id).filter((v) => !own.has(v))),
      };
      ctx.renderer.setHover(null);
      ctx.setHint(HINT_DRAG);
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!face || length === null) return false;
      commit(direction * length);
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
