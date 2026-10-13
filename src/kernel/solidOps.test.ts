import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from './Model';
import { drawPolygon } from './draw';
import { faceArea } from './faces';
import { pushPull } from './pushPull';
import { combineSolids } from './solidOps';
import { validateModel } from './validate';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

/** A cube of `size` with its lower corner at (x, y, z). */
function cube(x: number, y: number, z: number, size = 10): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(x, y, z), v(x + size, y, z), v(x + size, y + size, z), v(x, y + size, z)]));
  m.edit(() => {
    const face = m.allFaces()[0];
    pushPull(m, face.id, face.normal.z < 0 ? -size : size);
  });
  return m;
}

const volume = (m: Model) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);
const closed = (m: Model) => m.allEdges().every((e) => m.facesOfEdge(e.id).length === 2);

describe('solid tools', () => {
  const a = () => cube(0, 0, 0);
  const b = () => cube(5, 5, 5);

  it('unites two overlapping cubes into one solid', () => {
    const r = combineSolids(a(), b(), 'union');
    expect(closed(r)).toBe(true);
    expect(validateModel(r, { orientation: true })).toEqual([]);
    expect(volume(r)).toBeCloseTo(2000 - 125, 6);
  });

  it('subtracts the second from the first, leaving a notch', () => {
    const r = combineSolids(a(), b(), 'subtract');
    expect(closed(r)).toBe(true);
    expect(validateModel(r, { orientation: true })).toEqual([]);
    expect(volume(r)).toBeCloseTo(1000 - 125, 6);
  });

  it('keeps only what both hold when intersecting', () => {
    const r = combineSolids(a(), b(), 'intersect');
    expect(closed(r)).toBe(true);
    expect(validateModel(r, { orientation: true })).toEqual([]);
    expect(volume(r)).toBeCloseTo(125, 6);
    expect(r.faceCount).toBe(6);
    expect(r.bounds().min.toArray()).toEqual([5, 5, 5]);
  });

  it('fuses cubes that only touch: the shared face goes and flat faces merge', () => {
    const r = combineSolids(a(), cube(10, 0, 0), 'union');
    expect(closed(r)).toBe(true);
    expect(validateModel(r, { orientation: true })).toEqual([]);
    expect(volume(r)).toBeCloseTo(2000, 6);
    expect(r.faceCount).toBe(6); // one 20 x 10 x 10 block
  });

  it('handles a cube inside another: union is the outer one, subtract leaves a hollow, intersect is the inner one', () => {
    const inner = () => cube(3, 3, 3, 4);
    const union = combineSolids(a(), inner(), 'union');
    expect(volume(union)).toBeCloseTo(1000, 6);
    expect(union.faceCount).toBe(6);
    const hollow = combineSolids(a(), inner(), 'subtract');
    expect(volume(hollow)).toBeCloseTo(1000 - 64, 6);
    expect(hollow.faceCount).toBe(12);
    expect(closed(hollow)).toBe(true);
    const both = combineSolids(a(), inner(), 'intersect');
    expect(volume(both)).toBeCloseTo(64, 6);
    expect(both.faceCount).toBe(6);
  });

  it('copes with solids that do not meet', () => {
    const far = () => cube(30, 0, 0);
    const union = combineSolids(a(), far(), 'union');
    expect(union.faceCount).toBe(12);
    expect(volume(union)).toBeCloseTo(2000, 6);
    expect(combineSolids(a(), far(), 'subtract').faceCount).toBe(6);
    expect(combineSolids(a(), far(), 'intersect').faceCount).toBe(0);
  });

  it('keeps the colour of each face it keeps', () => {
    const red = a();
    red.edit(() => {
      for (const f of red.allFaces()) red.putFace({ ...f, color: '#c0392b' });
    });
    const blue = b();
    blue.edit(() => {
      for (const f of blue.allFaces()) blue.putFace({ ...f, color: '#2e86c1' });
    });
    const r = combineSolids(red, blue, 'union');
    const colors = new Set(r.allFaces().map((f) => f.color));
    expect(colors.has('#c0392b')).toBe(true);
    expect(colors.has('#2e86c1')).toBe(true);
  });
});
