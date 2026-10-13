import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from './Model';
import { drawPolygon } from './draw';
import { pushPull } from './pushPull';
import { faceArea } from './faces';
import { copyEntities, mirrors, scaleAbout, transformVertices, verticesOf } from './transform';
import { validateModel } from './validate';
import { Document } from '../document';

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

describe('scale and flip', () => {
  const scaled = (model: Model, factors: THREE.Vector3, anchor = v(0, 0, 0)) =>
    model.edit(() => transformVertices(model, all(model), scaleAbout(anchor, factors)));

  it('scales a box about a point: sizes and volume follow, faces stay outward', () => {
    const model = new Model();
    box(model, 0, 0, 1000, 1000);
    scaled(model, v(2, 2, 2));
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(8 * 1e9);
    expect(validateModel(model, { orientation: true })).toEqual([]);
    const second = new Model();
    box(second, 0, 0, 1000, 1000);
    scaled(second, v(1, 1, 0.5));
    expect(volume(second)).toBe(5e8);
    expect(second.bounds().max.z).toBe(500);
    // About another point: that point stays put.
    const third = new Model();
    box(third, 0, 0, 1000, 1000);
    scaled(third, v(0.5, 0.5, 0.5), v(1000, 1000, 1000));
    expect(third.bounds().min.toArray()).toEqual([500, 500, 500]);
    expect(third.bounds().max.toArray()).toEqual([1000, 1000, 1000]);
  });

  it('flips a box with a negative factor and keeps its faces pointing out', () => {
    const model = new Model();
    box(model, 0, 0, 1000, 2000);
    expect(mirrors(scaleAbout(v(0, 0, 0), v(-1, 1, 1)))).toBe(true);
    scaled(model, v(-1, 1, 1));
    expect(model.bounds().min.x).toBe(-1000);
    expect(model.bounds().max.x).toBe(0);
    expect(closed(model)).toBe(true);
    expect(volume(model)).toBe(2e9); // positive: not turned inside out
    expect(validateModel(model, { orientation: true })).toEqual([]);
  });

  it('keeps colours and undoes in one step', () => {
    const model = new Model();
    box(model);
    const before = JSON.stringify(model.toData());
    const { edit } = scaled(model, v(2, 1, 1));
    edit.revert();
    expect(JSON.stringify(model.toData())).toBe(before);
    edit.apply();
    expect(model.bounds().max.x).toBe(2000);
  });

  it('mirrors a group instance, and flattening it for the drawings keeps the faces facing out', () => {
    const doc = new Document();
    doc.reset();
    const m = doc.model;
    doc.run('Box', () => {
      m.edit(() => drawPolygon(m, rect(0, 0, 1000, 1000)));
      const ground = m.allFaces().find((f) => f.normal.z === -1)!;
      pushPull(m, ground.id, -1000);
      const faces = m.allFaces().map((f) => f.id).filter((id) => m.hasFace(id));
      const instance = doc.makeDefinition('group', faces, m.allEdges().map((e) => e.id), []);
      // Flip the group along x and stretch it by two along y.
      m.setInstanceMatrix(instance, scaleAbout(v(0, 0, 0), v(-1, 2, 1)));
    });
    const flat = doc.flatten();
    expect(flat.bounds().min.x).toBe(-1000);
    expect(flat.bounds().max.y).toBe(2000);
    expect(volume(flat)).toBeGreaterThan(0);
    // (The scale figure every new document starts with overlaps the box; only orientation matters here.)
    expect(validateModel(flat, { orientation: true }).filter((p) => ['inconsistent-orientation', 'outer-orientation', 'hole-orientation'].includes(p.kind))).toEqual([]);
  });
});
