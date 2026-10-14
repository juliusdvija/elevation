import { describe, expect, it } from 'vitest';
import { reliefPixels } from './proceduralTextures';

describe('relief maps', () => {
  it('turns a flat height into a straight-up normal', () => {
    const { normal } = reliefPixels(new Uint8ClampedArray(16).fill(128), 4, 2.5);
    expect([normal[0], normal[1], normal[2]]).toEqual([128, 128, 255]);
  });

  it('tilts the normal away from rising ground and makes recesses rougher', () => {
    const size = 8;
    // Heights rise to the right (x), level in y.
    const heights = new Uint8ClampedArray(size * size).map((_, i) => (i % size) * 20);
    const { normal, roughness } = reliefPixels(heights, size, 2.5);
    const at = (x: number, y: number) => (y * size + x) * 4;
    expect(normal[at(3, 3)]).toBeLessThan(128); // faces left, down the slope
    expect(Math.abs(normal[at(3, 3) + 1] - 128)).toBeLessThanOrEqual(1);
    expect(roughness[at(0, 3)]).toBeGreaterThan(roughness[at(6, 3)]);
  });
});
