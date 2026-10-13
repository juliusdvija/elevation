import * as THREE from 'three';
import type { ObjMesh } from './obj';

/**
 * Readers for other triangle-mesh formats. Each returns the same `ObjMesh` the OBJ importer builds
 * models from, so welding, merging coplanar triangles and painting all work the same way.
 */

/** Binary STL has an 80-byte header, a count, then 50 bytes per triangle. ASCII STL starts with "solid". */
export function parseStl(buffer: ArrayBuffer): ObjMesh {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const mesh: ObjMesh = { positions: [], faces: [], materials: new Map() };

  const binary = bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 === bytes.length;
  if (binary) {
    const count = view.getUint32(80, true);
    for (let i = 0; i < count; i++) {
      const at = 84 + i * 50 + 12; // skip the facet normal
      const base = mesh.positions.length;
      for (let k = 0; k < 3; k++) {
        mesh.positions.push([view.getFloat32(at + k * 12, true), view.getFloat32(at + k * 12 + 4, true), view.getFloat32(at + k * 12 + 8, true)]);
      }
      mesh.faces.push({ indices: [base, base + 1, base + 2], material: '' });
    }
    return mesh;
  }

  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(text)) throw new Error('This is not an STL file.');
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) mesh.positions.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  for (let base = 0; base + 2 < mesh.positions.length; base += 3) mesh.faces.push({ indices: [base, base + 1, base + 2], material: '' });
  return mesh;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/**
 * glTF 2.0 (.glb, or .gltf with its buffer embedded as a data URI): triangle meshes with their node
 * transforms applied, and base colour and alpha from the materials. Y is up and units are metres.
 */
export function parseGltf(input: ArrayBuffer | string): ObjMesh {
  let json: any;
  let bin: Uint8Array | undefined;
  if (typeof input === 'string') {
    json = JSON.parse(input);
  } else {
    const view = new DataView(input);
    if (view.getUint32(0, true) !== 0x46546c67) {
      json = JSON.parse(new TextDecoder().decode(input));
    } else {
      // GLB: a header, then chunks: JSON first, an optional binary chunk after.
      let offset = 12;
      while (offset + 8 <= input.byteLength) {
        const length = view.getUint32(offset, true);
        const type = view.getUint32(offset + 4, true);
        const data = new Uint8Array(input, offset + 8, length);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
        else if (type === 0x004e4942) bin = data;
        offset += 8 + length + ((4 - (length % 4)) % 4);
      }
    }
  }
  if (!json || json.asset?.version?.[0] !== '2') throw new Error('This is not a glTF 2.0 file.');

  const buffers: Uint8Array[] = (json.buffers ?? []).map((b: { uri?: string }, i: number) => {
    if (b.uri === undefined) {
      if (i === 0 && bin) return bin;
      throw new Error('This glTF needs its binary data (use a .glb file, or embed it).');
    }
    if (!b.uri.startsWith('data:')) throw new Error('This glTF points to a separate .bin file; use a .glb file instead.');
    const raw = atob(b.uri.slice(b.uri.indexOf(',') + 1));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  });

  /** Reads an accessor as a flat array of numbers. */
  const read = (index: number): number[] => {
    const a: GltfAccessor = json.accessors[index];
    if (a.bufferView === undefined) return new Array(a.count * COMPONENTS[a.type]).fill(0);
    const view = json.bufferViews[a.bufferView];
    const data = buffers[view.buffer];
    const n = COMPONENTS[a.type];
    const size = SIZES[a.componentType];
    const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : n * size;
    const start = data.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const dv = new DataView(data.buffer);
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < n; k++) {
        const at = start + i * stride + k * size;
        switch (a.componentType) {
          case 5126: out.push(dv.getFloat32(at, true)); break;
          case 5125: out.push(dv.getUint32(at, true)); break;
          case 5123: out.push(dv.getUint16(at, true)); break;
          case 5122: out.push(dv.getInt16(at, true)); break;
          case 5121: out.push(dv.getUint8(at)); break;
          default: out.push(dv.getInt8(at));
        }
      }
    }
    return out;
  };

  const mesh: ObjMesh = { positions: [], faces: [], materials: new Map() };
  // Materials: base colour (linear in glTF) as sRGB hex, and alpha when the material is blended.
  const materialName = (index: number | undefined): string => {
    if (index === undefined) return '';
    const m = json.materials?.[index];
    const factor: number[] = m?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const name = `material-${index}`;
    if (!mesh.materials.has(name)) {
      const color = new THREE.Color().setRGB(factor[0], factor[1], factor[2], THREE.LinearSRGBColorSpace);
      mesh.materials.set(name, { color: `#${color.getHexString(THREE.SRGBColorSpace)}`, opacity: m?.alphaMode === 'BLEND' ? factor[3] : 1 });
    }
    return name;
  };

  const meshOfNode = (node: any, matrix: THREE.Matrix4) => {
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      );
    }
    const world = matrix.clone().multiply(local);
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes?.POSITION === undefined) continue; // triangles only
        const positions = read(primitive.attributes.POSITION);
        const base = mesh.positions.length;
        for (let i = 0; i < positions.length; i += 3) {
          const p = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(world);
          mesh.positions.push([p.x, p.y, p.z]);
        }
        const indices = primitive.indices !== undefined ? read(primitive.indices) : Array.from({ length: positions.length / 3 }, (_, i) => i);
        const material = materialName(primitive.material);
        // A mirroring transform reverses the winding; flip it back so faces keep pointing out.
        const flip = world.determinant() < 0;
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const tri = [base + indices[i], base + indices[i + 1], base + indices[i + 2]];
          mesh.faces.push({ indices: flip ? [tri[0], tri[2], tri[1]] : tri, material });
        }
      }
    }
    for (const child of node.children ?? []) meshOfNode(json.nodes[child], world);
  };

  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i);
  for (const root of roots) meshOfNode(json.nodes[root], new THREE.Matrix4());
  return mesh;
}
