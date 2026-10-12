import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gridCrossingsOnLine, gridPointInPlane } from './grid';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const round = (p: THREE.Vector3) => p.toArray().map((n) => Math.round(n));

describe('3D grid', () => {
  it('snaps on the ground to whole metres from the origin', () => {
    expect(round(gridPointInPlane(v(2380, -1220, 0), { normal: v(0, 0, 1), d: 0 }, 1000))).toEqual([2000, -1000, 0]);
  });

  it('snaps on a wall to whole metres of width and height', () => {
    // Wall at y = 4500 (off-grid itself): x and z snap, y stays on the wall.
    const wall = { normal: v(0, 1, 0), d: 4500 };
    expect(round(gridPointInPlane(v(3300, 4500, 2700), wall, 1000))).toEqual([3000, 4500, 3000]);
  });

  it('snaps on a roof above the ground', () => {
    expect(round(gridPointInPlane(v(1600, 2400, 3200), { normal: v(0, 0, 1), d: 3200 }, 1000))).toEqual([2000, 2000, 3200]);
  });

  it('keeps points on a sloped plane', () => {
    const slope = { normal: v(0, -1, 1).normalize(), d: 0 }; // z = y
    const g = gridPointInPlane(v(1300, 2200, 2200), slope, 1000);
    expect(Math.abs(slope.normal.dot(g) - slope.d)).toBeLessThan(1e-9);
    expect(g.x).toBe(1000);
  });

  it('finds where a vertical line reaches whole metres of height', () => {
    const line = { point: v(500, 500, 0), direction: v(0, 0, 1) };
    expect(gridCrossingsOnLine(line, v(500, 500, 2800), 1000).map(round)).toEqual([[500, 500, 3000]]);
  });
});
