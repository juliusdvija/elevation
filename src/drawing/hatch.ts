import * as THREE from 'three';

/** A hatch pattern a face can carry: its id, and a name for menus. */
export const HATCHES: { id: string; label: string }[] = [
  { id: 'brick', label: 'Brick' },
  { id: 'boards', label: 'Boards' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'grass', label: 'Grass' },
];

/** The extent of a face in its own plane (mm). */
export interface HatchBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Module {
  /** Spacing of the pattern in the face's plane (mm), at true size. */
  size: number;
  /** The smallest the pattern may look on paper (mm); it is spaced out until it is at least this. */
  paperMin: number;
}

const MODULES: Record<string, Module> = {
  brick: { size: 75, paperMin: 1.3 }, // one course
  boards: { size: 180, paperMin: 1.6 },
  tiles: { size: 300, paperMin: 2.4 },
  concrete: { size: 500, paperMin: 3.2 },
  grass: { size: 400, paperMin: 3 },
};

/** A fixed pseudo-random number in [0, 1) from two integers, so stipple stays put between redraws. */
function noise(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const MAX_SEGMENTS = 700;

/**
 * Line segments of a hatch over a box in the face's plane, spaced for a drawing at 1:`scale` so the
 * pattern never gets finer than it can be read. The caller clips them to the face.
 */
export function hatchSegments(kind: string, box: HatchBox, scale: number): [THREE.Vector2, THREE.Vector2][] {
  const module = MODULES[kind];
  if (!module) return [];
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width <= 0 || height <= 0) return [];
  // Spread the pattern out until it reads on paper, and until it stays a sensible number of lines.
  let step = module.size * Math.max(1, Math.ceil((module.paperMin * scale) / module.size));
  const estimate = (s: number) => (width / s + 1) * (height / s + 1);
  while (estimate(step) > MAX_SEGMENTS * (kind === 'brick' ? 0.4 : 1)) step *= 1.5;

  const out: [THREE.Vector2, THREE.Vector2][] = [];
  const V = (x: number, y: number) => new THREE.Vector2(x, y);
  const x0 = Math.floor(box.minX / step) * step;
  const y0 = Math.floor(box.minY / step) * step;

  switch (kind) {
    case 'brick': {
      // Courses are horizontal lines; the joints between bricks alternate by half a brick.
      const brick = step * 3;
      for (let row = 0, y = y0; y <= box.maxY + step; row++, y += step) {
        out.push([V(box.minX, y), V(box.maxX, y)]);
        const offset = (row % 2) * (brick / 2);
        for (let x = Math.floor((box.minX - offset) / brick) * brick + offset; x <= box.maxX + brick; x += brick) out.push([V(x, y), V(x, y + step)]);
      }
      break;
    }
    case 'boards':
      for (let x = x0; x <= box.maxX + step; x += step) out.push([V(x, box.minY), V(x, box.maxY)]);
      break;
    case 'tiles':
      for (let x = x0; x <= box.maxX + step; x += step) out.push([V(x, box.minY), V(x, box.maxY)]);
      for (let y = y0; y <= box.maxY + step; y += step) out.push([V(box.minX, y), V(box.maxX, y)]);
      break;
    case 'concrete': {
      // Stipple: short ticks at jittered grid points.
      const tick = step * 0.12;
      for (let i = 0, x = x0; x <= box.maxX + step; i++, x += step) {
        for (let j = 0, y = y0; y <= box.maxY + step; j++, y += step) {
          const px = x + (noise(i, j) - 0.5) * step * 0.8;
          const py = y + (noise(j, i + 7) - 0.5) * step * 0.8;
          out.push([V(px, py), V(px + tick, py + tick * 0.4)]);
        }
      }
      break;
    }
    case 'grass': {
      // Short upright blades.
      const blade = step * 0.35;
      for (let i = 0, x = x0; x <= box.maxX + step; i++, x += step) {
        for (let j = 0, y = y0; y <= box.maxY + step; j++, y += step) {
          const px = x + (noise(i, j) - 0.5) * step;
          const py = y + (noise(j, i + 3) - 0.5) * step;
          out.push([V(px, py), V(px + (noise(i + 5, j) - 0.5) * blade * 0.5, py + blade)]);
        }
      }
      break;
    }
  }
  return out;
}
