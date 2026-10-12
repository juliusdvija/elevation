import * as THREE from 'three';

/** Height of the scale figure (mm). */
export const FIGURE_HEIGHT = 1785;

/**
 * A standing person, front view: (x, z) in mm, feet on z = 0, centred on x = 0.
 * Drawn once for the right half and mirrored for the left.
 */
const RIGHT_HALF: [number, number][] = [
  [0, 830],
  [35, 430],
  [45, 0],
  [190, 0],
  [170, 430],
  [205, 830],
  [255, 1060],
  [250, 1400],
  [185, 1490],
  [70, 1530],
  [55, 1580],
  [95, 1625],
  [105, 1690],
  [75, 1760],
  [0, FIGURE_HEIGHT],
];

/** The figure's outline in its own plane (the XZ plane, front facing −Y). */
export function figureOutline(): THREE.Vector3[] {
  const right = RIGHT_HALF.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const left = RIGHT_HALF.slice(1, -1)
    .reverse()
    .map(([x, z]) => new THREE.Vector3(-x, 0, z));
  return [...right, ...left];
}

/** A figure standing at `point`, its front turned towards `towards` (horizontally). */
export function figureMatrix(point: THREE.Vector3, towards: THREE.Vector3): THREE.Matrix4 {
  const dx = towards.x - point.x;
  const dy = towards.y - point.y;
  const yaw = Math.hypot(dx, dy) < 1e-6 ? 0 : Math.atan2(dx, -dy);
  return new THREE.Matrix4().makeTranslation(point.x, point.y, point.z).multiply(new THREE.Matrix4().makeRotationZ(yaw));
}
