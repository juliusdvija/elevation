import * as THREE from 'three';
import { dimensionOffset, dimensionShape } from '../drawing/dimensions';
import { parseLength, formatLength } from '../core/units';
import { EPS } from '../kernel/math';
import { closestOnLineToRay } from './lines';
import { kindColor, type InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';

const HINT_FIRST = 'Click the first point to measure from. Delete removes the dimension under the cursor.';
const HINT_SECOND = 'Click the second point.';
const HINT_OFFSET = 'Move to place the dimension line and click, or type its distance and press Enter.';

/**
 * Dimension: two points and an offset. The dimension lives in the document,
 * shows in 3D and is drawn on every plan, elevation and section it is parallel to.
 */
export function createDimensionTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  const { inference, feedback, doc } = ctx;

  let a: THREE.Vector3 | null = null;
  let b: THREE.Vector3 | null = null;
  let offset = new THREE.Vector3();

  const reset = () => {
    a = b = null;
    offset = new THREE.Vector3();
    inference.release();
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_FIRST);
  };

  const place = (off: THREE.Vector3) => {
    if (!a || !b || off.length() < EPS) return false;
    const next = structuredClone(doc.drawingSettings);
    const used = new Set(next.dimensions.map((d) => d.id));
    let n = next.dimensions.length + 1;
    while (used.has(`dim-${n}`)) n++;
    next.dimensions.push({ id: `dim-${n}`, a: a.toArray(), b: b.toArray(), offset: off.toArray() });
    doc.updateDrawingSettings('Dimension', next);
    reset();
    return true;
  };

  const showShape = (off: THREE.Vector3, color: number) => {
    if (!a || !b) return;
    const s = dimensionShape({ id: '', a: a.toArray(), b: b.toArray(), offset: off.toArray() });
    preview.set(
      [
        [s.a, s.a2],
        [s.b, s.b2],
        [s.a2, s.b2],
      ],
      color,
    );
  };

  /** Dimension offset under the cursor: the cursor's distance from the measured line, kept perpendicular. */
  const offsetAt = (e: PointerEvent): THREE.Vector3 => {
    const p: InferredPoint | null = inference.infer(e, null);
    feedback.show(p);
    const through = p?.point ?? closestOnLineToRay({ point: a!, direction: b!.clone().sub(a!).normalize() }, ctx.viewport.ray(e.clientX, e.clientY));
    return dimensionOffset(a!, b!, through);
  };

  /** The dimension whose line is closest to the cursor, within a few pixels. */
  const nearest = (e: PointerEvent | { clientX: number; clientY: number }): string | null => {
    const cursor = new THREE.Vector2(e.clientX, e.clientY);
    let best: string | null = null;
    let bestDist = 12;
    for (const d of doc.drawingSettings.dimensions) {
      const s = dimensionShape(d);
      const p = ctx.viewport.toScreen(s.a2);
      const q = ctx.viewport.toScreen(s.b2);
      if (!p || !q) continue;
      const seg = new THREE.Line3(new THREE.Vector3(p.x, p.y, 0), new THREE.Vector3(q.x, q.y, 0));
      const at = seg.closestPointToPoint(new THREE.Vector3(cursor.x, cursor.y, 0), true, new THREE.Vector3());
      const dist = Math.hypot(at.x - cursor.x, at.y - cursor.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = d.id;
      }
    }
    return best;
  };

  let lastPointer = { clientX: 0, clientY: 0 };

  return {
    id: 'dimension',
    label: 'Dimension',
    shortcut: 'D',
    hint: HINT_FIRST,
    cursor: 'crosshair',

    pointerMove(e) {
      lastPointer = { clientX: e.clientX, clientY: e.clientY };
      if (!a) {
        feedback.show(inference.infer(e, null));
      } else if (!b) {
        const p = inference.infer(e, a);
        feedback.show(p);
        if (p) {
          preview.set([[a, p.point]], kindColor(p.kind));
          ctx.setMeasurement(formatLength(a.distanceTo(p.point)));
        }
      } else {
        offset = offsetAt(e);
        showShape(offset, 0x1d1d1b);
        ctx.setMeasurement(formatLength(offset.length()));
      }
    },

    pointerDown(e) {
      if (!a) {
        const p = inference.infer(e, null);
        if (!p) return;
        a = p.point.clone();
        inference.remember(a);
        ctx.setHint(HINT_SECOND);
      } else if (!b) {
        const p = inference.infer(e, a);
        if (!p || p.point.distanceTo(a) < EPS) return;
        b = p.point.clone();
        inference.remember(b);
        ctx.setHint(HINT_OFFSET);
      } else {
        place(offsetAt(e));
      }
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!a || !b || length === null || offset.length() < EPS) return false;
      return place(offset.clone().setLength(length));
    },

    keyDown(e) {
      if (e.key === 'Escape' && (a || b)) {
        reset();
        return true;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !a) {
        const id = nearest(lastPointer);
        if (!id) return false;
        const next = structuredClone(doc.drawingSettings);
        next.dimensions = next.dimensions.filter((d) => d.id !== id);
        doc.updateDrawingSettings('Delete Dimension', next);
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
