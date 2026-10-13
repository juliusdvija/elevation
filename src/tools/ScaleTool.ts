import * as THREE from 'three';
import type { Operation } from '../core/history';
import { formatLength } from '../core/units';
import { PreviewLines } from './overlay';
import { previewEdit } from './preview';
import { scaleTargets } from './selectionOps';
import { highlightOf, targetsAt, type Targets } from './targets';
import type { Tool, ToolContext } from './Tool';
import { theme } from '../viewport/theme';

const HINT_ANCHOR = 'Click the point that stays fixed (the base of the scaling).';
const HINT_REFERENCE = 'Click a second point; moving it away or towards the base sets the scale. Or type a factor.';
const HINT_FACTOR = 'Click to scale. Or type a factor and press Enter: 2, 0.5, or x,y,z (1,-1,1 flips along y).';

/** Parses "2", "0,5" (a decimal comma) or "1,-1,1" / "1 -1 1" into per-axis factors; null when it is not one. */
export function parseFactors(text: string): THREE.Vector3 | null {
  const t = text.trim();
  if (/^-?\d+([.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(',', '.'));
    return n === 0 ? null : new THREE.Vector3(n, n, n);
  }
  const parts = t.split(/[\s;]+|\s*,\s*/).filter(Boolean).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n === 0)) return null;
  return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

/**
 * Scale: click a base point, click a reference point, then move: the scale is how much farther the
 * cursor is from the base than the reference was. Typing a factor sets it exactly; a negative factor
 * flips along that axis. Works on loose geometry and on groups and components.
 */
export function createScaleTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const guide = new PreviewLines(ctx.viewport);

  let targets: Targets | null = null;
  let anchor: THREE.Vector3 | null = null;
  let reference = 0; // distance from the base to the reference point
  let factor = 1;
  let preview: Operation | null = null;

  const perform = (t: Targets, a: THREE.Vector3, f: THREE.Vector3) => scaleTargets(ctx, t, a, f);

  const revertPreview = () => {
    preview?.revert();
    preview = null;
  };

  const reset = () => {
    revertPreview();
    targets = null;
    anchor = null;
    reference = 0;
    factor = 1;
    guide.clear();
    feedback.clear();
    ctx.renderer.setHover(null);
    ctx.setMeasurement('');
    ctx.setHint(HINT_ANCHOR);
  };

  const show = (f: THREE.Vector3) => {
    revertPreview();
    if (!targets || !anchor) return;
    if (f.toArray().every((x) => Math.abs(x - 1) < 1e-9)) return;
    const [t, a] = [targets, anchor];
    preview = previewEdit(ctx, () => perform(t, a, f));
  };

  const commit = (f: THREE.Vector3) => {
    if (!targets || !anchor) return reset();
    const [t, a] = [targets, anchor.clone()];
    revertPreview();
    if (!f.toArray().every((x) => Math.abs(x - 1) < 1e-9)) {
      const flips = f.toArray().filter((x) => x < 0).length % 2 === 1;
      ctx.doc.run(flips ? 'Flip' : 'Scale', () => perform(t, a, f));
    }
    reset();
  };

  return {
    id: 'scale',
    label: 'Scale',
    shortcut: 'S',
    hint: HINT_ANCHOR,
    cursor: 'crosshair',

    pointerMove(e) {
      if (!anchor) {
        ctx.renderer.setHover(ctx.selection.empty ? highlightOf(targetsAt(ctx, e)) : null);
        feedback.show(inference.infer(e, null));
        return;
      }
      const p = inference.infer(e, anchor);
      feedback.show(p);
      if (!p) return;
      guide.set([[anchor, p.point]], theme.preview);
      if (reference <= 0) return;
      const d = p.point.distanceTo(anchor);
      if (d < 1e-6) return;
      factor = d / reference;
      // Near whole and half factors the scale snaps, so 2.003 becomes 2.
      const rounded = Math.round(factor * 4) / 4;
      if (Math.abs(factor - rounded) < 0.02 && rounded > 0) factor = rounded;
      ctx.setMeasurement(`× ${Math.round(factor * 1000) / 1000}`);
      show(new THREE.Vector3(factor, factor, factor));
    },

    pointerDown(e) {
      if (!anchor) {
        const t = targetsAt(ctx, e);
        const p = inference.infer(e, null);
        if (!t || !p) return;
        targets = t;
        anchor = p.point.clone();
        ctx.renderer.setHover(null);
        ctx.setHint(HINT_REFERENCE);
      } else if (reference <= 0) {
        const p = inference.infer(e, anchor);
        if (!p || p.point.distanceTo(anchor) < 1e-6) return;
        reference = p.point.distanceTo(anchor);
        ctx.setMeasurement(`Reference ${formatLength(reference)}`);
        ctx.setHint(HINT_FACTOR);
      } else {
        commit(new THREE.Vector3(factor, factor, factor));
      }
    },

    onMeasurement(text) {
      const f = parseFactors(text);
      if (!f || !anchor) return false;
      commit(f);
      return true;
    },

    cancel: reset,
    deactivate: reset,
  };
}
