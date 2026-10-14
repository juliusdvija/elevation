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
