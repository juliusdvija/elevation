import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from './obj';
import { parseGltf, parseStl } from './mesh';
import { faceArea } from '../kernel/faces';
import { validateModel } from '../kernel/validate';

/** A unit cube as 8 corners and 12 outward triangles (counter-clockwise seen from outside). */
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TRIANGLES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];

const volume = (m: ReturnType<typeof buildModel>) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);

function binaryStl(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + TRIANGLES.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, TRIANGLES.length, true);
  TRIANGLES.forEach((tri, i) => {
    tri.forEach((c, k) => CORNERS[c].forEach((x, j) => view.setFloat32(84 + i * 50 + 12 + k * 12 + j * 4, x * 100, true)));
  });
  return buffer;
}

describe('STL import', () => {
  it('reads binary STL and builds a closed solid from the loose triangles', () => {
    const m = buildModel(parseStl(binaryStl()), { scale: 1, yUp: false });
    expect(m.faceCount).toBe(6);
    expect(m.allEdges().every((e) => m.facesOfEdge(e.id).length === 2)).toBe(true);
    expect(volume(m)).toBeCloseTo(100 ** 3, -2);
    expect(validateModel(m)).toEqual([]);
  });

  it('reads ASCII STL', () => {
    const text = 'solid cube\n' + TRIANGLES.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((c) => `vertex ${CORNERS[c].map((x) => x * 100).join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n') + '\nendsolid cube\n';
    const m = buildModel(parseStl(new TextEncoder().encode(text).buffer), { scale: 1, yUp: false });
    expect(m.faceCount).toBe(6);
    expect(volume(m)).toBeCloseTo(100 ** 3, -2);
  });

  it('refuses something that is not STL', () => {
    expect(() => parseStl(new TextEncoder().encode('hello world, long enough to not be binary').buffer)).toThrow(/not an STL/);
  });
});

/** A .glb with one cube mesh, a translated node, and a half-transparent red material. */
function glb(options: { translation?: number[]; scale?: number[] } = {}): ArrayBuffer {
  const positions = new Float32Array(CORNERS.flat());
  const indices = new Uint16Array(TRIANGLES.flat());
  const bin = new Uint8Array(positions.byteLength + indices.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), positions.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: options.translation ?? [0, 0, 0], ...(options.scale ? { scale: options.scale } : {}) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.5] }, alphaMode: 'BLEND' }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const jsonPadded = jsonBytes.length + pad(jsonBytes.length);
  const binPadded = bin.length + pad(bin.length);
  const out = new ArrayBuffer(12 + 8 + jsonPadded + 8 + binPadded);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(out);
  bytes.fill(0x20, 20, 20 + jsonPadded);
  bytes.set(jsonBytes, 20);
  view.setUint32(20 + jsonPadded, binPadded, true);
  view.setUint32(24 + jsonPadded, 0x004e4942, true);
  bytes.set(bin, 28 + jsonPadded);
  return out;
}

describe('glTF import', () => {
  it('reads a .glb: geometry, the node transform, and colour with alpha', () => {
    const mesh = parseGltf(glb({ translation: [2, 0, 0] }));
    // glTF is Y up and in metres.
    const m = buildModel(mesh, { scale: 1000, yUp: true });
    expect(m.faceCount).toBe(6);
    expect(volume(m)).toBeCloseTo(1e9, -6);
    expect(m.bounds().min.x).toBeCloseTo(2000);
    const face = m.allFaces()[0];
    expect(face.color).toBe('#ff0000');
    expect(face.opacity).toBeCloseTo(0.5);
  });

  it('keeps faces pointing out through a mirroring scale', () => {
    const m = buildModel(parseGltf(glb({ scale: [-1, 1, 1] })), { scale: 1000, yUp: true });
    expect(volume(m)).toBeGreaterThan(0);
  });

  it('explains files it cannot read', () => {
    expect(() => parseGltf('{"asset":{"version":"1.0"}}')).toThrow(/glTF 2.0/);
    const external = { asset: { version: '2.0' }, buffers: [{ uri: 'data.bin', byteLength: 4 }] };
    expect(() => parseGltf(JSON.stringify(external))).toThrow(/\.glb/);
  });
});

void THREE;
