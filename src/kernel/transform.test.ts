import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from './Model';
import { drawPolygon } from './draw';
import { pushPull } from './pushPull';
import { faceArea } from './faces';
import { copyEntities, transformVertices, verticesOf } from './transform';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];
const translate = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

function box(model: Model, x0 = 0, y0 = 0, size = 1000, height = 1000) {
  model.edit(() => drawPolygon(model, rect(x0, y0, x0 + size, y0 + size)));
  const ground = model.allFaces().find((f) => f.normal.z === -1 && model.position(f.outer[0]).x >= x0)!;
  model.edit(() => pushPull(model, ground.id, -height));
}

const closed = (model: Model) => model.allEdges().every((e) => model.facesOfEdge(e.id).length === 2);
function volume(model: Model) {
  let total = 0;
  for (const face of model.allFaces()) total += (faceArea(model, face) * face.normal.dot(model.position(face.outer[0]))) / 3;
  return Math.round(total);
}
const all = (model: Model) => verticesOf(model, model.allFaces().map((f) => f.id), model.allEdges().map((e) => e.id));

describe('move', () => {
  it('moves a whole box without changing it', () => {
    const model = new Model();
    box(model);
    model.edit(() => transformVertices(model, all(model), translate(500, 200, 0)));
    expect(model.faceCount).toBe(6);
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(1_000_000_000);
    expect(model.bounds().min.toArray()).toEqual([500, 200, 0]);
  });

  it('stretches a box when only its top face moves', () => {
    const model = new Model();
    box(model);
    const top = model.allFaces().find((f) => f.normal.z === 1)!;
    model.edit(() => transformVertices(model, verticesOf(model, [top.id], []), translate(0, 0, 500)));
    expect(volume(model)).toBe(1_500_000_000);
    expect(closed(model)).toBe(true);
  });

  it('folds a face that bends when one corner moves', () => {
    const model = new Model();
    box(model);
    const corner = model.findVertex(v(1000, 1000, 1000))!;
    model.edit(() => transformVertices(model, [corner], translate(0, 0, 300)));
    expect(closed(model)).toBe(true);
    // The walls stay vertical (still flat); only the top folds into two triangles.
    expect(model.faceCount).toBe(7);
    for (const f of model.allFaces()) {
      const ps = f.outer.map((id) => model.position(id));
      const n = f.normal;
      expect(ps.every((p) => Math.abs(n.dot(p) - n.dot(ps[0])) < 1e-6)).toBe(true);
    }
  });

  it('rotates a box a quarter turn about its corner', () => {
    const model = new Model();
    box(model, 0, 0, 1000, 2000);
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    model.edit(() => transformVertices(model, all(model), m));
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(2_000_000_000);
    const b = model.bounds();
    expect([Math.round(b.min.x), Math.round(b.max.x)]).toEqual([-1000, 0]);
  });
});

describe('copy', () => {
  it('copies a box beside the original', () => {
    const model = new Model();
    box(model);
    const faces = model.allFaces().map((f) => f.id);
    model.edit(() => copyEntities(model, faces, [], translate(2000, 0, 0)));
    expect(model.faceCount).toBe(12);
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(2_000_000_000);
  });

  it('fuses a copy that touches the original into one block', () => {
    const model = new Model();
    box(model);
    const faces = model.allFaces().map((f) => f.id);
    model.edit(() => copyEntities(model, faces, [], translate(1000, 0, 0)));
    // The shared walls cancel out and the coplanar sides merge, as with loose SketchUp geometry.
    expect(model.vertexCount).toBe(8);
    expect(model.faceCount).toBe(6);
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(2_000_000_000);
  });
});

describe('settling after push/pull', () => {
  it('merges a block pulled flush with the roof beside it', () => {
    const model = new Model();
    box(model, 0, 0, 3000, 3200);
    // Porch against the front wall, 2400 high.
    model.edit(() => drawPolygon(model, rect(1000, -1500, 2000, 0)));
    const porch = model.allFaces().find((f) => f.normal.z === -1 && Math.round(faceArea(model, f)) === 1_500_000)!;
    model.edit(() => pushPull(model, porch.id, -2400));
    const porchTop = model.allFaces().find((f) => f.normal.z === 1 && model.position(f.outer[0]).z === 2400)!;
    model.edit(() => pushPull(model, porchTop.id, 800));
    expect(closed(model)).toBe(true);
    const roofs = model.allFaces().filter((f) => f.normal.z === 1);
    expect(roofs).toHaveLength(1);
    expect(Math.round(faceArea(model, roofs[0]))).toBe(9_000_000 + 1_500_000);
  });
});
