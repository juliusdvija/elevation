import * as THREE from 'three';
import { pointInPolygon } from '../kernel/math';

export type BoxMode = 'window' | 'crossing';

/** Screen-space rectangle from two corners (any order). */
export function boxFrom(a: THREE.Vector2, b: THREE.Vector2): THREE.Box2 {
  return new THREE.Box2().setFromPoints([a, b]);
}

/** Dragging left to right selects what is fully inside; right to left, what it touches. */
export function boxMode(start: THREE.Vector2, end: THREE.Vector2): BoxMode {
  return end.x >= start.x ? 'window' : 'crossing';
}

function segmentsIntersect(p1: THREE.Vector2, p2: THREE.Vector2, q1: THREE.Vector2, q2: THREE.Vector2): boolean {
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether segment ab touches the box (an end inside, or crossing a side). */
export function segmentTouchesBox(a: THREE.Vector2, b: THREE.Vector2, box: THREE.Box2): boolean {
  if (box.containsPoint(a) || box.containsPoint(b)) return true;
  const corners = [
    new THREE.Vector2(box.min.x, box.min.y),
    new THREE.Vector2(box.max.x, box.min.y),
    new THREE.Vector2(box.max.x, box.max.y),
    new THREE.Vector2(box.min.x, box.max.y),
  ];
  return corners.some((c, i) => segmentsIntersect(a, b, c, corners[(i + 1) % 4]));
}

/** Selection test for an edge projected to screen. */
export function edgeInBox(a: THREE.Vector2, b: THREE.Vector2, box: THREE.Box2, mode: BoxMode): boolean {
  return mode === 'window' ? box.containsPoint(a) && box.containsPoint(b) : segmentTouchesBox(a, b, box);
}

/** Selection test for a face's outline projected to screen. */
export function polygonInBox(outline: THREE.Vector2[], box: THREE.Box2, mode: BoxMode): boolean {
  if (mode === 'window') return outline.every((p) => box.containsPoint(p));
  if (outline.some((p, i) => segmentTouchesBox(p, outline[(i + 1) % outline.length], box))) return true;
  // The box may lie entirely inside the face.
  return pointInPolygon(box.getCenter(new THREE.Vector2()), outline);
}
