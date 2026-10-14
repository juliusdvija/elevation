import * as THREE from 'three';
import type { TextureKind } from '../core/materials';

const SIZE = 512;

/** A greyscale pattern for the colour (multiplied with the material colour) and a height map for relief. */
export interface MaterialMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

function canvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return { c, g: c.getContext('2d')! };
}

const grey = (v: number) => {
  const n = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${n},${n},${n})`;
};

/** A small deterministic random generator, so a material looks the same every time. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth tileable value noise on a `period`-cell lattice (0 to 1), for veins and clouds. */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const rnd = random(seed);
  const lattice = Array.from({ length: period * period }, () => rnd());
  const at = (i: number, j: number) => lattice[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = fade(x - i);
    const v = fade(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

/** Fills the canvas pixel by pixel with greys from `value(u, v)` (u and v from 0 to 1). */
function pixels(g: CanvasRenderingContext2D, value: (u: number, v: number) => number): void {
  const img = g.getImageData(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = Math.round(Math.min(1, Math.max(0, value(x / SIZE, y / SIZE))) * 255);
      const i = (y * SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Speckles over the whole canvas: `cell` pixels wide, brightness varying by `amount` around the current look. */
function speckle(g: CanvasRenderingContext2D, rnd: () => number, cell: number, amount: number, alpha = 1): void {
  g.save();
  g.globalAlpha = alpha;
  for (let y = 0; y < SIZE; y += cell) {
    for (let x = 0; x < SIZE; x += cell) {
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${amount})`;
      g.fillRect(x, y, cell, cell);
    }
  }
  g.restore();
}

/** Draws `draw` once on a colour canvas and once (as heights) on a bump canvas. */
function both(draw: (g: CanvasRenderingContext2D, height: boolean) => void): MaterialMaps {
  const colour = canvas();
  const height = canvas();
  draw(colour.g, false);
  draw(height.g, true);
  return { map: texture(colour.c, true), bump: texture(height.c, false) };
}

function texture(source: HTMLCanvasElement, colour: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(source);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PATTERNS: Record<TextureKind, () => MaterialMaps> = {
  brick: () =>
    both((g, height) => {
      const rnd = random(11);
      g.fillStyle = height ? grey(0) : grey(0.62); // mortar
      g.fillRect(0, 0, SIZE, SIZE);
      const rows = 16;
      const cols = 4;
      const h = SIZE / rows;
      const w = SIZE / cols;
      const gap = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const x = c * w + (r % 2 ? w / 2 : 0);
          g.fillStyle = height ? grey(0.85 + rnd() * 0.15) : grey(0.78 + rnd() * 0.22);
          g.fillRect(x + gap / 2, r * h + gap / 2, w - gap, h - gap);
        }
      }
      if (!height) speckle(g, rnd, 4, 0.06);
    }),
  boards: () =>
    both((g, height) => {
      const rnd = random(23);
      const rows = 8;
      const h = SIZE / rows;
      for (let r = 0; r < rows; r++) {
        const base = 0.78 + rnd() * 0.22;
        g.fillStyle = height ? grey(0.8) : grey(base);
        g.fillRect(0, r * h, SIZE, h);
        // Grain: long thin streaks along the board.
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.04 + rnd() * 0.06})`;
          g.fillRect(rnd() * SIZE - 100, r * h + rnd() * h, 100 + rnd() * 300, 1 + rnd() * 2);
        }
        g.fillStyle = height ? grey(0) : grey(0.35);
        g.fillRect(0, r * h, SIZE, 3); // seam between boards
        g.fillRect(rnd() * SIZE, r * h, 3, h); // butt joint
      }
    }),
  planks: () =>
    both((g, height) => {
      // Narrow floor boards with staggered end joints and a tone per board.
      const rnd = random(29);
      const rows = 12;
      const h = SIZE / rows;
      for (let r = 0; r < rows; r++) {
        const base = 0.72 + rnd() * 0.28;
        g.fillStyle = height ? grey(0.8) : grey(base);
        g.fillRect(0, r * h, SIZE, h);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd() * 0.07})`;
          g.fillRect(rnd() * SIZE - 120, r * h + rnd() * h, 120 + rnd() * 360, 0.5 + rnd() * 1.5);
        }
        // A knot now and then.
        if (!height && rnd() > 0.6) {
          g.fillStyle = 'rgba(60,30,10,0.25)';
          g.beginPath();
          g.ellipse(rnd() * SIZE, r * h + h / 2, 6 + rnd() * 6, 2 + rnd() * 2, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = height ? grey(0.1) : grey(0.4);
        g.fillRect(0, r * h, SIZE, 2);
        const joint = ((r * 0.37) % 1) * SIZE;
        g.fillRect(joint, r * h, 2, h);
        g.fillRect((joint + SIZE / 2) % SIZE, r * h, 2, h);
      }
    }),
  marble: () =>
    both((g, height) => {
      // Veins: the sine of a turbulent field, sharpened into thin dark lines on a cloudy ground.
      const n1 = valueNoise(71, 8);
      const n2 = valueNoise(73, 16);
      const n3 = valueNoise(79, 32);
      pixels(g, (u, v) => {
        const turbulence = n1(u * 8, v * 8) * 0.5 + n2(u * 16, v * 16) * 0.3 + n3(u * 32, v * 32) * 0.2;
        const vein = Math.pow(Math.abs(Math.sin((u + v * 0.6) * Math.PI * 4 + turbulence * 7)), 0.25);
        const cloud = 0.92 + 0.08 * n2(u * 16 + 3, v * 16 + 5);
        return height ? 0.5 + 0.02 * vein : cloud * (0.55 + 0.45 * vein);
      });
    }),
  terrazzo: () =>
    both((g, height) => {
      const rnd = random(83);
      g.fillStyle = grey(height ? 0.5 : 0.93);
      g.fillRect(0, 0, SIZE, SIZE);
      speckle(g, rnd, 2, 0.04);
      // Chips of stone: small irregular polygons in assorted greys and a few warm tones.
      for (let i = 0; i < 900; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 2 + Math.pow(rnd(), 3) * 14;
        const tone = rnd();
        g.fillStyle = height ? grey(0.5) : tone > 0.85 ? `rgb(${180 + rnd() * 40},${110 + rnd() * 30},${80 + rnd() * 20})` : grey(0.25 + rnd() * 0.6);
        g.beginPath();
        const corners = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k < corners; k++) {
          const a = (k / corners) * Math.PI * 2;
          const d = r * (0.6 + rnd() * 0.4);
          g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
        }
        g.fill();
      }
    }),
  brushed: () =>
    both((g, height) => {
      // Fine streaks all running one way.
      const rnd = random(89);
      g.fillStyle = grey(height ? 0.5 : 0.88);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd() * 0.06})`;
        g.fillRect(rnd() * SIZE - 200, rnd() * SIZE, 100 + rnd() * 400, 1);
      }
    }),
  fabric: () =>
    both((g, height) => {
      // A plain weave: alternating over-and-under threads.
      const rnd = random(97);
      const threads = 64;
      const step = SIZE / threads;
      g.fillStyle = grey(height ? 0.2 : 0.7);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let j = 0; j < threads; j++) {
        for (let i = 0; i < threads; i++) {
          const over = (i + j) % 2 === 0;
          const shade = 0.8 + rnd() * 0.15;
          g.fillStyle = height ? grey(over ? 0.95 : 0.6) : grey(over ? shade : shade * 0.88);
          if (over) g.fillRect(i * step, j * step + 1, step, step - 2);
          else g.fillRect(i * step + 1, j * step, step - 2, step);
        }
      }
      if (!height) speckle(g, rnd, 2, 0.04);
    }),
  gravel: () =>
    both((g, height) => {
      // Round stones, lit from above in the height map so they read as pebbles.
      const rnd = random(101);
      g.fillStyle = grey(height ? 0 : 0.45);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 2600; i++) {
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        const r = 3 + rnd() * 6;
        const tone = 0.6 + rnd() * 0.4;
        const gradient = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        gradient.addColorStop(0, grey(height ? 1 : tone));
        gradient.addColorStop(1, grey(height ? 0.3 : tone * 0.7));
        g.fillStyle = gradient;
        g.beginPath();
        g.ellipse(x, y, r, r * (0.7 + rnd() * 0.3), rnd() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }),
  tiles: () =>
    both((g, height) => {
      const rnd = random(37);
      g.fillStyle = height ? grey(0) : grey(0.4);
      g.fillRect(0, 0, SIZE, SIZE);
      const rows = 8;
      const cols = 8;
      const h = SIZE / rows;
      const w = SIZE / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const x = c * w + (r % 2 ? w / 2 : 0);
          g.fillStyle = height ? grey(0.8 + rnd() * 0.2) : grey(0.8 + rnd() * 0.2);
          g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        }
      }
      if (!height) speckle(g, rnd, 8, 0.04);
    }),
  concrete: () =>
    both((g, height) => {
      const rnd = random(41);
      g.fillStyle = grey(height ? 0.5 : 0.85);
      g.fillRect(0, 0, SIZE, SIZE);
      speckle(g, rnd, 32, 0.05);
      speckle(g, rnd, 8, 0.06);
      speckle(g, rnd, 2, 0.1);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.arc(rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 2, 0, Math.PI * 2);
        g.fill();
      }
    }),
  plaster: () =>
    both((g, height) => {
      const rnd = random(53);
      g.fillStyle = grey(height ? 0.5 : 0.95);
      g.fillRect(0, 0, SIZE, SIZE);
      speckle(g, rnd, 16, 0.025);
      speckle(g, rnd, 2, 0.05);
    }),
  grass: () =>
    both((g, height) => {
      const rnd = random(67);
      g.fillStyle = grey(height ? 0.4 : 0.8);
      g.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 6000; i++) {
        g.strokeStyle = height ? grey(0.3 + rnd() * 0.7) : grey(0.55 + rnd() * 0.45);
        g.lineWidth = 1;
        const x = rnd() * SIZE;
        const y = rnd() * SIZE;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * 6, y - 3 - rnd() * 7);
        g.stroke();
      }
    }),
  water: () =>
    both((g, height) => {
      g.fillStyle = grey(height ? 0.5 : 0.95);
      g.fillRect(0, 0, SIZE, SIZE);
      const img = g.getImageData(0, 0, SIZE, SIZE);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const a = (x / SIZE) * Math.PI * 2;
          const b = (y / SIZE) * Math.PI * 2;
          const v = 0.5 + 0.25 * Math.sin(a * 3 + Math.sin(b * 2)) + 0.25 * Math.sin(b * 4 + Math.sin(a * 3));
          const out = height ? v : 0.9 + 0.1 * v;
          const i = (y * SIZE + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(out * 255);
        }
      }
      g.putImageData(img, 0, 0);
    }),
};

const cache = new Map<TextureKind, MaterialMaps>();

/** The (cached) maps for a pattern, drawn on first use. */
export function mapsFor(kind: TextureKind): MaterialMaps {
  let maps = cache.get(kind);
  if (!maps) cache.set(kind, (maps = PATTERNS[kind]()));
  return maps;
}
