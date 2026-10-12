import * as THREE from 'three';
import type { Dimension } from './settings';
import { formatLength } from '../core/units';

/** Where a dimension's lines run, in world space. */
export interface DimensionShape {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** The measured points moved out by the offset: the ends of the dimension line. */
  a2: THREE.Vector3;
  b2: THREE.Vector3;
  mid: THREE.Vector3;
  length: number;
  text: string;
}

export function dimensionShape(d: Dimension): DimensionShape {
  const a = new THREE.Vector3(...d.a);
  const b = new THREE.Vector3(...d.b);
  const offset = new THREE.Vector3(...d.offset);
  const a2 = a.clone().add(offset);
  const b2 = b.clone().add(offset);
  const length = a.distanceTo(b);
  return { a, b, a2, b2, mid: a2.clone().add(b2).multiplyScalar(0.5), length, text: formatLength(length) };
}

/** Offset for a dimension line through `through`: perpendicular to the measured line. */
export function dimensionOffset(a: THREE.Vector3, b: THREE.Vector3, through: THREE.Vector3): THREE.Vector3 {
  const dir = b.clone().sub(a).normalize();
  const rel = through.clone().sub(a);
  return rel.sub(dir.multiplyScalar(rel.dot(dir)));
}

/** True when the measured line lies parallel to a view whose depth axis is `w`. */
export function parallelToView(d: Dimension, w: THREE.Vector3): boolean {
  const dir = new THREE.Vector3(...d.b).sub(new THREE.Vector3(...d.a));
  const len = dir.length();
  return len > 1e-6 && Math.abs(dir.dot(w)) / len < 1e-3;
}
