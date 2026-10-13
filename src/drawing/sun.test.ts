import { describe, expect, it } from 'vitest';
import { DEFAULT_SUN } from './settings';
import { resolveSun, sunPosition } from './sun';

describe('sun position', () => {
  it('stands 61 degrees high and due south at solar noon in Amsterdam on midsummer day', () => {
    // Amsterdam 52.37 N, 4.90 E, UTC+2: solar noon is a little before 13:42 local time.
    const { altitude, azimuth } = sunPosition('2026-06-21', 822, 52.37, 4.9, 2);
    expect(altitude).toBeCloseTo(90 - 52.37 + 23.44, 0);
    expect(Math.abs(azimuth - 180)).toBeLessThan(2);
  });

  it('is nearly overhead on the equator at the equinox, and below the horizon in polar night', () => {
    expect(sunPosition('2026-03-20', 720, 0, 0, 0).altitude).toBeGreaterThan(87);
    expect(sunPosition('2026-12-21', 720, 80, 0, 0).altitude).toBeLessThan(-12);
  });

  it('rises in the east side and sets in the west side, and mirrors in the southern hemisphere', () => {
    const morning = sunPosition('2026-06-21', 8 * 60, 52.37, 4.9, 2);
    const evening = sunPosition('2026-06-21', 20 * 60, 52.37, 4.9, 2);
    expect(morning.azimuth).toBeGreaterThan(40);
    expect(morning.azimuth).toBeLessThan(120);
    expect(evening.azimuth).toBeGreaterThan(240);
    expect(evening.azimuth).toBeLessThan(320);
    // Sydney at noon on midsummer's day in the north (winter there) has the sun in the north.
    const sydney = sunPosition('2026-06-21', 12 * 60, -33.87, 151.2, 10);
    expect(sydney.azimuth < 90 || sydney.azimuth > 270).toBe(true);
  });

  it('turns with the north angle, and keeps the manual sun when not set to a place', () => {
    const manual = resolveSun({ ...DEFAULT_SUN, azimuth: 90, altitude: 20 });
    expect(manual).toEqual({ shadows: true, azimuth: 90, altitude: 20 });
    const base = resolveSun({ ...DEFAULT_SUN, mode: 'place', northAngle: 0 });
    const turned = resolveSun({ ...DEFAULT_SUN, mode: 'place', northAngle: 30 });
    expect(turned.altitude).toBeCloseTo(base.altitude, 6);
    expect((turned.azimuth - base.azimuth + 360) % 360).toBeCloseTo(30, 6);
  });

  it('gives old files with no sun the default', () => {
    expect(resolveSun(undefined).azimuth).toBe(DEFAULT_SUN.azimuth);
  });
});
