import { describe, expect, it } from 'vitest';
import { airMass, atmosphere } from './atmosphere';

describe('atmosphere', () => {
  it('air mass is 1 overhead and about 38 at the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 2);
    expect(airMass(0)).toBeGreaterThan(30);
    expect(airMass(-5)).toBe(airMass(0));
  });

  it('a low sun is warmer than a high one', () => {
    const noon = atmosphere(60).sunColor;
    const sunset = atmosphere(3).sunColor;
    expect(noon[0]).toBe(1);
    expect(noon[2]).toBeGreaterThan(0.6);
    expect(sunset[2]).toBeLessThan(0.3);
    expect(sunset[2] / sunset[0]).toBeLessThan(noon[2] / noon[0]);
  });

  it('sunlight grows with the height of the sun and is gone below the horizon', () => {
    let previous = -1;
    for (let h = -10; h <= 90; h += 5) {
      const { sunIntensity } = atmosphere(h);
      expect(sunIntensity).toBeGreaterThanOrEqual(previous);
      previous = sunIntensity;
    }
    expect(atmosphere(-2).sunIntensity).toBe(0);
    expect(atmosphere(60).sunIntensity).toBeGreaterThan(0.95);
  });

  it('night falls through twilight', () => {
    expect(atmosphere(10).night).toBe(0);
    expect(atmosphere(-6).night).toBeGreaterThan(0.2);
    expect(atmosphere(-6).night).toBeLessThan(0.8);
    expect(atmosphere(-20).night).toBe(1);
    expect(atmosphere(-2).stars).toBe(0);
    expect(atmosphere(-20).stars).toBe(1);
    expect(atmosphere(-20).skyIntensity).toBeLessThan(0.1);
  });
});
