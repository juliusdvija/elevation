import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { alignTurn, brightestDirection } from './hdri';

describe('photographed skies', () => {
  it('finds the brightest point of a panorama as a direction', () => {
    const width = 8;
    const height = 4;
    const data = new Float32Array(width * height * 4).fill(0.5);
    // Bright texel in the top row (row 0 is the bottom), at u = 0.5625: just past the middle.
    const i = (3 * width + 4) * 4;
    data[i] = data[i + 1] = data[i + 2] = 100;
    const { direction, luminance } = brightestDirection(data, width, height);
    expect(luminance).toBeCloseTo(100);
    expect(direction.y).toBeGreaterThan(0.9);
    expect(direction.length()).toBeCloseTo(1);
  });

  it('turns the panorama so its sun meets the model sun', () => {
    const panorama = new THREE.Vector3(1, 0.5, 0).normalize(); // Y-up, towards +x
    const model = new THREE.Vector3(0, 1, 0.5).normalize(); // Z-up, towards +y (north)
    const turn = alignTurn(panorama, model);
    // Sampling direction = Rx(−90°) · Rz(turn) · model direction must point at the panorama's sun.
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, turn, 'XZY'));
    const sampled = model.clone().applyMatrix4(r);
    expect(Math.atan2(sampled.z, sampled.x)).toBeCloseTo(Math.atan2(panorama.z, panorama.x));
  });
});
