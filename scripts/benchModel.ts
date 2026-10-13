import * as THREE from 'three';
import { Model } from '../src/kernel/Model';
import { drawPolygon } from '../src/kernel/draw';
import { pushPull } from '../src/kernel/pushPull';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];

export function time<T>(fn: () => T): [T, number] {
  const t = performance.now();
  const r = fn();
  return [r, performance.now() - t];
}

export function house(m: Model, x: number, y: number) {
  m.edit(() => {
    drawPolygon(m, rect(x, y, x + 3000, y + 3000));
    const base = m.allFaces().find((f) => f.normal.z < -0.99 && m.faceVertices(f).some((id) => m.position(id).x === x && m.position(id).y === y) && m.facesOfEdge(m.faceEdges(f)[0]).length === 1)!;
    pushPull(m, base.id, -3000);
    for (const wx of [x + 500, x + 1800]) {
      drawPolygon(m, [v(wx, y, 1000), v(wx + 700, y, 1000), v(wx + 700, y, 2200), v(wx, y, 2200)]);
      const win = m.allFaces().find((f) => f.normal.y < -0.99 && m.faceVertices(f).length === 4 && m.faceVertices(f).every((id) => m.position(id).y === y && m.position(id).x >= wx && m.position(id).x <= wx + 700 && m.position(id).z >= 1000 && m.position(id).z <= 2200));
      if (win) pushPull(m, win.id, -150);
    }
  });
}

