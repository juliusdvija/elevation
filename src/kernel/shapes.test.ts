import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { arcPoints, circlePoints, offsetPolygon } from './shapes';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const Z = v(0, 0, 1);
const round = (p: THREE.Vector3) => p.toArray().map((n) => Math.round(n));

describe('shapes', () => {
  it('builds a circle of the right size, starting where asked', () => {
    const pts = circlePoints(v(100, 100), Z, 500, 24, v(1, 0, 0));
    expect(pts).toHaveLength(24);
    expect(pts.every((p) => Math.abs(p.distanceTo(v(100, 100)) - 500) < 1e-9)).toBe(true);
    expect(round(pts[0])).toEqual([600, 100, 0]);
  });

  it('builds an arc through its ends and its bulge point', () => {
    const pts = arcPoints(v(0, 0), v(1000, 0), Z, 500, 12);
    expect(round(pts[0])).toEqual([0, 0, 0]);
    expect(round(pts[12])).toEqual([1000, 0, 0]);
    // Bulge of half the chord is a half circle; its middle point is the apex.
    expect(round(pts[6])).toEqual([500, 500, 0]);
    const flipped = arcPoints(v(0, 0), v(1000, 0), Z, -200, 8);
    expect(Math.min(...flipped.map((p) => p.y))).toBeCloseTo(-200, 6);
  });

  it('offsets a square inwards and outwards', () => {
    const square = [v(0, 0), v(1000, 0), v(1000, 1000), v(0, 1000)];
    expect(offsetPolygon(square, Z, 100).map(round)).toEqual([
      [100, 100, 0],
      [900, 100, 0],
      [900, 900, 0],
      [100, 900, 0],
    ]);
    expect(round(offsetPolygon(square, Z, -100)[0])).toEqual([-100, -100, 0]);
  });
});
