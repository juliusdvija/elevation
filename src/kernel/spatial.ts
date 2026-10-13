import * as THREE from 'three';
import { EPS } from './math';
import type { Id } from './Model';

const CELL = 1000; // mm; about the size of a room feature
const MAX_CELLS = 64; // an edge covering more cells is kept in a short list checked by every query

/** Hash of a grid cell. Collisions only add candidates, which callers check geometrically. */
const hash = (i: number, j: number, k: number) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);

function range(min: THREE.Vector3, max: THREE.Vector3, pad: number) {
  return {
    i0: Math.floor((min.x - pad) / CELL),
    i1: Math.floor((max.x + pad) / CELL),
    j0: Math.floor((min.y - pad) / CELL),
    j1: Math.floor((max.y + pad) / CELL),
    k0: Math.floor((min.z - pad) / CELL),
    k1: Math.floor((max.z + pad) / CELL),
  };
}

/** Uniform grid over vertices and edges, so lookups near a point do not scan the whole model. */
export class SpatialIndex {
  private readonly vertexCells = new Map<number, Set<Id>>();
  private readonly vertexKey = new Map<Id, number>();
  private readonly edgeCells = new Map<number, Set<Id>>();
  private readonly edgeKeys = new Map<Id, number[]>();
  private readonly big = new Set<Id>();

  setVertex(id: Id, position: THREE.Vector3 | undefined): void {
    const old = this.vertexKey.get(id);
    if (old !== undefined) {
      this.vertexCells.get(old)?.delete(id);
      this.vertexKey.delete(id);
    }
    if (!position) return;
    const key = hash(Math.floor(position.x / CELL), Math.floor(position.y / CELL), Math.floor(position.z / CELL));
    let set = this.vertexCells.get(key);
    if (!set) this.vertexCells.set(key, (set = new Set()));
    set.add(id);
    this.vertexKey.set(id, key);
  }

  /** Registers an edge by its endpoints (undefined removes it). */
  setEdge(id: Id, a: THREE.Vector3 | undefined, b: THREE.Vector3 | undefined): void {
    const old = this.edgeKeys.get(id);
    if (old) {
      for (const key of old) this.edgeCells.get(key)?.delete(id);
      this.edgeKeys.delete(id);
    }
    this.big.delete(id);
    if (!a || !b) return;
    const min = a.clone().min(b);
    const max = a.clone().max(b);
    const r = range(min, max, EPS);
    if ((r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) * (r.k1 - r.k0 + 1) > MAX_CELLS) {
      this.big.add(id);
      return;
    }
    const keys: number[] = [];
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (let k = r.k0; k <= r.k1; k++) {
          const key = hash(i, j, k);
          let set = this.edgeCells.get(key);
          if (!set) this.edgeCells.set(key, (set = new Set()));
          set.add(id);
          keys.push(key);
        }
      }
    }
    this.edgeKeys.set(id, keys);
  }

  /** Vertices in the cells touched by the box (candidates; check distance yourself). */
  verticesNear(min: THREE.Vector3, max: THREE.Vector3, pad = EPS): Id[] {
    const r = range(min, max, pad);
    const found = new Set<Id>();
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (let k = r.k0; k <= r.k1; k++) for (const id of this.vertexCells.get(hash(i, j, k)) ?? []) found.add(id);
      }
    }
    return [...found];
  }

  /** Edges in the cells touched by the box, plus very long edges (candidates). */
  edgesNear(min: THREE.Vector3, max: THREE.Vector3, pad = EPS): Id[] {
    const r = range(min, max, pad);
    const found = new Set<Id>(this.big);
    for (let i = r.i0; i <= r.i1; i++) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (let k = r.k0; k <= r.k1; k++) for (const id of this.edgeCells.get(hash(i, j, k)) ?? []) found.add(id);
      }
    }
    return [...found];
  }
}
