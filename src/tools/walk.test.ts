import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BODY_RADIUS, walkStep, type WalkWorld } from './walk';

/**
 * A little world for walking: a floor at z = 0 everywhere, a 150 mm terrace for x ≥ 2000, a wall at y = 3000
 * (facing −y), and a hole down to z = −1000 for x ≤ −2000.
 */
const world: WalkWorld = {
  floorBelow(from) {
    const z = from.x >= 2000 ? 150 : from.x <= -2000 ? -1000 : 0;
    return z <= from.z ? z : null;
  },
  obstacle(from, direction, range) {
    // The terrace edge is only 150 mm high: rays at knee height and above pass over it. The wall stands everywhere.
    if (direction.y > 1e-9) {
      const distance = (3000 - from.y) / direction.y;
      if (distance >= 0 && distance <= range) return { distance, normal: new THREE.Vector3(0, -1, 0) };
    }
    return null;
  },
};

describe('walking', () => {
  it('walks freely on a level floor', () => {
    const feet = walkStep(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 0, 0), world, 0);
    expect(feet.toArray()).toEqual([500, 0, 0]);
  });

  it('steps up onto a low terrace', () => {
    const feet = walkStep(new THREE.Vector3(1900, 0, 0), new THREE.Vector3(200, 0, 0), world, 0);
    expect(feet.x).toBe(2100);
    expect(feet.z).toBe(150);
  });

  it('stops short of a wall and slides along it', () => {
    const straight = walkStep(new THREE.Vector3(0, 2500, 0), new THREE.Vector3(0, 1000, 0), world, 0);
    expect(straight.y).toBeCloseTo(3000 - BODY_RADIUS);
    const diagonal = walkStep(new THREE.Vector3(0, 2500, 0), new THREE.Vector3(600, 600, 0), world, 0);
    expect(diagonal.y).toBeCloseTo(3000 - BODY_RADIUS);
    expect(diagonal.x).toBeGreaterThan(100);
  });

  it('drops down to a lower floor', () => {
    const feet = walkStep(new THREE.Vector3(-1900, 0, 0), new THREE.Vector3(-200, 0, 0), world, 0);
    expect(feet.z).toBe(-1000);
  });
});
