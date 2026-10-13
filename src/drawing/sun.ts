import * as THREE from 'three';
import { DEFAULT_SUN, type SunSettings } from './settings';

const RAD = Math.PI / 180;

/** Where the sun stands: compass degrees clockwise from true north, and degrees above the horizon (negative: below it). */
export interface SunPosition {
  azimuth: number;
  altitude: number;
}

function dayOfYear(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
}

/**
 * The sun's position for a place, a local date and a local clock time. Uses the NOAA general solar position
 * formulas (a Fourier series for the equation of time and the declination): good to about a quarter of a degree,
 * which is far more than a shadow study needs. `utcOffset` is hours ahead of UTC and includes daylight saving.
 */
export function sunPosition(date: string, minutes: number, latitude: number, longitude: number, utcOffset: number): SunPosition {
  const hour = minutes / 60;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(date) - 1 + (hour - utcOffset - 12) / 24);
  const equationOfTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  // True solar time in minutes, and the hour angle: 0 at solar noon, negative in the morning.
  const solarTime = minutes + equationOfTime + 4 * longitude - 60 * utcOffset;
  const hourAngle = (solarTime / 4 - 180) * RAD;
  const phi = latitude * RAD;
  const sinAltitude = Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.min(1, Math.max(-1, sinAltitude))) / RAD;
  // Measured from south, positive towards the west; +180 turns it into a bearing from north.
  const fromSouth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi));
  const azimuth = (((fromSouth / RAD + 180) % 360) + 360) % 360;
  return { azimuth, altitude };
}

/** Hours the local clock is ahead of UTC on a date: standard time, plus an hour in the summer months where summer time applies. */
export function clockOffset(sun: Pick<SunSettings, 'utcOffset' | 'summerTime' | 'date' | 'latitude'>): number {
  const month = Number((sun.date ?? DEFAULT_SUN.date!).split('-')[1]);
  const north = (sun.latitude ?? 0) >= 0;
  const summer = north ? month >= 4 && month <= 10 : month >= 10 || month <= 3;
  return (sun.utcOffset ?? 0) + (sun.summerTime && summer ? 1 : 0);
}

/** The sun as the viewport needs it: shadows, and the sun's compass direction in the model's own axes. */
export function resolveSun(settings: SunSettings | undefined): { shadows: boolean; azimuth: number; altitude: number } {
  const sun = { ...DEFAULT_SUN, ...settings };
  if (sun.mode !== 'place') return { shadows: sun.shadows, azimuth: sun.azimuth, altitude: sun.altitude };
  const { azimuth, altitude } = sunPosition(sun.date!, sun.minutes!, sun.latitude!, sun.longitude!, clockOffset(sun));
  // A bearing b from true north is at b + northAngle from the model's +Y.
  return { shadows: sun.shadows, azimuth: (((azimuth + sun.northAngle!) % 360) + 360) % 360, altitude };
}

/**
 * The way sunlight travels, for the 2D drawings (a unit vector pointing down); null when the sun is at or below the
 * horizon, so there is no direct light. A low sun is held at 6° so shadows stay a drawable length.
 */
export function lightFromSun(sun: { azimuth: number; altitude: number }): THREE.Vector3 | null {
  if (sun.altitude <= 1) return null;
  const azimuth = sun.azimuth * RAD;
  const altitude = Math.max(6, sun.altitude) * RAD;
  return new THREE.Vector3(-Math.sin(azimuth) * Math.cos(altitude), -Math.cos(azimuth) * Math.cos(altitude), -Math.sin(altitude)).normalize();
}

/** The clock times (minutes since midnight) of sunrise and sunset for a place and date, or null in polar night or midnight sun. */
export function daylight(sun: Pick<SunSettings, 'date' | 'latitude' | 'longitude' | 'utcOffset' | 'summerTime'>): { rise: number; set: number } | null {
  const offset = clockOffset(sun);
  let rise = -1;
  let set = -1;
  for (let m = 0; m <= 1440; m += 5) {
    if (sunPosition(sun.date!, m, sun.latitude!, sun.longitude!, offset).altitude > 0) {
      if (rise < 0) rise = m;
      set = m;
    }
  }
  return rise < 0 || (rise === 0 && set === 1440) ? null : { rise, set };
}
