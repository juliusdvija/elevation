import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { paintFaces } from '../kernel/cleanup';
import { faceArea } from '../kernel/faces';
import { exportObj } from './objExport';
import { buildModel, parseObj } from './obj';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function box(): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(2000, 0), v(2000, 3000), v(0, 3000)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -4000));
  return m;
}

const volume = (m: Model) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);

describe('OBJ export', () => {
  it('writes metres, Y up, flat normals, and reads back as the same solid', () => {
    const m = box();
    const { obj, mtl } = exportObj(m, 'box');
    expect(mtl).toBeUndefined();
    expect(obj).toContain('# units: metres');
    expect(obj.match(/^v /gm)).toHaveLength(8);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    // Height (z, 4 m) is written as y; depth (y, 3 m) as -z.
    const ys = obj.split('\n').filter((l) => l.startsWith('v ')).map((l) => l.split(' ').map(Number));
    expect(Math.max(...ys.map((p) => p[2]))).toBe(4);
    expect(Math.min(...ys.map((p) => p[3]))).toBe(-3);

    const back = buildModel(parseObj(obj), { scale: 1000, yUp: true });
    expect(back.faceCount).toBe(6);
    expect(back.bounds().getSize(new THREE.Vector3()).toArray()).toEqual([2000, 3000, 4000]);
    expect(volume(back)).toBeCloseTo(2000 * 3000 * 4000, -4);
  });

  it('writes colours and glass to a .mtl that the importer reads back', () => {
    const m = box();
    const front = m.allFaces().find((f) => f.normal.y < -0.99)!;
    const top = m.allFaces().find((f) => f.normal.z > 0.99)!;
    m.edit(() => paintFaces(m, [front.id], '#b5654a'));
    m.edit(() => paintFaces(m, [top.id], '#9fc3d6', 0.4));
    const { obj, mtl } = exportObj(m, 'house');
    expect(obj).toContain('mtllib house.mtl');
    expect(mtl).toContain('Kd 0.7098 0.3961 0.2902');
    expect(mtl).toContain('d 0.4');
    const back = buildModel(parseObj(obj, mtl), { scale: 1000, yUp: true });
    expect(back.allFaces().filter((f) => f.color === '#b5654a')).toHaveLength(1);
    const glass = back.allFaces().filter((f) => f.opacity !== undefined);
    expect(glass).toHaveLength(1);
    expect(glass[0].opacity).toBeCloseTo(0.4);
    const plain = exportObj(m, 'house', { unitMm: 1, yUp: false, colors: false });
    expect(plain.mtl).toBeUndefined();
    expect(plain.obj).not.toContain('mtllib');
  });

  it('keeps holes: a wall with a window opening exports as triangles that leave it open', () => {
    const m = box();
    const wall = m.allFaces().find((f) => f.normal.y < -0.99)!;
    m.edit(() => drawPolygon(m, [v(500, 0, 1000), v(1500, 0, 1000), v(1500, 0, 2500), v(500, 0, 2500)]));
    const hole = m.allFaces().find((f) => f.normal.y < -0.99 && f.id !== wall.id && f.outer.length === 4 && m.faceVertices(f).every((id) => m.position(id).x >= 500 && m.position(id).x <= 1500))!;
    m.edit(() => pushPull(m, hole.id, -300));
    const back = buildModel(parseObj(exportObj(m, 'win').obj), { scale: 1000, yUp: true });
    // The recess survives the round trip: same volume.
    expect(volume(back)).toBeCloseTo(volume(m), -4);
  });
});
