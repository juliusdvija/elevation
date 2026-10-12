import * as THREE from 'three';
import type { Plane } from '../kernel/math';
import type { Line3 } from './lines';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

/**
 * The plane's two "in-plane" world axes (those least aligned with its normal)
 * and the remaining one, which is solved from the plane equation.
 */
function planeAxes(normal: THREE.Vector3): { inPlane: [Axis, Axis]; solved: Axis } {
  const sorted = [...AXES].sort((a, b) => Math.abs(normal[a]) - Math.abs(normal[b]));
  return { inPlane: [sorted[0], sorted[1]], solved: sorted[2] };
}

function solve(p: THREE.Vector3, plane: Plane, solved: Axis): THREE.Vector3 {
  const n = plane.normal;
  if (Math.abs(n[solved]) < 1e-12) return p;
  const others = AXES.filter((a) => a !== solved);
  p[solved] = (plane.d - n[others[0]] * p[others[0]] - n[others[1]] * p[others[1]]) / n[solved];
  return p;
}

/**
 * The world-grid point in a plane nearest `point`: its two in-plane world
 * coordinates rounded to the spacing (measured from the origin), the third
 * on the plane. On axis-aligned planes that is a true grid point.
 */
export function gridPointInPlane(point: THREE.Vector3, plane: Plane, spacing: number): THREE.Vector3 {
  const { inPlane, solved } = planeAxes(plane.normal);
  const g = point.clone();
  for (const a of inPlane) g[a] = Math.round(g[a] / spacing) * spacing;
  return solve(g, plane, solved);
}

/** The step along each in-plane axis that moves one grid cell, for checking on-screen size. */
export function gridSteps(plane: Plane, spacing: number): THREE.Vector3[] {
  const { inPlane, solved } = planeAxes(plane.normal);
  return inPlane.map((a) => {
    const step = new THREE.Vector3();
    step[a] = spacing;
    // Stay in the plane: adjust the solved axis.
    const n = plane.normal;
    if (Math.abs(n[solved]) > 1e-12) step[solved] = (-n[a] * spacing) / n[solved];
    return step;
  });
}

/**
 * Points where a line crosses the world grid planes (x, y or z at a multiple
 * of the spacing), one per axis, nearest to `near`.
 */
export function gridCrossingsOnLine(line: Line3, near: THREE.Vector3, spacing: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const a of AXES) {
    const d = line.direction[a];
    if (Math.abs(d) < 1e-9) continue;
    const target = Math.round(near[a] / spacing) * spacing;
    out.push(line.point.clone().addScaledVector(line.direction, (target - line.point[a]) / d));
  }
  return out;
}
