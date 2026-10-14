import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../core/materials';
import { isReflective, reflectivePlanes } from './planarReflections';
import { groundPlan } from './realisticScene';

/** Two triangles making a w × w square at height z, facing up (or down). */
function square(z: number, w: number, up = true) {
  const positions = [0, 0, z, w, 0, z, w, w, z, 0, 0, z, w, w, z, 0, w, z];
  const normals = Array.from({ length: 6 }, () => [0, 0, up ? 1 : -1]).flat();
  return { positions, normals };
}

describe('planar reflections', () => {
  it('mirrors in water, glass and polished stone, not in matte things', () => {
    const byId = (id: string) => MATERIALS.find((m) => m.id === id)!;
    expect(isReflective(byId('water'))).toBe(true);
    expect(isReflective(byId('marble'))).toBe(true);
    expect(isReflective(byId('oak-floor'))).toBe(true);
    expect(isReflective(byId('brick'))).toBe(false);
    expect(isReflective(byId('render'))).toBe(false);
  });

  it('picks the largest upward-facing levels', () => {
    const planes = reflectivePlanes([square(-200, 8000), square(0, 3000), square(500, 1000), square(900, 9000, false)]);
    expect(planes).toEqual([-200, 0]);
    expect(reflectivePlanes([square(0, 100)])).toEqual([]); // too small to bother
  });

  it('puts the ground under a sunken lawn, not under a deep pool floor', () => {
    const sunken = groundPlan([square(-150, 20000), square(-1700, 3000), square(150, 14000)]);
    expect(sunken.z).toBe(-150.5);
    expect(sunken.hole?.max.toArray()).toEqual([20000, 20000]);
    expect(groundPlan([square(150, 14000)])).toEqual({ z: -0.5, hole: null });
    expect(groundPlan([square(0, 14000)])).toEqual({ z: -0.5, hole: null });
  });
});
