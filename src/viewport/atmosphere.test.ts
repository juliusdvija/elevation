import { describe, expect, it } from 'vitest';
import { atmosphere, transmittance } from './atmosphere';

describe('atmosphere', () => {
  it('lets most sunlight through at noon, little at sunset, none below the horizon', () => {
    const noon = transmittance(60);
    expect(noon[0]).toBeGreaterThan(0.8);
    expect(noon[2]).toBeGreaterThan(0.6);
    const low = transmittance(2);
    expect(low[2]).toBeLessThan(0.05);
    expect(transmittance(-3)).toEqual([0, 0, 0]);
  });

  it('a low sun is warmer than a high one', () => {
    const noon = atmosphere(60).sunColor;
    const sunset = atmosphere(3).sunColor;
    expect(noon[0]).toBe(1);
    expect(noon[2]).toBeGreaterThan(0.7);
    expect(sunset[2] / sunset[0]).toBeLessThan(0.15);
    expect(sunset[1] / sunset[0]).toBeLessThan(noon[1] / noon[0]);
  });

  it('sunlight grows with the height of the sun and is gone once it has set', () => {
    let previous = -1;
    for (let h = -5; h <= 90; h += 5) {
      const { sunIntensity } = atmosphere(h);
      expect(sunIntensity).toBeGreaterThanOrEqual(previous);
      previous = sunIntensity;
    }
    expect(atmosphere(-1).sunIntensity).toBe(0);
  });

  it('haze dims the sun and warms it when low', () => {
    expect(atmosphere(30, 3).sunIntensity).toBeLessThan(atmosphere(30, 0.4).sunIntensity);
    const hazy = atmosphere(8, 3).sunColor;
    const clear = atmosphere(8, 0.4).sunColor;
    expect(hazy[2]).toBeLessThan(clear[2]);
  });

  it('opens up the exposure through twilight', () => {
    expect(atmosphere(30).exposure).toBe(1);
    expect(atmosphere(-4).exposure).toBeGreaterThan(2);
    expect(atmosphere(-12).exposure).toBe(16);
  });

  it('night falls after twilight', () => {
    expect(atmosphere(-4).night).toBe(0);
    expect(atmosphere(-10).night).toBeGreaterThan(0.2);
    expect(atmosphere(-20).night).toBe(1);
  });
});
