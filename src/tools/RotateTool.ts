import * as THREE from 'three';
import { DIR_EPS, onPlane } from '../kernel/math';
import { copyEntities, transformVertices } from '../kernel/transform';
import { theme } from '../viewport/theme';
import { parseArray } from './MoveTool';
import { PreviewLines } from './overlay';
import { highlightOf, targetVertices, targetsAt, type Targets } from './targets';
import type { Tool, ToolContext } from './Tool';
import type { Operation } from '../core/history';
import { space, worldFacePlane } from './space';
import { previewEdit } from './preview';

const HINT_CENTER = 'Click the centre of rotation. The protractor follows the face under the cursor; arrow keys lock it to an axis.';
const HINT_REFERENCE = 'Click a point to set the start angle.';
const HINT_ANGLE = 'Click to set the angle (snaps every 15°), or type degrees. Option/Ctrl toggles copy.';
const SNAP_DEGREES = 15;
const SNAP_TOLERANCE = 2; // degrees
const PROTRACTOR_PX = 56;

const AXIS_KEYS: Record<string, THREE.Vector3> = {
  ArrowRight: new THREE.Vector3(1, 0, 0),
  ArrowLeft: new THREE.Vector3(0, 1, 0),
  ArrowUp: new THREE.Vector3(0, 0, 1),
};

function rotationAbout(center: THREE.Vector3, axis: THREE.Vector3, angle: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
}

function protractorColor(normal: THREE.Vector3): number {
  if (Math.abs(normal.x) > 1 - DIR_EPS) return theme.axisX;
  if (Math.abs(normal.y) > 1 - DIR_EPS) return theme.axisY;
  return theme.axisZ;
}

export function createRotateTool(ctx: ToolContext): Tool {
  const { inference, feedback } = ctx;
  const protractor = new PreviewLines(ctx.viewport);
  const arms = new PreviewLines(ctx.viewport);

  let targets: Targets | null = null;
  let center: THREE.Vector3 | null = null;
  let normal = new THREE.Vector3(0, 0, 1);
  let lockedNormal: THREE.Vector3 | null = null;
  let reference: THREE.Vector3 | null = null;
  let angle = 0;
  let copy = false;
  let preview: Operation | null = null;
  let lastEvent: PointerEvent | null = null;
  let lastCopy: { targets: Targets; center: THREE.Vector3; normal: THREE.Vector3; angle: number } | null = null;

  /** Rotates (or copies) targets about a world-space axis. */
  const perform = (t: Targets, c: THREE.Vector3, n: THREE.Vector3, a: number, asCopy: boolean, count = 1) => {
    const s = space(ctx);
    const model = s.model;
    if (!asCopy) {
      const m = s.matrixToLocal(rotationAbout(c, n, a));
      for (const id of t.instances) model.setInstanceMatrix(id, m.clone().multiply(new THREE.Matrix4().fromArray(model.instance(id).matrix)));
      transformVertices(model, targetVertices(ctx, t), m);
      return;
    }
    for (let i = 1; i <= count; i++) {
      const m = s.matrixToLocal(rotationAbout(c, n, a * i));
      for (const id of t.instances) {
        const inst = model.instance(id);
        model.addInstance(inst.definition, m.clone().multiply(new THREE.Matrix4().fromArray(inst.matrix)));
      }
      copyEntities(model, t.faces, t.edges, m);
    }
  };

  const revertPreview = () => {
    preview?.revert();
    preview = null;
  };

  const reset = () => {
    revertPreview();
    targets = null;
    center = null;
    reference = null;
    angle = 0;
    copy = false;
    protractor.clear();
    arms.clear();
    feedback.clear();
    ctx.renderer.setHover(null);
    ctx.setMeasurement('');
    ctx.setHint(HINT_CENTER);
  };

  const drawProtractor = (c: THREE.Vector3, n: THREE.Vector3, start?: THREE.Vector3) => {
    const radius = ctx.viewport.rig.worldPerPixel(ctx.viewport.height, c) * PROTRACTOR_PX;
    const u = (start ?? new THREE.Vector3(1, 0, 0)).clone().addScaledVector(n, -(start ?? new THREE.Vector3(1, 0, 0)).dot(n));
    if (u.lengthSq() < 1e-9) u.crossVectors(n, new THREE.Vector3(0, 1, 0));
    u.normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const at = (deg: number, r: number) => {
      const a = THREE.MathUtils.degToRad(deg);
      return c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r);
    };
    const segments: [THREE.Vector3, THREE.Vector3][] = [];
    for (let d = 0; d < 360; d += 7.5) segments.push([at(d, radius), at(d + 7.5, radius)]);
    for (let d = 0; d < 360; d += SNAP_DEGREES) segments.push([at(d, radius * (d % 90 === 0 ? 0.78 : 0.88)), at(d, radius)]);
    protractor.set(segments, protractorColor(n));
  };

  /** Cursor projected onto the rotation plane through the centre. */
  const onRotationPlane = (e: PointerEvent): THREE.Vector3 | null => {
    const p = inference.infer(e, center);
    if (p && onPlane({ normal, d: normal.dot(center!) }, p.point)) return p.point;
    const plane = new THREE.Plane(normal.clone(), -normal.dot(center!));
    return ctx.viewport.ray(e.clientX, e.clientY).intersectPlane(plane, new THREE.Vector3());
  };

  const update = (e: PointerEvent) => {
    lastEvent = e;
    if (!center) {
      ctx.renderer.setHover(ctx.selection.empty ? highlightOf(targetsAt(ctx, e)) : null);
      const p = inference.infer(e, null);
      feedback.show(p);
      if (!p) return protractor.clear();
      const facePlane = p.pick.kind === 'face' ? worldFacePlane(p.pick.placement, p.pick.id) : null;
      normal = lockedNormal ?? facePlane?.normal ?? new THREE.Vector3(0, 0, 1);
      drawProtractor(p.point, normal);
      return;
    }
    if (!reference) {
      const p = inference.infer(e, center);
      feedback.show(p);
      if (!p) return;
      drawProtractor(center, normal, p.point.clone().sub(center));
      arms.set([[center, p.point]], protractorColor(normal));
      return;
    }

    revertPreview();
    const p = onRotationPlane(e);
    if (!p) return;
    const u = reference.clone();
    const d = p.clone().sub(center).addScaledVector(normal, -p.clone().sub(center).dot(normal));
    if (d.lengthSq() < 1e-9) return;
    let degrees = THREE.MathUtils.radToDeg(Math.atan2(new THREE.Vector3().crossVectors(u, d).dot(normal), u.dot(d)));
    const snapped = Math.round(degrees / SNAP_DEGREES) * SNAP_DEGREES;
    if (Math.abs(degrees - snapped) < SNAP_TOLERANCE) degrees = snapped;
    angle = THREE.MathUtils.degToRad(degrees);
    const radius = ctx.viewport.rig.worldPerPixel(ctx.viewport.height, center) * PROTRACTOR_PX * 1.4;
    const endDir = u.clone().applyAxisAngle(normal, angle);
    arms.set(
      [
        [center, center.clone().addScaledVector(u, radius)],
        [center, center.clone().addScaledVector(endDir, radius)],
      ],
      protractorColor(normal),
    );
    ctx.setMeasurement(`${Math.round(degrees * 10) / 10}°`);
    if (targets && Math.abs(angle) > 1e-9) {
      const [t, c, n, a] = [targets, center, normal, angle];
      preview = previewEdit(ctx, () => perform(t, c, n, a, copy));
    }
  };

  const commit = (a: number) => {
    if (!targets || !center || Math.abs(a) < 1e-9) return reset();
    const [t, c, n] = [targets, center.clone(), normal.clone()];
    const asCopy = copy && t.faces.length + t.edges.length + t.instances.length > 0;
    revertPreview();
    ctx.doc.run(asCopy ? 'Rotate Copy' : 'Rotate', () => perform(t, c, n, a, asCopy));
    lastCopy = asCopy ? { targets: t, center: c, normal: n, angle: a } : null;
    reset();
  };

  return {
    id: 'rotate',
    label: 'Rotate',
    shortcut: 'Q',
    hint: HINT_CENTER,
    cursor: 'crosshair',

    pointerMove: update,

    pointerDown(e) {
      if (!center) {
        const t = targetsAt(ctx, e);
        const p = inference.infer(e, null);
        if (!t || !p) return;
        targets = t;
        center = p.point.clone();
        lastCopy = null;
        ctx.renderer.setHover(null);
        ctx.setHint(HINT_REFERENCE);
      } else if (!reference) {
        const p = inference.infer(e, center);
        if (!p) return;
        const r = p.point.clone().sub(center).addScaledVector(normal, -p.point.clone().sub(center).dot(normal));
        if (r.lengthSq() < 1e-6) return;
        reference = r.normalize();
        ctx.setHint(HINT_ANGLE);
      } else {
        commit(angle);
      }
    },

    onMeasurement(text) {
      const array = parseArray(text);
      if (array && !center && lastCopy && ctx.doc.history.undoLabel === 'Rotate Copy') {
        const { targets: t, center: c, normal: n, angle: a } = lastCopy;
        ctx.doc.history.undo();
        const step = array.divide ? a / array.count : a;
        ctx.doc.run('Rotate Copy', () => perform(t, c, n, step, true, array.count));
        return true;
      }
      const degrees = Number(text.replace(',', '.').replace('°', ''));
      if (!reference || !Number.isFinite(degrees)) return false;
      commit(THREE.MathUtils.degToRad(degrees));
      return true;
    },

    keyDown(e) {
      if (e.key === 'Escape' && (center || lockedNormal)) {
        lockedNormal = null;
        reset();
        return true;
      }
      if ((e.key === 'Alt' || e.key === 'Control') && reference) {
        copy = !copy;
        ctx.setHint(copy ? `Copy: ${HINT_ANGLE}` : HINT_ANGLE);
        if (lastEvent) update(lastEvent);
        return true;
      }
      const axis = AXIS_KEYS[e.key];
      if (axis && !reference) {
        lockedNormal = lockedNormal?.equals(axis) ? null : axis.clone();
        if (lockedNormal) normal = lockedNormal.clone();
        if (lastEvent) update(lastEvent);
        return true;
      }
      return false;
    },

    cancel: reset,
    deactivate() {
      lockedNormal = null;
      lastCopy = null;
      reset();
    },
  };
}
