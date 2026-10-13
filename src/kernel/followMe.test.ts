import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model, type Id } from './Model';
import { drawPolygon, drawSegments } from './draw';
import { faceArea } from './faces';
import { chainEdges, followMe, sweepShell } from './followMe';
import { pushPull } from './pushPull';
import { validateModel } from './validate';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

const volume = (m: Model) => m.allFaces().reduce((sum, f) => sum + (faceArea(m, f) * f.normal.dot(m.position(f.outer[0]))) / 3, 0);
const closed = (m: Model) => m.allEdges().every((e) => m.facesOfEdge(e.id).length === 2);

describe('sweep geometry', () => {
  // A 100 x 50 rectangle standing square on the x axis at the origin.
  const profile = [v(0, 0, 0), v(0, 100, 0), v(0, 100, 50), v(0, 0, 50)];

  it('sweeps a straight path into a box: 4 sides and 2 caps, all facing out', () => {
    const shell = sweepShell(profile, [v(0, 0, 0), v(1000, 0, 0)], false)!;
    expect(shell).toHaveLength(6);
    const volumeOf = shell.reduce((sum, p) => sum + newell(p.points).dot(p.points[0]) / 6, 0);
    expect(Math.abs(volumeOf)).toBeCloseTo(100 * 50 * 1000, 0);
    // Outward: a point just outside each face on its normal is not inside the box.
    for (const p of shell) {
      const c = p.points.reduce((s, q) => s.add(q), v(0, 0, 0)).multiplyScalar(1 / p.points.length);
      const out = c.clone().addScaledVector(p.normal, 1);
      expect(out.x < 0 || out.x > 1000 || out.y < 0 || out.y > 100 || out.z < 0 || out.z > 50).toBe(true);
    }
  });

  it('mitres a corner: an L path gives 8 sides and 2 caps with flat faces', () => {
    const shell = sweepShell(profile, [v(0, 0, 0), v(1000, 0, 0), v(1000, 1000, 0)], false)!;
    expect(shell).toHaveLength(10);
    for (const p of shell) for (const q of p.points) expect(Math.abs(p.normal.dot(q.clone().sub(p.points[0])))).toBeLessThan(1e-6);
  });

  it('closes a loop: a rectangular path gives a ring of sides and no caps', () => {
    const ring = [v(0, 0, 0), v(1000, 0, 0), v(1000, 1000, 0), v(0, 1000, 0)];
    // The profile sits in the mitre plane at the first corner.
    const diagonal = [v(0, 0, 0), v(0, 0, 50), v(-70, -70, 50), v(-70, -70, 0)];
    void diagonal;
    const shell = sweepShell([v(0, 0, 0), v(-50, -50, 0), v(-50, -50, 50), v(0, 0, 50)], ring, true)!;
    expect(shell).toHaveLength(16);
  });

  it('refuses a path that doubles back or has no length', () => {
    expect(sweepShell(profile, [v(0, 0, 0), v(1000, 0, 0), v(0, 0, 0)], false)).toBeNull();
    expect(sweepShell(profile, [v(0, 0, 0), v(0, 0, 0)], false)).toBeNull();
  });
});

function newell(points: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  return n;
}

/** The vertex ids of a path of points drawn as edges in the model. */
function drawPath(m: Model, points: THREE.Vector3[]): Id[] {
  m.edit(() => drawSegments(m, points.slice(1).map((p, i) => [points[i], p] as [THREE.Vector3, THREE.Vector3])));
  return points.map((p) => m.findVertex(p)!);
}

describe('Follow Me', () => {
  it('turns a loose profile into a closed solid along a path', () => {
    const m = new Model();
    const path = drawPath(m, [v(0, 0, 0), v(1000, 0, 0)]);
    m.edit(() => drawPolygon(m, [v(0, 0, 0), v(0, 100, 0), v(0, 100, 50), v(0, 0, 50)]));
    const profile = m.allFaces()[0];
    expect(m.edit(() => followMe(m, profile.id, path, false)).result).toBe(true);
    expect(m.faceCount).toBe(6);
    expect(closed(m)).toBe(true);
    expect(volume(m)).toBeCloseTo(100 * 50 * 1000, -2);
    expect(validateModel(m, { orientation: true })).toEqual([]);
  });

  it('follows a corner and stays one valid solid', () => {
    const m = new Model();
    const path = drawPath(m, [v(0, 0, 0), v(1000, 0, 0), v(1000, 1000, 0)]);
    m.edit(() => drawPolygon(m, [v(0, 0, 0), v(0, 100, 0), v(0, 100, 50), v(0, 0, 50)]));
    const profile = m.allFaces().find((f) => Math.abs(f.normal.x) > 0.99)!;
    expect(m.edit(() => followMe(m, profile.id, path, false)).result).toBe(true);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeGreaterThan(100 * 50 * 1500);
  });

  it('is one undo step, and refuses a path that is not usable', () => {
    const m = new Model();
    const path = drawPath(m, [v(0, 0, 0), v(1000, 0, 0)]);
    m.edit(() => drawPolygon(m, [v(0, 0, 0), v(0, 100, 0), v(0, 100, 50), v(0, 0, 50)]));
    const profile = m.allFaces()[0];
    const { edit } = m.edit(() => followMe(m, profile.id, path, false));
    edit.revert();
    expect(m.faceCount).toBe(1);
    edit.apply();
    expect(m.faceCount).toBe(6);
    expect(m.edit(() => followMe(m, profile.id, [path[0], path[0]], false)).result).toBe(false);
  });

  it('fuses a trim with the wall it sits on', () => {
    // A 4 x 3 x 3 m box; a 100 x 100 mm square trim profile at one top edge, outside the wall, swept along the front top edge.
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -3000));
    const before = volume(m);
    const path = [m.findVertex(v(0, 0, 3000))!, m.findVertex(v(4000, 0, 3000))!];
    m.edit(() => drawPolygon(m, [v(0, -100, 2900), v(0, 0, 2900), v(0, 0, 3000), v(0, -100, 3000)]));
    const profile = m.allFaces().find((f) => m.faceVertices(f).every((id) => m.position(id).x === 0) && f.outer.length === 4 && m.faceVertices(f).some((id) => m.position(id).y === -100))!;
    expect(m.edit(() => followMe(m, profile.id, path, false)).result).toBe(true);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeCloseTo(before + 100 * 100 * 4000, -4);
  });

  it('cuts a groove when the profile lies inside the material', () => {
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -3000));
    const before = volume(m);
    const path = [m.findVertex(v(0, 0, 3000))!, m.findVertex(v(4000, 0, 3000))!];
    // A 100 x 100 square drawn on the end wall, in the corner under the path: it sweeps through the box.
    m.edit(() => drawPolygon(m, [v(0, 0, 2900), v(0, 100, 2900), v(0, 100, 3000), v(0, 0, 3000)]));
    const profile = m.allFaces().find((f) => f.outer.length === 4 && f.normal.x < -0.99 && m.faceVertices(f).every((id) => m.position(id).y <= 100 && m.position(id).z >= 2900))!;
    expect(m.edit(() => followMe(m, profile.id, path, false)).result).toBe(true);
    expect(closed(m)).toBe(true);
    expect(validateModel(m, { orientation: true })).toEqual([]);
    expect(volume(m)).toBeCloseTo(before - 100 * 100 * 4000, -4);
  });

  it('either finishes as a closed valid solid or refuses and changes nothing, over many random sweeps', () => {
    let state = 12345;
    const rand = (lo: number, hi: number) => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return lo + (state / 0x7fffffff) * (hi - lo);
    };
    const pick = (a: number[]) => a[Math.floor(rand(0, a.length)) % a.length];
    let applied = 0;
    for (let i = 0; i < 40; i++) {
      const w = pick([3000, 4000, 5000]);
      const d = pick([2000, 3000]);
      const h = pick([2500, 3000]);
      const m = new Model();
      m.edit(() => drawPolygon(m, [v(0, 0), v(w, 0), v(w, d), v(0, d)]));
      m.edit(() => pushPull(m, m.allFaces()[0].id, -h));
      // The path: one top edge, two top edges (a corner) or the whole top loop.
      const corners = [v(0, 0, h), v(w, 0, h), v(w, d, h), v(0, d, h)];
      const count = pick([2, 3, 4]);
      const path = corners.slice(0, count).map((p) => m.findVertex(p)!);
      const looped = count === 4;
      // A profile square in the mitre plane at the first corner, outside the wall or cutting into it.
      const size = pick([50, 100, 200]);
      const outside = rand(0, 1) < 0.6;
      const k = outside ? -1 : 1;
      const a = looped ? v(0, 0, h) : v(0, 0, h);
      const points = looped
        ? [a, v(k * size, k * size, h), v(k * size, k * size, h - size), v(0, 0, h - size)]
        : [v(0, 0, h), v(0, k * size, h), v(0, k * size, h - size), v(0, 0, h - size)];
      m.edit(() => drawPolygon(m, points));
      const profile = m.allFaces().find((f) => f.outer.length === 4 && points.every((p) => m.faceVertices(f).some((id) => m.position(id).distanceTo(p) < 1e-6)));
      if (!profile) continue;
      const before = JSON.stringify(m.toData());
      const { result, edit } = m.edit(() => followMe(m, profile.id, path, looped));
      if (!result) {
        expect(edit.empty).toBe(true);
        expect(JSON.stringify(m.toData())).toBe(before);
        continue;
      }
      applied++;
      expect(validateModel(m, { orientation: true }), `sweep ${i}`).toEqual([]);
      if (!closed(m)) {
        const bad = m.allEdges().filter((e) => m.facesOfEdge(e.id).length !== 2).map((e) => `${m.facesOfEdge(e.id).length}f ${m.position(e.a).toArray().map(Math.round)}>${m.position(e.b).toArray().map(Math.round)}`);
        throw new Error(`sweep ${i}: w=${w} d=${d} h=${h} count=${count} looped=${looped} size=${size} outside=${outside}; bad edges: ${bad.slice(0, 6).join(' | ')}`);
      }
    }
    expect(applied).toBeGreaterThan(10);
  });

  describe('chaining a selection into a path', () => {
    it('orders an open chain from the end nearest the profile, and recognises a loop', () => {
      const m = new Model();
      const ids = drawPath(m, [v(0, 0, 0), v(1000, 0, 0), v(1000, 1000, 0)]);
      const edges = m.allEdges().map((e) => e.id);
      const fromStart = chainEdges(m, edges, v(-10, 0, 0))!;
      expect(fromStart.closed).toBe(false);
      expect(fromStart.vertices).toEqual(ids);
      expect(chainEdges(m, edges, v(1000, 1100, 0))!.vertices).toEqual([...ids].reverse());

      const loop = new Model();
      loop.edit(() => drawPolygon(loop, [v(0, 0), v(1000, 0), v(1000, 1000), v(0, 1000)]));
      const ring = chainEdges(loop, loop.allEdges().map((e) => e.id), v(1000, 1000, 0))!;
      expect(ring.closed).toBe(true);
      expect(ring.vertices).toHaveLength(4);
      expect(loop.position(ring.vertices[0]).toArray()).toEqual([1000, 1000, 0]);
    });

    it('refuses branches and separate pieces', () => {
      const m = new Model();
      m.edit(() => drawSegments(m, [[v(0, 0), v(1000, 0)], [v(500, 0), v(500, 500)]]));
      expect(chainEdges(m, m.allEdges().map((e) => e.id), v(0, 0, 0))).toBeNull();
      const apart = new Model();
      apart.edit(() => drawSegments(apart, [[v(0, 0), v(1000, 0)], [v(3000, 0), v(4000, 0)]]));
      expect(chainEdges(apart, apart.allEdges().map((e) => e.id), v(0, 0, 0))).toBeNull();
    });
  });
});
