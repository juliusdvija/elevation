import * as THREE from 'three';
import { theme } from './theme';

const AXIS_LENGTH = 1_000_000; // 1 km
const GRID_SIZE = 200_000; // 200 m

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

/** Subtle ground grid on the XY plane: 1 m cells with a heavier 10 m grid. */
export function createGrid(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grid';

  const minor = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / 1000, theme.gridMinor, theme.gridMinor);
  const major = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / 10_000, theme.gridMajor, theme.gridMajor);
  for (const grid of [minor, major]) {
    grid.rotation.x = Math.PI / 2;
    const material = grid.material as THREE.Material;
    material.depthWrite = false;
    grid.renderOrder = -1;
    group.add(grid);
  }
  return group;
}
