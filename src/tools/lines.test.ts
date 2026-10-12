import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { alignmentInPlane, closestOnLineToRay, intersectLines, projectOnLine } from './lines';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('inference lines', () => {
  it('finds the point on a line nearest to a ray', () => {
    const line = { point: v(0, 0, 0), direction: v(1, 0, 0) };
    const ray = new THREE.Ray(v(500, -1000, 1000), v(0, 1, -1).normalize());
    expect(closestOnLineToRay(line, ray).toArray()).toEqual([500, 0, 0]);
  });

  it('intersects crossing lines and rejects skew or parallel ones', () => {
    const x = { point: v(0, 1000, 0), direction: v(1, 0, 0) };
    const y = { point: v(300, 0, 0), direction: v(0, 1, 0) };
    expect(intersectLines(x, y)!.toArray()).toEqual([300, 1000, 0]);
    expect(intersectLines(x, { point: v(300, 0, 50), direction: v(0, 1, 0) })).toBeNull();
    expect(intersectLines(x, { point: v(0, 0, 0), direction: v(1, 0, 0) })).toBeNull();
  });

  it('projects a remembered point onto the drawing plane for alignment', () => {
    const ground = { normal: v(0, 0, 1), d: 0 };
    const line = alignmentInPlane(v(2000, 3000, 2500), v(0, 1, 0), ground)!;
    expect(line.point.toArray()).toEqual([2000, 3000, 0]);
    expect(projectOnLine(v(1800, 0, 0), line).toArray()).toEqual([2000, 0, 0]);
    expect(alignmentInPlane(v(0, 0, 0), v(0, 0, 1), ground)).toBeNull();
  });
});
