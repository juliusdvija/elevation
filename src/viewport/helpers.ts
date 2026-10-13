import * as THREE from 'three';
import { theme } from './theme';

const AXIS_LENGTH = 1_000_000; // 1 km

/** Red/green/blue model axes: solid on the positive side, dashed on the negative. */
export function createAxes(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'axes';
  const axes: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), theme.axisX],
    [new THREE.Vector3(0, 1, 0), theme.axisY],
    [new THREE.Vector3(0, 0, 1), theme.axisZ],
  ];

  for (const [dir, color] of axes) {
    const positive = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(AXIS_LENGTH)]),
      new THREE.LineBasicMaterial({ color }),
    );
    const negative = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-AXIS_LENGTH)]),
      new THREE.LineDashedMaterial({ color, dashSize: 250, gapSize: 250, transparent: true, opacity: 0.7 }),
    );
    negative.computeLineDistances();
    group.add(positive, negative);
  }
  group.renderOrder = 1;
  return group;
}

/** The smallest 1-2-5 step (…, 0.5, 1, 2, 5, 10, 20, 50 …) that is at least `raw`, within [min, max]. */
export function niceSpacing(raw: number, min = 0.1, max = 100_000): number {
  if (!(raw > 0)) return min;
  const decade = 10 ** Math.floor(Math.log10(raw));
  const m = raw / decade;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * decade;
  return Math.min(max, Math.max(min, Math.round(step * 1e6) / 1e6));
}

const GRID_CELLS = 300; // cells each way: enough to fill the view at the default zoom, few enough to rebuild at any scale

/**
 * Subtle ground grid on the XY plane that follows the snap spacing: cells of `spacing` with a heavier
 * line every ten, centred on the camera target. Rebuilt only when the spacing changes, so a grid of 1 mm
 * cells is as cheap as one of 1 m.
 */
export class AdaptiveGrid {
  readonly group = new THREE.Group();
  private spacing = 0;

  constructor() {
    this.group.name = 'grid';
  }

  update(spacing: number, center: THREE.Vector3): void {
    if (spacing !== this.spacing) {
      this.spacing = spacing;
      for (const child of [...this.group.children]) {
        this.group.remove(child);
        (child as THREE.GridHelper).geometry.dispose();
      }
      const size = spacing * GRID_CELLS;
      const minor = new THREE.GridHelper(size, GRID_CELLS, theme.gridMinor, theme.gridMinor);
      const major = new THREE.GridHelper(size, GRID_CELLS / 10, theme.gridMajor, theme.gridMajor);
      for (const grid of [minor, major]) {
        grid.rotation.x = Math.PI / 2;
        const material = grid.material as THREE.Material;
        material.depthWrite = false;
        grid.renderOrder = -1;
        this.group.add(grid);
      }
    }
    // Follow the target in whole major cells, so lines stay on the same coordinates.
    const step = this.spacing * 10;
    this.group.position.set(Math.round(center.x / step) * step, Math.round(center.y / step) * step, 0);
  }
}
