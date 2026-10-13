import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { faceArea } from '../kernel/faces';
import { buildModel, guessUnit, parseMtl, parseObj } from './obj';
import { validateModel } from '../kernel/validate';

/** A 2 x 3 x 4 box as 12 triangles, Y-up (height is y), outward winding. */
const BOX = `
v 0 0 0
v 2 0 0
v 2 4 0
v 0 4 0
v 0 0 3
v 2 0 3
v 2 4 3
v 0 4 3
f 1 3 2
f 1 4 3
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 4 8 7
f 4 7 3
f 1 5 8
f 1 8 4
f 2 3 7
f 2 7 6
`;

const closed = (m: ReturnType<typeof buildModel>) => m.allEdges().every((e) => m.facesOfEdge(e.id).length === 2);

describe('OBJ import', () => {
  it('merges the triangles of a box back into six faces and turns Y-up into Z-up', () => {
    const m = buildModel(parseObj(BOX), { scale: 1000, yUp: true });
    expect(m.faceCount).toBe(6);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    const size = m.bounds().getSize(new THREE.Vector3());
    // 2 m wide (x), 3 m deep (the OBJ's z becomes -y), 4 m high (the OBJ's y becomes z).
    expect([size.x, size.y, size.z]).toEqual([2000, 3000, 4000]);
    // Faces point outwards: a closed solid has positive volume.
    let volume = 0;
    for (const f of m.allFaces()) volume += (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3;
    expect(volume).toBeCloseTo(2000 * 3000 * 4000, -3);
  });

  it('paints faces from the material colours and leaves near-white faces unpainted', () => {
    const text = BOX.replace('f 1 3 2\nf 1 4 3', 'usemtl red\nf 1 3 2\nf 1 4 3\nusemtl white');
    const mtl = 'newmtl red\nKd 1.0 0.0 0.0\nnewmtl white\nKd 0.98 0.98 0.98\n';
    const m = buildModel(parseObj(text, mtl), { scale: 1, yUp: true });
    expect(m.faceCount).toBe(6);
    expect(m.allFaces().filter((f) => f.color === '#ff0000')).toHaveLength(1);
    expect(m.allFaces().filter((f) => f.color).length).toBe(1);
    const lossy = buildModel(parseObj(text, mtl), { scale: 1, yUp: true, colors: false });
    expect(lossy.allFaces().some((f) => f.color)).toBe(false);
  });

  it('keeps differently coloured triangles of one plane as separate faces', () => {
    const text = BOX.replace('f 1 3 2\nf 1 4 3', 'usemtl a\nf 1 3 2\nusemtl b\nf 1 4 3\nusemtl c');
    const mtl = 'newmtl a\nKd 1 0 0\nnewmtl b\nKd 0 0 1\nnewmtl c\nKd 0.2 0.2 0.2\n';
    const m = buildModel(parseObj(text, mtl), { scale: 1, yUp: true });
    expect(m.faceCount).toBe(7); // the red-blue-split face is two triangles
  });

  it('handles quads, negative indices and v/vt/vn tokens', () => {
    const text = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4/1/1 -3/2/1 -2//1 -1/4/1\n`;
    const m = buildModel(parseObj(text), { scale: 1000, yUp: false });
    expect(m.faceCount).toBe(1);
    expect(m.allFaces()[0].outer).toHaveLength(4);
    expect(validateModel(m)).toEqual([]);
  });

  it('puts a hole in a face when triangles surround an opening', () => {
    // A 4 x 4 plate with a 1 x 1 hole in the middle, as 8 triangles.
    const text = `v 0 0 0\nv 4 0 0\nv 4 4 0\nv 0 4 0\nv 1.5 1.5 0\nv 2.5 1.5 0\nv 2.5 2.5 0\nv 1.5 2.5 0
f 1 2 6\nf 1 6 5\nf 2 3 7\nf 2 7 6\nf 3 4 8\nf 3 8 7\nf 4 1 5\nf 4 5 8\n`;
    const m = buildModel(parseObj(text), { scale: 1000, yUp: false });
    expect(m.faceCount).toBe(1);
    expect(m.allFaces()[0].holes).toHaveLength(1);
    expect(validateModel(m)).toEqual([]);
  });

  it('splits a T-junction so the result is valid', () => {
    // Two squares side by side; the left one has an extra vertex on the shared edge's line only on its side.
    const text = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 1 0.5 0\nv 2 0 0\nv 2 1 0
f 1 2 5\nf 1 5 3\nf 1 3 4\nf 2 6 7\nf 2 7 3\n`;
    const m = buildModel(parseObj(text), { scale: 1000, yUp: false });
    expect(validateModel(m)).toEqual([]);
  });

  it('guesses the unit from the size and reads colours from a .mtl', () => {
    const house = parseObj('v 0 0 0\nv 1000 600 966\nf 1 1 1\n');
    expect(guessUnit(house)).toBe('cm'); // 10 m
    expect(guessUnit(parseObj('v 0 0 0\nv 12 3 8\n'))).toBe('m');
    expect(guessUnit(parseObj('v 0 0 0\nv 12000 3000 8000\n'))).toBe('mm');
    expect(parseMtl('newmtl Brick\nKd 0.5 0.25 0\n').get('Brick')).toBe('#804000');
  });
});
