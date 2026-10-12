import * as THREE from 'three';
import { theme } from './theme';

/**
 * Temporary massing model to test navigation and the visual style.
 * Replaced by real model geometry once the half-edge kernel lands (phase 1).
 */
export function createDemoMassing(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'demo';

  const blocks: [number, number, number, number, number][] = [
    // width, depth, height, x, y (mm, min corner)
    [9000, 6000, 3200, 0, 0],
    [4000, 6000, 6400, 9000, 0],
    [3000, 2400, 3200, 2000, -2400],
  ];

  for (const [w, d, h, x, y] of blocks) {
    const geometry = new THREE.BoxGeometry(w, d, h).translate(x + w / 2, y + d / 2, h / 2);
    const faces = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        color: theme.face,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: theme.edge }),
    );
    group.add(faces, edges);
  }
  return group;
}
