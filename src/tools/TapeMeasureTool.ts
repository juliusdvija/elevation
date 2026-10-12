import * as THREE from 'three';
import { formatLength, parseLength } from '../core/units';
import { EPS } from '../kernel/math';
import { closestOnLineToRay, projectOnLine, type Line3 } from './lines';
import { kindColor, type InferredPoint } from './inference';
import { PreviewLines } from './overlay';
import type { Tool, ToolContext } from './Tool';
import { worldEdge } from './space';

const HINT_START = 'Click an edge to place a parallel guide, or a point to measure from.';
const HINT_GUIDE = 'Move to offset the guide and click, or type a distance and press Enter.';
const HINT_MEASURE = 'Click a second point. A guide point is placed there.';

/**
 * Tape Measure: from an edge, places a guide line parallel to it at an
 * offset; from a point, measures a distance and leaves a guide point.
 */
export function createTapeMeasureTool(ctx: ToolContext): Tool {
  const preview = new PreviewLines(ctx.viewport);
  const { inference, feedback } = ctx;
  const model = ctx.doc.model;

  let mode: { kind: 'guide'; edge: Line3; offset: THREE.Vector3 } | { kind: 'measure'; from: THREE.Vector3 } | null = null;
  let hover: InferredPoint | null = null;

  const reset = () => {
    mode = null;
    hover = null;
    inference.release();
    preview.clear();
    feedback.clear();
    ctx.setMeasurement('');
    ctx.setHint(HINT_START);
  };

  /** Guide parallel to the edge through the cursor; the offset is perpendicular to the edge. */
  const guideOffset = (e: PointerEvent, edge: Line3): THREE.Vector3 => {
    const p = inference.infer(e, null);
    hover = p;
    feedback.show(p);
    const target = p?.point ?? closestOnLineToRay(edge, ctx.viewport.ray(e.clientX, e.clientY));
    return target.clone().sub(projectOnLine(target, edge));
  };

  const placeGuide = (edge: Line3, offset: THREE.Vector3) => {
    if (offset.length() < EPS) return;
    ctx.doc.run('Guide', () => model.addGuideLine(edge.point.clone().add(offset), edge.direction));
    reset();
  };

  return {
    id: 'tape',
    label: 'Tape Measure',
    shortcut: 'T',
    hint: HINT_START,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!mode) {
        feedback.show(inference.infer(e, null));
        return;
      }
      if (mode.kind === 'guide') {
        const offset = guideOffset(e, mode.edge);
        mode.offset = offset;
        const base = hover?.point ?? mode.edge.point.clone().add(offset);
        const foot = base.clone().sub(offset);
        preview.set(
          [
            [foot, base],
            [base.clone().addScaledVector(mode.edge.direction, -1e5), base.clone().addScaledVector(mode.edge.direction, 1e5)],
          ],
          0x6f6d67,
        );
        ctx.setMeasurement(formatLength(offset.length()));
      } else {
        hover = inference.infer(e, mode.from);
        feedback.show(hover);
        if (hover) {
          preview.set([[mode.from, hover.point]], kindColor(hover.kind));
          ctx.setMeasurement(formatLength(mode.from.distanceTo(hover.point)));
        }
      }
    },

    pointerDown(e) {
      if (mode?.kind === 'guide') {
        placeGuide(mode.edge, mode.offset);
        return;
      }
      if (mode?.kind === 'measure') {
        const p = inference.infer(e, mode.from);
        if (p && p.point.distanceTo(mode.from) > EPS) {
          const point = p.point.clone();
          ctx.doc.run('Guide Point', () => model.addGuidePoint(point));
          inference.remember(point);
        }
        reset();
        return;
      }

      const p = inference.infer(e, null);
      if (!p) return;
      if (p.pick.kind === 'edge' || p.pick.kind === 'guide') {
        const id = p.pick.id;
        let edge: Line3;
        if (p.pick.kind === 'edge') {
          const [a, b] = worldEdge(p.pick.placement, id);
          edge = { point: a, direction: b.clone().sub(a).normalize() };
        } else {
          const g = model.allGuides().find((x) => x.id === id);
          if (!g || g.kind !== 'line') return;
          edge = { point: g.point.clone(), direction: g.direction.clone() };
        }
        mode = { kind: 'guide', edge, offset: new THREE.Vector3() };
        ctx.setHint(HINT_GUIDE);
      } else {
        mode = { kind: 'measure', from: p.point.clone() };
        inference.remember(p.point);
        ctx.setHint(HINT_MEASURE);
      }
    },

    onMeasurement(text) {
      const length = parseLength(text);
      if (!mode || length === null) return false;
      if (mode.kind === 'guide') {
        if (mode.offset.length() < EPS) return false;
        placeGuide(mode.edge, mode.offset.clone().setLength(length));
        return true;
      }
      if (!hover) return false;
      const dir = hover.point.clone().sub(mode.from);
      if (dir.lengthSq() < EPS * EPS) return false;
      const point = mode.from.clone().addScaledVector(dir.normalize(), length);
      ctx.doc.run('Guide Point', () => model.addGuidePoint(point));
      reset();
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && mode) {
        reset();
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate: reset,
  };
}
