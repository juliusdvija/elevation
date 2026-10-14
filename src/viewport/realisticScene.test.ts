import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../document';
import { drawPolygon } from '../kernel/draw';
import { paintFaces } from '../kernel/cleanup';
import { pushPull } from '../kernel/pushPull';
import { buildMaterialBuckets, textureFrame } from './realisticScene';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function box(doc: Document, brick: boolean) {
  const model = doc.model;
  model.edit(() => drawPolygon(model, [v(0, 0), v(2000, 0), v(2000, 1000), v(0, 1000)]));
  model.edit(() => pushPull(model, model.allFaces()[0].id, 3000));
  if (brick) {
    const walls = model.allFaces().filter((f) => Math.abs(f.normal.z) < 0.1).map((f) => f.id);
    model.edit(() => paintFaces(model, walls, '#b5654a', undefined, 'brick', 'brick'));
  }
}

describe('textureFrame', () => {
  it('runs level along walls and east-north on floors', () => {
    const wall = textureFrame(new THREE.Vector3(0, -1, 0));
    expect(wall.u.z).toBeCloseTo(0);
    expect(wall.v.z).toBeCloseTo(1);
    const floor = textureFrame(new THREE.Vector3(0, 0, 1));
    expect(floor.u.toArray()).toEqual([1, 0, 0]);
    expect(floor.v.toArray()).toEqual([0, 1, 0]);
  });
});

describe('buildMaterialBuckets', () => {
  it('sorts faces into one bucket per material', () => {
    const doc = new Document();
    box(doc, true);
    const buckets = buildMaterialBuckets(doc.placements(), 0);
    expect([...buckets.keys()].sort()).toEqual(['brick|#b5654a|1', 'paint:#ffffff:1|#ffffff|1']);
    // 4 walls and 2 caps, 2 triangles each.
    expect(buckets.get('brick|#b5654a|1')!.positions.length / 9).toBe(8);
    expect(buckets.get('paint:#ffffff:1|#ffffff|1')!.positions.length / 9).toBe(4);
  });

  it('winds triangles to match the face normals and gives every vertex a normal and uv', () => {
    const doc = new Document();
    box(doc, false);
    const [bucket] = buildMaterialBuckets(doc.placements(), 0).values();
    const count = bucket.positions.length / 3;
    expect(bucket.normals.length / 3).toBe(count);
    expect(bucket.uvs.length / 2).toBe(count);
    for (let i = 0; i < count; i += 3) {
      const p = (k: number) => new THREE.Vector3().fromArray(bucket.positions, (i + k) * 3);
      const cross = p(1).sub(p(0)).cross(p(2).sub(p(0)));
      expect(cross.dot(new THREE.Vector3().fromArray(bucket.normals, i * 3))).toBeGreaterThan(0);
    }
  });

  it('scales texture coordinates by the material tile size', () => {
    const doc = new Document();
    box(doc, true);
    const bucket = buildMaterialBuckets(doc.placements(), 0).get('brick|#b5654a|1')!;
    // Brick repeats every 1000 mm, so the 3000 mm high walls span 3 repeats up the wall (v).
    const vs = bucket.uvs.filter((_, i) => i % 2 === 1);
    const span = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(span(vs)).toBeCloseTo(3, 5);
  });
});
