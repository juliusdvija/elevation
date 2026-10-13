import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { flattenFace, layoutParts, layoutToDxf, layoutToSvg } from './flatExport';
import { parseDxf } from './dxf';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function part(): Model {
  const m = new Model();
  m.edit(() => drawPolygon(m, [v(0, 0), v(24, 0), v(24, 12), v(0, 12)]));
  m.edit(() => pushPull(m, m.allFaces()[0].id, -8));
  return m;
}

const size = (loops: THREE.Vector2[][]) => {
  const pts = loops[0];
  return [Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))];
};

describe('flat outlines', () => {
  it('flattens each face of a box to its true size, longest side along x', () => {
    const m = part();
    const sizes = m.allFaces().map((f) => size(flattenFace(m, f.id).loops).map((n) => Math.round(n * 1000) / 1000));
    // 24 x 12 (top and bottom), 24 x 8 (front, back), 12 x 8 (the two ends)
    expect(sizes.filter((s) => s[0] === 24 && s[1] === 12)).toHaveLength(2);
    expect(sizes.filter((s) => s[0] === 24 && s[1] === 8)).toHaveLength(2);
    expect(sizes.filter((s) => s[0] === 12 && s[1] === 8)).toHaveLength(2);
    // Every flat part starts at the origin.
    for (const f of m.allFaces()) {
      const flat = flattenFace(m, f.id);
      expect(Math.min(...flat.loops.flat().map((p) => p.x))).toBeCloseTo(0);
      expect(Math.min(...flat.loops.flat().map((p) => p.y))).toBeCloseTo(0);
    }
  });

  it('keeps holes with their part', () => {
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(100, 0), v(100, 50), v(0, 50)]));
    m.edit(() => drawPolygon(m, [v(40, 20), v(60, 20), v(60, 30), v(40, 30)]));
    const withHole = m.allFaces().find((f) => f.holes.length === 1)!;
    const flat = flattenFace(m, withHole.id);
    expect(flat.loops).toHaveLength(2);
    expect(flat.loops[1]).toHaveLength(4);
  });

  it('lays parts out in rows without overlap, a gap apart', () => {
    const m = part();
    const parts = m.allFaces().map((f) => flattenFace(m, f.id));
    const layout = layoutParts(parts, 5, 60);
    expect(layout.parts).toHaveLength(6);
    for (let i = 0; i < layout.parts.length; i++) {
      for (let j = i + 1; j < layout.parts.length; j++) {
        const a = layout.parts[i];
        const b = layout.parts[j];
        const overlap = a.x < b.x + b.width + 5 - 1e-9 && b.x < a.x + a.width + 5 - 1e-9 && a.y < b.y + b.height + 5 - 1e-9 && b.y < a.y + a.height + 5 - 1e-9;
        expect(overlap, `${i} and ${j}`).toBe(false);
      }
    }
    expect(layout.width).toBeLessThanOrEqual(60 + 1e-9);
  });

  it('writes an SVG at true size in millimetres and a DXF that reads back', () => {
    const m = part();
    const layout = layoutParts(m.allFaces().map((f) => flattenFace(m, f.id)));
    const svg = layoutToSvg(layout);
    const match = /width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(match[1])).toBe(Number(match[3])); // 1 user unit is 1 mm
    expect(Number(match[1])).toBeGreaterThan(layout.width);
    expect(svg.match(/<path /g)).toHaveLength(6);
    const dxf = parseDxf(layoutToDxf(layout));
    expect(dxf.unitMm).toBe(1);
    expect(dxf.paths).toHaveLength(6);
    expect(dxf.paths.every((p) => p.closed && p.points.length === 4)).toBe(true);
    const widths = dxf.paths.map((p) => Math.max(...p.points.map((q) => q[0])) - Math.min(...p.points.map((q) => q[0])));
    expect(widths.filter((w) => Math.abs(w - 24) < 1e-6)).toHaveLength(4);
  });
});
