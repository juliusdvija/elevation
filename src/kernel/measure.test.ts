import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../document';
import { Model } from './Model';
import { drawPolygon } from './draw';
import { areaOf, edgeLength, enclosedVolume, entityBounds, facePerimeter } from './measure';
import { pushPull } from './pushPull';
import { scaleAbout } from './transform';
import { formatArea, formatVolume, setDisplaySettings } from '../core/units';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function box(w = 24, d = 12, h = 8): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(w, 0), v(w, d), v(0, d)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -h));
  return m;
}

describe('measuring', () => {
  it('measures edges, faces and the enclosed volume of a box', () => {
    const m = box();
    const top = m.allFaces().find((f) => f.normal.z > 0.99)!;
    expect(areaOf(m, top.id)).toBeCloseTo(288);
    expect(facePerimeter(m, top.id)).toBeCloseTo(72);
    const longEdge = m.allEdges().find((e) => Math.abs(edgeLength(m, e.id) - 24) < 1e-9)!;
    expect(edgeLength(m, longEdge.id)).toBeCloseTo(24);
    expect(enclosedVolume(m, m.allFaces().map((f) => f.id))).toBeCloseTo(24 * 12 * 8);
  });

  it('has no volume for something that is not closed, and counts a face with a hole by its outline minus the hole', () => {
    const m = box();
    const faces = m.allFaces().map((f) => f.id);
    expect(enclosedVolume(m, faces.slice(1))).toBeNull();
    expect(enclosedVolume(m, [faces[0]])).toBeNull();
    const plate = new Model();
    plate.edit(() => drawPolygon(plate, [v(0, 0), v(100, 0), v(100, 100), v(0, 100)]));
    plate.edit(() => drawPolygon(plate, [v(40, 40), v(60, 40), v(60, 60), v(40, 60)]));
    const outer = plate.allFaces().find((f) => f.holes.length === 1)!;
    expect(areaOf(plate, outer.id)).toBeCloseTo(10000 - 400);
    expect(facePerimeter(plate, outer.id)).toBeCloseTo(400 + 80);
  });

  it('finds the bounds of a selection, in world space through a matrix', () => {
    const m = box();
    const top = m.allFaces().find((f) => f.normal.z > 0.99)!;
    const local = entityBounds(m, [top.id], []);
    expect(local.min.toArray()).toEqual([0, 0, 8]);
    expect(local.max.toArray()).toEqual([24, 12, 8]);
    const world = entityBounds(m, [top.id], [], new THREE.Matrix4().makeTranslation(100, 0, 0));
    expect(world.min.x).toBe(100);
    expect(entityBounds(m, [], []).isEmpty()).toBe(true);
  });

  it('measures a group or component: bounds and volume with its transform, null when open', () => {
    const doc = new Document();
    let id = 0;
    doc.run('Part', () => {
      const m = doc.model;
      drawPolygon(m, [v(0, 0), v(24, 0), v(24, 12), v(0, 12)]);
      pushPull(m, m.allFaces().find((f) => f.normal.z === -1)!.id, -8);
      id = doc.makeDefinition('group', m.allFaces().map((f) => f.id), m.allEdges().map((e) => e.id), []);
    });
    const plain = doc.instanceStats(id);
    expect(plain.bounds.getSize(new THREE.Vector3()).toArray()).toEqual([24, 12, 8]);
    expect(plain.volume).toBeCloseTo(2304);
    // Stretched by 2 in y and mirrored in x: volume doubles, bounds follow.
    doc.run('Stretch', () => doc.model.setInstanceMatrix(id, scaleAbout(v(0, 0, 0), v(-1, 2, 1))));
    const stretched = doc.instanceStats(id);
    expect(stretched.bounds.min.x).toBe(-24);
    expect(stretched.bounds.max.y).toBe(24);
    expect(stretched.volume).toBeCloseTo(4608);
  });

  it('writes areas and volumes in the display unit', () => {
    expect(formatArea(288)).toBe('288 mm²');
    expect(formatArea(2.5e6)).toBe('2.5 m²');
    expect(formatVolume(2304)).toBe('2304 mm³');
    expect(formatVolume(2.5e6)).toBe('2500 cm³');
    expect(formatVolume(4e9)).toBe('4 m³');
    setDisplaySettings({ unit: 'cm', decimals: 2 });
    expect(formatArea(288)).toBe('2.88 cm²');
    expect(formatVolume(2304)).toBe('2.3 cm³');
    setDisplaySettings({ unit: 'mm', decimals: 2 });
  });
});
