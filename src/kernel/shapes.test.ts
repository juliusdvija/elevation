import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { arcFromCenter, arcSegments, circlePoints, offsetHolds, offsetPolygon, roundedRectangle } from './shapes';

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

  it('builds an arc from centre, start point and angle', () => {
    const pts = arcFromCenter(v(0, 0), Z, v(1000, 0), Math.PI / 2, 6);
    expect(pts).toHaveLength(7);
    expect(round(pts[0])).toEqual([1000, 0, 0]);
    expect(round(pts[6])).toEqual([0, 1000, 0]);
    expect(pts.every((p) => Math.abs(p.length() - 1000) < 1e-9)).toBe(true);
    // Negative angles sweep clockwise.
    expect(round(arcFromCenter(v(0, 0), Z, v(1000, 0), -Math.PI / 2, 4)[4])).toEqual([0, -1000, 0]);
  });

  it('uses one segment per 15 degrees', () => {
    expect(arcSegments(Math.PI / 2)).toBe(6);
    expect(arcSegments(2 * Math.PI)).toBe(24);
    expect(arcSegments(0.01)).toBe(2);
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

  it('drops vertices in the middle of a straight edge when offsetting', () => {
    const square = [v(0, 0), v(1000, 0), v(1000, 400), v(1000, 600), v(1000, 1000), v(0, 1000)];
    const inset = offsetPolygon(square, Z, 100);
    expect(inset.map(round)).toEqual([[100, 100, 0], [900, 100, 0], [900, 900, 0], [100, 900, 0]]);
  });

  it('notices when an offset has collapsed or turned inside out', () => {
    const strip = [v(0, 0), v(3400, 0), v(3400, 400), v(0, 400)];
    expect(offsetHolds(offsetPolygon(strip, Z, 100), Z, strip)).toBe(true);
    expect(offsetHolds(offsetPolygon(strip, Z, 200), Z, strip)).toBe(false);
    expect(offsetHolds(offsetPolygon(strip, Z, 300), Z, strip)).toBe(false);
    expect(offsetHolds(offsetPolygon(strip, Z, -300), Z, strip)).toBe(true);
  });

  it('rounds the corners of a rectangle: tangent to the sides, area just under the exact value', () => {
    const rect = [v(0, 0), v(30, 0), v(30, 20), v(0, 20)];
    const outline = roundedRectangle(rect, 3);
    // Four quarter arcs of 7 points (six 15-degree pieces).
    expect(outline).toHaveLength(28);
    // Every point is inside the rectangle, and the outline starts 3 along the first side.
    expect(outline.every((p) => p.x >= -1e-9 && p.x <= 30 + 1e-9 && p.y >= -1e-9 && p.y <= 20 + 1e-9)).toBe(true);
    expect(round(outline[0])).toEqual([0, 3, 0]);
    // The shoelace area, against the exact w*h - (4 - pi) r^2.
    let area = 0;
    outline.forEach((p, i) => {
      const q = outline[(i + 1) % outline.length];
      area += (p.x * q.y - q.x * p.y) / 2;
    });
    const exact = 600 - (4 - Math.PI) * 9;
    expect(Math.abs(area)).toBeLessThan(exact);
    expect(Math.abs(area)).toBeGreaterThan(exact - 0.4);
  });

  it('limits the radius to half the short side and leaves a zero radius sharp', () => {
    const rect = [v(0, 0), v(30, 0), v(30, 10), v(0, 10)];
    const outline = roundedRectangle(rect, 99);
    expect(Math.min(...outline.map((p) => p.y))).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...outline.map((p) => p.x))).toBeCloseTo(30);
    expect(roundedRectangle(rect, 0)).toHaveLength(4);
  });
});
