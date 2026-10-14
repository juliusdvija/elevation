import * as THREE from 'three';

/**
 * Photographed skies (CC0 HDR panoramas from `@pmndrs/assets`, 512 × 256), loaded one at a time when chosen. They
 * light the model and show behind it instead of the time-of-day sky; each is turned so its sun stands where the
 * document's sun is, so the shadows agree with the picture.
 */
export const HDRIS = {
  park: { name: 'Park', load: () => import('@pmndrs/assets/hdri/park.exr.js') },
  sky: { name: 'Clear sky', load: () => import('@pmndrs/assets/hdri/sky.exr.js') },
  sunrise: { name: 'Sunrise', load: () => import('@pmndrs/assets/hdri/sunrise.exr.js') },
  sunset: { name: 'Sunset', load: () => import('@pmndrs/assets/hdri/sunset.exr.js') },
  dawn: { name: 'Dawn', load: () => import('@pmndrs/assets/hdri/dawn.exr.js') },
  forest: { name: 'Forest', load: () => import('@pmndrs/assets/hdri/forest.exr.js') },
  city: { name: 'City', load: () => import('@pmndrs/assets/hdri/city.exr.js') },
  night: { name: 'Night', load: () => import('@pmndrs/assets/hdri/night.exr.js') },
} as const;

export type HdriId = keyof typeof HDRIS;

export function isHdri(id: unknown): id is HdriId {
  return typeof id === 'string' && id in HDRIS;
}

/** Where the brightest light of an equirectangular panorama comes from, as a Y-up direction (row 0 is the bottom). */
export function brightestDirection(data: ArrayLike<number>, width: number, height: number, channels = 4): { direction: THREE.Vector3; luminance: number } {
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l > best) {
        best = l;
        bx = x;
        by = y;
      }
    }
  }
  // three's equirect mapping: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5.
  const u = (bx + 0.5) / width;
  const v = (by + 0.5) / height;
  const phi = (u - 0.5) * 2 * Math.PI;
  const theta = (v - 0.5) * Math.PI;
  return { direction: new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)), luminance: best };
}

/**
 * The turn about the vertical (radians, for the scene's environment rotation as Euler(−π/2, 0, turn, 'XZY')) that
 * brings a panorama's sun (Y-up direction) to the model's sun (Z-up direction).
 */
export function alignTurn(panoramaSun: THREE.Vector3, modelSun: THREE.Vector3): number {
  // The panorama's sun in model axes, untouched: Y-up (x, y, z) is model (x, −z, y).
  const unturned = Math.atan2(-panoramaSun.z, panoramaSun.x);
  return unturned - Math.atan2(modelSun.y, modelSun.x);
}

export interface Hdri {
  texture: THREE.DataTexture;
  /** The panorama's sun (Y-up), or null for an even light without a sun (overcast, night). */
  sun: THREE.Vector3 | null;
}

const cache = new Map<HdriId, Promise<Hdri>>();

/** Loads (once) and decodes a panorama. */
export function loadHdri(id: HdriId): Promise<Hdri> {
  let pending = cache.get(id);
  if (!pending) {
    pending = Promise.all([HDRIS[id].load(), import('three/examples/jsm/loaders/EXRLoader.js')]).then(async ([module, { EXRLoader }]) => {
      const bytes = await (await fetch(module.default as string)).arrayBuffer();
      const loader = new EXRLoader();
      loader.setDataType(THREE.FloatType);
      const parsed = loader.parse(bytes) as unknown as { data: Float32Array; width: number; height: number; format: THREE.PixelFormat };
      const texture = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, parsed.format, THREE.FloatType);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      const { direction, luminance } = brightestDirection(parsed.data, parsed.width, parsed.height);
      // A sun is a point many times brighter than the sky around it, and above the horizon.
      const mean = parsed.data.reduce((sum, v, i) => (i % 4 === 1 ? sum + v : sum), 0) / (parsed.width * parsed.height);
      return { texture, sun: luminance > 40 * mean && direction.y > 0 ? direction : null };
    });
    cache.set(id, pending);
  }
  return pending;
}
