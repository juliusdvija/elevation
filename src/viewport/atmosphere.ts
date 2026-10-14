/** How the sky and the sunlight look for a height of the sun: what the photorealistic view feeds its sky and sun. */
export interface Atmosphere {
  /** Colour of direct sunlight (linear RGB, brightest channel 1). */
  sunColor: [number, number, number];
  /** Strength of direct sunlight, 0 (below the horizon) to 1 (sun high up). */
  sunIntensity: number;
  /** How much the sky lights the model, relative to a clear day (twilight and night are dimmer). */
  skyIntensity: number;
  /** `Sky` shader parameters: haziness, blue scattering and haze scattering. */
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  /** 0 by day, 1 at night (sun 10° or more below the horizon): how much the twilight-and-night dome covers the day sky. */
  night: number;
  /** How far twilight has turned into night: 0 a warm glow at the horizon, 1 dark blue with stars (sun 14° or more below). */
  stars: number;
}

const RAD = Math.PI / 180;

/** How many atmospheres sunlight crosses at a height above the horizon (Kasten and Young, 1989); finite at and below the horizon. */
export function airMass(altitudeDeg: number): number {
  const h = Math.max(0, altitudeDeg);
  return 1 / (Math.sin(h * RAD) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The atmosphere for a sun `altitudeDeg` above the horizon. Sunlight loses blue faster than red on its way through
 * the air (an extinction per air mass that falls with wavelength, roughly Rayleigh), so a low sun is warm and dim and
 * a high one is near white. The light fades out just below the horizon; civil and nautical twilight (down to −12°)
 * dim the sky towards night.
 */
export function atmosphere(altitudeDeg: number): Atmosphere {
  const m = airMass(altitudeDeg);
  // Optical depth per air mass for red, green and blue (clear air with a little haze).
  const tau = [0.1, 0.2, 0.42];
  const raw = tau.map((t) => Math.exp(-t * m));
  const top = Math.max(...raw);
  const sunColor = raw.map((c) => c / top) as [number, number, number];
  // Direct light: the green channel's transmittance, faded in over the first few degrees above the horizon.
  const sunIntensity = Math.min(1, raw[1] / Math.exp(-tau[1])) * smooth(-1, 4, altitudeDeg);
  // The daytime sky model goes black once the sun has set; a twilight dome takes over from just above the horizon.
  const night = 1 - smooth(-10, 2, altitudeDeg);
  const stars = 1 - smooth(-14, -4, altitudeDeg);
  const skyIntensity = 0.04 + 0.96 * smooth(-10, 12, altitudeDeg);
  // A low sun sees more haze; the sky reddens near sunrise and sunset.
  const low = 1 - smooth(0, 25, altitudeDeg);
  return {
    sunColor,
    sunIntensity,
    skyIntensity,
    turbidity: 3 + 5 * low,
    rayleigh: 1.4 + 1.6 * low,
    mieCoefficient: 0.004 + 0.006 * low,
    night,
    stars,
  };
}
