import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { circlePoints } from '../kernel/shapes';
import { faceArea } from '../kernel/faces';
import { exportStl } from './stlExport';
import { parseStl } from './mesh';
import { buildModel } from './obj';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function part(): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(24, 0), v(24, 12), v(0, 12)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -8));
  return m;
}

const volume = (m: Model) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);

describe('STL export', () => {
  it('writes a watertight part as binary STL in millimetres', () => {
    const result = exportStl(part(), 'Part');
    expect(result.openEdges).toBe(0);
    expect(result.triangles).toBe(12);
    expect(result.data.length).toBe(84 + 12 * 50);
    expect(new TextDecoder().decode(result.data.slice(0, 11))).toBe('Part - Elev');
    expect(new DataView(result.data.buffer).getUint32(80, true)).toBe(12);
    expect(result.size.toArray()).toEqual([24, 12, 8]);
  });

  it('reads back through the importer as the same solid', () => {
    const m = part();
    // A round pocket in the top: curved walls make many small triangles.
    m.edit(() => drawPolygon(m, circlePoints(v(12, 6, 8), v(0, 0, 1), 3, 16)));
    m.edit(() => pushPull(m, m.allFaces().find((f) => f.holes.length === 0 && f.outer.length === 16)!.id, -3));
    const back = buildModel(parseStl(exportStl(m).data.buffer as ArrayBuffer), { scale: 1, yUp: false });
    expect(back.allEdges().every((e) => back.facesOfEdge(e.id).length === 2)).toBe(true);
    expect(volume(back)).toBeCloseTo(volume(m), 2);
  });

  it('reports an open surface, which would not print', () => {
    const m = part();
    m.edit(() => m.removeFace(m.allFaces().find((f) => f.normal.z > 0.99)!.id));
    expect(exportStl(m).openEdges).toBe(4);
  });

  it('triangulates faces with holes so the hole stays open', () => {
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(100, 0), v(100, 100), v(0, 100)]));
    m.edit(() => drawPolygon(m, [v(40, 40), v(60, 40), v(60, 60), v(40, 60)]));
    const outer = m.allFaces().find((f) => f.holes.length === 1)!;
    m.edit(() => m.removeFace(m.allFaces().find((f) => f.id !== outer.id)!.id));
    const view = new DataView(exportStl(m).data.buffer);
    let area = 0;
    for (let i = 0; i < view.getUint32(80, true); i++) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3(view.getFloat32(84 + i * 50 + 12 + k * 12, true), view.getFloat32(84 + i * 50 + 16 + k * 12, true), view.getFloat32(84 + i * 50 + 20 + k * 12, true)));
      area += new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).length() / 2;
    }
    expect(area).toBeCloseTo(10000 - 400, 3);
  });
});
