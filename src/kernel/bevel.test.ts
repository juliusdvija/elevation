import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model, type Id } from './Model';
import { drawPolygon } from './draw';
import { faceArea } from './faces';
import { bevelEdges } from './bevel';
import { pushPull } from './pushPull';
import { snapshot, validateModel } from './validate';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function box(w = 24, d = 12, h = 8): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(w, 0), v(w, d), v(0, d)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -h));
  return m;
}

const volume = (m: Model) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);
const closed = (m: Model) => m.allEdges().every((e) => m.facesOfEdge(e.id).length === 2);
const edgeAt = (m: Model, a: THREE.Vector3, b: THREE.Vector3): Id => m.edgeBetween(m.findVertex(a)!, m.findVertex(b)!)!;

describe('chamfer', () => {
  it('cuts a flat bevel along one edge of a box: one more face, exactly the removed triangle gone', () => {
    const m = box();
    const edge = edgeAt(m, v(0, 0, 8), v(24, 0, 8));
    expect(m.edit(() => bevelEdges(m, [edge], { size: 2, round: false })).result).toBe(1);
    expect(m.faceCount).toBe(7);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeCloseTo(24 * 12 * 8 - 0.5 * 2 * 2 * 24, 6);
    // The new face runs from (x, 2, 8) to (x, 0, 6) along the whole edge.
    const bevel = m.allFaces().find((f) => Math.abs(f.normal.y) > 0.5 && Math.abs(f.normal.z) > 0.5)!;
    expect(faceArea(m, bevel)).toBeCloseTo(24 * Math.hypot(2, 2), 6);
  });

  it('chamfers all twelve edges of a box into a valid closed solid', () => {
    const m = box();
    const edges = m.allEdges().map((e) => e.id);
    const done = m.edit(() => bevelEdges(m, edges, { size: 1, round: false })).result;
    expect(done).toBe(12);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeLessThan(24 * 12 * 8);
    expect(volume(m)).toBeGreaterThan(24 * 12 * 8 - 12 * 0.5 * 24); // sanity: not more than the edge prisms
  });

  it('undoes in one step and leaves flat or unsuitable edges alone', () => {
    const m = box();
    const before = snapshot(m);
    const edges = [edgeAt(m, v(0, 0, 8), v(24, 0, 8))];
    const { result, edit } = m.edit(() => bevelEdges(m, [...edges, 999999], { size: 2, round: false }));
    expect(result).toBe(1);
    edit.revert();
    expect(snapshot(m)).toBe(before);
    expect(m.edit(() => bevelEdges(m, edges, { size: 0, round: false })).result).toBe(0);
  });
});

describe('fillet', () => {
  it('rounds an edge: the corner is cut by the profile of a radius-2 arc, as segments', () => {
    const m = box();
    const edge = edgeAt(m, v(0, 0, 8), v(24, 0, 8));
    expect(m.edit(() => bevelEdges(m, [edge], { size: 2, round: true })).result).toBe(1);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    // Removed: the area between the corner and a quarter circle (r = 2) times the length; segments make it a bit more.
    const quarter = (1 - Math.PI / 4) * 4;
    const removed = 24 * 12 * 8 - volume(m);
    expect(removed / 24).toBeGreaterThan(quarter);
    expect(removed / 24).toBeLessThan(quarter * 1.05);
    // 90 degrees in 15-degree pieces: six faces replace the edge.
    expect(m.faceCount).toBe(6 + 6);
  });

  it('honours a segment count', () => {
    const m = box();
    const edge = edgeAt(m, v(0, 0, 8), v(24, 0, 8));
    m.edit(() => bevelEdges(m, [edge], { size: 2, round: true, segments: 12 }));
    expect(m.faceCount).toBe(6 + 12);
    expect(closed(m)).toBe(true);
  });

  it('rounds the inside corner of an L: material is added, not cut', () => {
    // An L-shaped plate 10 high; the inner vertical edge at (10, 10).
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(30, 0), v(30, 10), v(10, 10), v(10, 30), v(0, 30)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -10));
    const before = volume(m);
    const inner = edgeAt(m, v(10, 10, 0), v(10, 10, 10));
    expect(m.edit(() => bevelEdges(m, [inner], { size: 3, round: true })).result).toBe(1);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeGreaterThan(before);
    // Added: the area between the corner and the arc, (1 - pi/4) r^2, times the height (a little more from the segments).
    const added = (volume(m) - before) / 10;
    expect(added).toBeGreaterThan((1 - Math.PI / 4) * 9 * 0.98);
    expect(added).toBeLessThan((1 - Math.PI / 4) * 9 * 1.06);
  });
});
