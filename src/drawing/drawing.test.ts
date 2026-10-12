import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { faceArea } from '../kernel/faces';
import { signedArea } from '../kernel/math';
import { computeDrawing, type Drawing } from './project';
import { DEFAULT_VIEW_OPTIONS, viewSetup, type ViewKind } from './views';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];

/** 6 x 4 x 3 m box at the origin. */
function box(): Model {
  const model = new Model();
  model.edit(() => drawPolygon(model, rect(0, 0, 6000, 4000)));
  model.edit(() => pushPull(model, model.allFaces()[0].id, -3000));
  return model;
}

function topFace(model: Model, z: number) {
  return model.allFaces().find((f) => f.normal.z === 1 && model.position(f.outer[0]).z === z)!;
}

function draw(model: Model, kind: ViewKind, options = DEFAULT_VIEW_OPTIONS): Drawing {
  return computeDrawing(model, viewSetup(kind, options, model.bounds()));
}

const totalLength = (d: Drawing) => Math.round(d.lines.reduce((sum, l) => sum + l.a.distanceTo(l.b), 0));
const cutArea = (d: Drawing) => Math.round(d.cutLoops.reduce((sum, loop) => sum + signedArea(loop), 0) * Math.sign(signedArea(d.cutLoops[0] ?? [])));

describe('elevations', () => {
  it('draws a box front as its outline, with nothing hidden showing through', () => {
    const d = draw(box(), 'front');
    expect(d.cutLoops).toHaveLength(0);
    // Front rectangle: 2 x 6000 + 2 x 3000. Back edges are hidden behind the front face.
    expect(totalLength(d)).toBe(18_000);
    expect(d.bounds.min.toArray()).toEqual([0, 0]);
    expect(d.bounds.max.toArray()).toEqual([6000, 3000]);
  });

  it('shows the right side with Y running to the right', () => {
    const d = draw(box(), 'right');
    expect(d.bounds.min.x).toBe(0);
    expect(d.bounds.max.x).toBe(4000);
  });

  it('hides the lower half of a bump behind a parapet in front of it', () => {
    const model = box();
    // A 2 x 2 m block on the roof, set back 1 m from the front.
    model.edit(() => drawPolygon(model, rect(2000, 1000, 4000, 3000, 3000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 4_000_000)!;
    model.edit(() => pushPull(model, inner.id, 1000));
    const d = draw(model, 'front');
    // Box outline 18000, plus the bump above the roof line: 2 x 1000 sides + 2000 top.
    // The bump's base edge lies on the roof line (drawn on top of the box edge).
    expect(d.bounds.max.y).toBe(4000);
    const above = d.lines.filter((l) => Math.min(l.a.y, l.b.y) >= 3000 - 1e-6 && Math.max(l.a.y, l.b.y) > 3000);
    expect(Math.round(above.reduce((s, l) => s + l.a.distanceTo(l.b), 0))).toBe(4000);
    // Bump lines are further away than the box front.
    expect(Math.max(...above.map((l) => l.depth))).toBeGreaterThan(0);
  });
});

describe('plans and sections', () => {
  it('cuts a solid box into one filled rectangle in plan', () => {
    const d = draw(box(), 'plan');
    expect(d.cutLoops).toHaveLength(1);
    expect(cutArea(d)).toBe(24_000_000);
    expect(d.cutSegments).toHaveLength(4);
  });

  it('draws nothing above the cut', () => {
    const d = draw(box(), 'plan', { ...DEFAULT_VIEW_OPTIONS, cutHeight: 5000 });
    expect(d.cutLoops).toHaveLength(0);
    // Looking down from above the box: its top outline.
    expect(totalLength(d)).toBeGreaterThanOrEqual(20_000);
  });

  it('cuts through a recess in section', () => {
    const model = box();
    model.edit(() => drawPolygon(model, rect(2000, 1000, 4000, 3000, 3000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 4_000_000)!;
    model.edit(() => pushPull(model, inner.id, -1000));
    const d = draw(model, 'section');
    // Section at y = 2000 through the recess: a U shape = full rectangle minus the 2 x 1 m notch.
    expect(d.cutLoops).toHaveLength(1);
    expect(cutArea(d)).toBe(18_000_000 - 2_000_000);
    // The recess's back wall is seen beyond the cut.
    expect(d.lines.some((l) => l.a.y > 2000 && l.b.y > 2000)).toBe(true);
    expect(topFace(model, 3000)).toBeDefined();
  });

  it('cuts two separate boxes into two loops', () => {
    const model = box();
    model.edit(() => drawPolygon(model, rect(8000, 0, 10000, 2000)));
    const ground = model.allFaces().find((f) => f.normal.z === -1 && Math.round(faceArea(model, f)) === 4_000_000)!;
    model.edit(() => pushPull(model, ground.id, -2000));
    const d = draw(model, 'plan');
    expect(d.cutLoops).toHaveLength(2);
    expect(cutArea(d)).toBe(24_000_000 + 4_000_000);
  });
});
