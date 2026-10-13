import { describe, expect, it } from 'vitest';
import { DEFAULT_SUN } from './settings';
import { clockOffset, daylight, lightFromSun, resolveSun, sunPosition } from './sun';

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

  it('adds an hour of summer time in the places and months where it applies', () => {
    const amsterdam = { ...DEFAULT_SUN, utcOffset: 1, summerTime: true, latitude: 52.37 };
    expect(clockOffset({ ...amsterdam, date: '2026-06-21' })).toBe(2);
    expect(clockOffset({ ...amsterdam, date: '2026-12-21' })).toBe(1);
    expect(clockOffset({ ...amsterdam, utcOffset: 9, summerTime: false, date: '2026-06-21' })).toBe(9);
    // Sydney is in summer time in December.
    const sydney = { ...DEFAULT_SUN, utcOffset: 10, summerTime: true, latitude: -33.87 };
    expect(clockOffset({ ...sydney, date: '2026-12-21' })).toBe(11);
    expect(clockOffset({ ...sydney, date: '2026-06-21' })).toBe(10);
  });

  it('finds sunrise and sunset, a long day in summer and none in polar night', () => {
    const summer = daylight({ ...DEFAULT_SUN, date: '2026-06-21' })!;
    const winter = daylight({ ...DEFAULT_SUN, date: '2026-12-21' })!;
    expect(summer.set - summer.rise).toBeGreaterThan(15 * 60);
    expect(winter.set - winter.rise).toBeLessThan(9 * 60);
    expect(daylight({ ...DEFAULT_SUN, latitude: 80, longitude: 0, utcOffset: 0, summerTime: false, date: '2026-12-21' })).toBeNull();
  });

  it('turns the sun into the way light travels for drawings, and into none when it is down', () => {
    const light = lightFromSun({ azimuth: 180, altitude: 45 })!;
    expect(light.y).toBeGreaterThan(0); // the sun is towards -y (south in a north-up model), so light travels towards +y
    expect(light.z).toBeLessThan(0);
    expect(light.length()).toBeCloseTo(1, 6);
    expect(lightFromSun({ azimuth: 90, altitude: -10 })).toBeNull();
  });
});
