/**
 * The Earth's atmosphere as a physical model (after Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere
 * Rendering Technique", the approach behind V-Ray's and Unreal's sun & sky): air (Rayleigh scattering, blue), aerosols
 * (Mie scattering, the white haze around the sun) and ozone (absorbing orange, which keeps twilight blue). Distances in
 * kilometres, coefficients per kilometre, for red, green and blue. The sky shader (`physicalSky.ts`) uses the same
 * numbers, so the sunlight and the sky always agree.
 */
export const ATMOSPHERE = {
  groundRadius: 6360,
  topRadius: 6460,
  rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleighHeight: 8,
  mieScattering: 3.996e-3,
  mieExtinction: 4.4e-3,
  mieHeight: 1.2,
  /** Forward scattering of aerosols (the bright halo around the sun). */
  mieG: 0.8,
  ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3] as const,
  ozoneCentre: 25,
  ozoneWidth: 15,
  groundAlbedo: 0.3,
  /** The viewer's height above the ground (km). */
  viewHeight: 0.002,
  /** The sun's angular radius (radians). */
  sunRadius: (0.2666 * Math.PI) / 180,
};

/** How much aerosol there is: a clear mountain day, an ordinary day, or a hazy summer afternoon. */
export const HAZE = { clear: 0.4, normal: 1, hazy: 3 } as const;
export type HazeId = keyof typeof HAZE;

export function isHaze(id: unknown): id is HazeId {
  return typeof id === 'string' && id in HAZE;
}

/** What the photorealistic view needs from the atmosphere for a height of the sun. */
export interface Atmosphere {
  /** Colour of direct sunlight (linear RGB, brightest channel 1). */
  sunColor: [number, number, number];
  /** Direct sunlight on the ground relative to sunlight above the atmosphere (the brightest channel), 0 below the horizon. */
  sunIntensity: number;
  /** 0 by day and through twilight, 1 in the dark of night (sun 14° or more below the horizon): stars and moonlight. */
  night: number;
  /**
   * How much a photographer would open up the exposure: 1 by day, rising through twilight to 16 (four stops) at
   * night, so the blue hour and the night stay visible instead of going black.
   */
  exposure: number;
}

const RAD = Math.PI / 180;

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Extinction (per km, RGB) at `height` km above the ground, with `haze` times the usual aerosol. */
export function extinction(height: number, haze: number): [number, number, number] {
  const a = ATMOSPHERE;
  const rayleigh = Math.exp(-height / a.rayleighHeight);
  const mie = Math.exp(-height / a.mieHeight) * haze;
  const ozone = Math.max(0, 1 - Math.abs(height - a.ozoneCentre) / a.ozoneWidth);
  return [0, 1, 2].map((c) => a.rayleighScattering[c] * rayleigh + a.mieExtinction * mie + a.ozoneAbsorption[c] * ozone) as [number, number, number];
}

/**
 * The fraction of sunlight (RGB) that reaches a viewer on the ground with the sun `altitudeDeg` above the horizon:
 * exp(−optical depth) along the ray to the top of the atmosphere over a round Earth. Zero once the Earth is in the way.
 */
export function transmittance(altitudeDeg: number, haze = 1): [number, number, number] {
  const a = ATMOSPHERE;
  const r = a.groundRadius + a.viewHeight;
  const mu = Math.sin(altitudeDeg * RAD);
  // Below the geometric horizon the Earth blocks the sun.
  if (mu < -Math.sqrt(1 - (a.groundRadius / r) ** 2)) return [0, 0, 0];
  const distance = -r * mu + Math.sqrt(r * r * (mu * mu - 1) + a.topRadius * a.topRadius);
  const steps = 200;
  const depth = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    // Steps bunched near the ground, where the air is dense.
    const t0 = distance * (i / steps) ** 2;
    const t1 = distance * ((i + 1) / steps) ** 2;
    const t = (t0 + t1) / 2;
    const height = Math.sqrt(r * r + t * t + 2 * r * t * mu) - a.groundRadius;
    const e = extinction(height, haze);
    for (let c = 0; c < 3; c++) depth[c] += e[c] * (t1 - t0);
  }
  return depth.map((d) => Math.exp(-d)) as [number, number, number];
}

/**
 * The atmosphere for a sun `altitudeDeg` above the horizon: the colour and strength of direct sunlight from the
 * physical model (white at noon, orange-red at sunset as the long path through the air scatters blue away), faded
 * out over the half degree the sun takes to set, and how far night has fallen.
 */
export function atmosphere(altitudeDeg: number, haze = 1): Atmosphere {
  const t = transmittance(Math.max(altitudeDeg, -0.5), haze);
  const top = Math.max(...t, 1e-6);
  const sunColor = t.map((c) => c / top) as [number, number, number];
  // The disc sinks below the horizon over its own diameter.
  const sunIntensity = top * smooth(-0.6, 0.4, altitudeDeg);
  return { sunColor, sunIntensity, night: 1 - smooth(-14, -6, altitudeDeg), exposure: 2 ** (4 * (1 - smooth(-9, 2, altitudeDeg))) };
}
