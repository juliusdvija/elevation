import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { drawPolygon } from '../kernel/draw';
import type { Id } from '../kernel/Model';
import { EPS, planeFrame, pointInPolygon, projectOnSegment, to2D } from '../kernel/math';
import { offsetPolygon } from '../kernel/shapes';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';
import { space } from './space';

const HINT_START = 'Click a face to offset its outline.';
const HINT_DRAG = 'Move inwards or outwards and click, or type a distance.';

export function createOffsetTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  let face: { id: Id; outline: THREE.Vector3[]; normal: THREE.Vector3 } | null = null;
  let distance = 0;

  const reset = () => {
    face = null;
    distance = 0;
    preview.clear();
    ctx.renderer.setHover(null);
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  const commit = (d: number) => {
    if (!face || Math.abs(d) < EPS) return;
    const points = offsetPolygon(face.outline, face.normal, d);
    const s = space(ctx);
    ctx.doc.run('Offset', () => drawPolygon(s.model, points.map(s.toLocal)));
    reset();
  };

  /** Signed distance from the cursor to the outline: positive inside the face. */
  const distanceAt = (e: PointerEvent): number | null => {
    const { outline, normal } = face!;
    const plane = new THREE.Plane(normal.clone(), -normal.dot(outline[0]));
    const p = ctx.viewport.ray(e.clientX, e.clientY).intersectPlane(plane, new THREE.Vector3());
    if (!p) return null;
    let nearest = Infinity;
    outline.forEach((a, i) => {
      nearest = Math.min(nearest, projectOnSegment(p, a, outline[(i + 1) % outline.length]).distance);
    });
    const frame = planeFrame({ normal, d: normal.dot(outline[0]) });
    const inside = pointInPolygon(to2D(frame, p), outline.map((q) => to2D(frame, q)));
    return inside ? nearest : -nearest;
  };

  return {
    id: 'offset',
    label: 'Offset',
    shortcut: 'F',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!face) {
        const hit = ctx.picker.face(e.clientX, e.clientY);
        ctx.renderer.setHover(hit && ctx.picker.isContext(hit.placement) ? { faces: [hit.id], edges: [] } : null);
        return;
      }
      const d = distanceAt(e);
      if (d === null) return;
      distance = d;
      const pts = offsetPolygon(face.outline, face.normal, d);
      preview.set(pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as [THREE.Vector3, THREE.Vector3]));
      ctx.setMeasurement(formatLength(Math.abs(d)));
    },

    pointerDown(e) {
      if (face) {
        commit(distance);
        return;
      }
      const hit = ctx.picker.face(e.clientX, e.clientY);
      if (!hit || !ctx.picker.isContext(hit.placement)) return;
      const s = space(ctx);
      const model = s.model;
      const f = model.face(hit.id);
      face = { id: f.id, outline: f.outer.map((v) => s.toWorld(model.position(v))), normal: s.vectorToWorld(f.normal).normalize() };
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
    deactivate: reset,
  };
}
