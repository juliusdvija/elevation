import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { snapshot, validateModel } from '../kernel/validate';
import { parse, serialize, toFile } from './format';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function sample(): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(3000, 0), v(3000, 2000), v(0, 2000)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -2500));
  m.edit(() => drawPolygon(m, [v(1000, 500, 2500), v(2000, 500, 2500), v(2000, 1500, 2500), v(1000, 1500, 2500)]));
  m.edit(() => m.addGuideLine(v(0, 0, 1200), v(1, 0, 0)));
  return m;
}

describe('file format', () => {
  it('round-trips a model exactly', () => {
    const m = sample();
    const text = serialize(toFile(m.toData(), { position: [1, 2, 3], target: [0, 0, 0], ortho: false, orthoHeight: 1000 }));
    const copy = new Model();
    copy.load(parse(text).model);
    expect(snapshot(copy)).toBe(snapshot(m));
    expect(validateModel(copy)).toEqual([]);
  });

  it('keeps issuing fresh ids after loading', () => {
    const m = sample();
    const copy = new Model();
    copy.load(parse(serialize(toFile(m.toData()))).model);
    const before = Math.max(...copy.allVertices().map((x) => x.id), ...copy.allFaces().map((f) => f.id));
    let id = 0;
    copy.edit(() => (id = copy.addVertex(v(9, 9, 9))));
    expect(id).toBeGreaterThan(before);
  });

  it('replaces whatever was loaded before', () => {
    const m = sample();
    const other = new Model();
    other.edit(() => drawPolygon(other, [v(0, 0), v(1, 0), v(1, 1)]));
    other.load(m.toData());
    expect(snapshot(other)).toBe(snapshot(m));
  });

  it('rejects files that are not Elevation models', () => {
    expect(() => parse('not json')).toThrow('not valid JSON');
    expect(() => parse('{"format":"other"}')).toThrow('not an Elevation file');
    expect(() => parse('{"format":"elevation","version":99,"model":{}}')).toThrow('newer version');
  });
});
