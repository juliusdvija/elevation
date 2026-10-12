import * as THREE from 'three';
import { closestBetweenSegments } from '../kernel/math';
import { theme } from '../viewport/theme';
import type { Pick } from './Picker';
import type { ToolContext } from './Tool';
import type { SnapKind } from './overlay';

export interface InferredPoint {
  point: THREE.Vector3;
  kind: SnapKind;
  pick: Pick;
}

const AXIS_RADIUS = 12; // px
const AXES: [SnapKind, THREE.Vector3, number][] = [
  ['axis-x', new THREE.Vector3(1, 0, 0), theme.axisX],
  ['axis-y', new THREE.Vector3(0, 1, 0), theme.axisY],
  ['axis-z', new THREE.Vector3(0, 0, 1), theme.axisZ],
];

export function axisColor(kind: SnapKind): number | undefined {
  return AXES.find(([k]) => k === kind)?.[2];
}

/**
 * The point a drawing tool should use under the cursor: snapped to geometry
 * first, then locked to a red/green/blue axis through `from` when the cursor
 * is close to one, then on a face or the ground.
 */
export function inferPoint(ctx: ToolContext, e: PointerEvent, from: THREE.Vector3 | null): InferredPoint | null {
  const pick = ctx.picker.pick(e.clientX, e.clientY);
  if (pick.kind === 'vertex' || pick.kind === 'midpoint' || pick.kind === 'edge') {
    return { point: pick.point, kind: pick.kind, pick };
  }

  if (from) {
    const ray = ctx.viewport.ray(e.clientX, e.clientY);
    const far = ray.origin.clone().addScaledVector(ray.direction, 1e8);
    const cursor = new THREE.Vector2(e.clientX, e.clientY);
    let best: { point: THREE.Vector3; kind: SnapKind; px: number } | null = null;
    for (const [kind, dir] of AXES) {
      const a = from.clone().addScaledVector(dir, -1e7);
      const b = from.clone().addScaledVector(dir, 1e7);
      const { s } = closestBetweenSegments(a, b, ray.origin, far);
      const point = a.lerp(b, s);
      const screen = ctx.viewport.toScreen(point);
      if (!screen || point.distanceTo(from) < 1e-6) continue;
      const px = screen.distanceTo(cursor);
      if (px < AXIS_RADIUS && (!best || px < best.px)) best = { point, kind, px };
    }
    if (best) return { point: best.point, kind: best.kind, pick };
  }

  if (pick.kind === 'face' || pick.kind === 'ground') return { point: pick.point, kind: pick.kind, pick };
  return null;
}
