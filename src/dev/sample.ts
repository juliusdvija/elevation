import * as THREE from 'three';
import type { Document } from '../document';
import type { Face } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { faceArea } from '../kernel/faces';
import { pushPull } from '../kernel/pushPull';

/**
 * Builds a small test building through the same kernel operations the tools
 * use: a low volume with a courtyard, a taller wing with window recesses and
 * an entrance porch. Development aid only.
 */
export function buildSample(doc: Document): void {
  const m = doc.model;
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];
  const find = (pred: (f: Face) => boolean) => {
    const face = m.allFaces().find(pred);
    if (!face) throw new Error('Sample face not found');
    return face.id;
  };
  const area = (f: Face) => Math.round(faceArea(m, f));

  doc.run('Sample building', () => {
    drawPolygon(m, rect(0, 0, 12000, 8000));
    pushPull(m, m.allFaces()[0].id, -3200);
    drawPolygon(m, rect(8000, 0, 12000, 8000, 3200));
    pushPull(m, find((f) => f.normal.z === 1 && area(f) === 32_000_000), 3200);
    drawPolygon(m, rect(2000, 2500, 6000, 5500, 3200));
    pushPull(m, find((f) => f.normal.z === 1 && area(f) === 12_000_000), -2400);
    drawPolygon(m, rect(1000, -1500, 4000, 0));
    pushPull(m, find((f) => f.normal.z === -1 && area(f) === 4_500_000), -2400);
    for (const x0 of [8800, 10200]) {
      drawPolygon(m, [v(x0, 0, 4000), v(x0 + 1200, 0, 4000), v(x0 + 1200, 0, 5600), v(x0, 0, 5600)]);
      // The new window face in the facade plane (y = 0), not an earlier recess.
      pushPull(m, find((f) => f.normal.y === -1 && area(f) === 1_920_000 && m.position(f.outer[0]).y === 0), -200);
    }
  });
}
