import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { faceArea } from '../kernel/faces';
import { signedArea } from '../kernel/math';
import { computeDrawing, type Drawing } from './project';
import { viewSetup, type ViewKind } from './views';
import { DEFAULT_SETTINGS, type DrawingSettings, type ViewRef } from './settings';

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

function refFor(kind: ViewKind): ViewRef {
  if (kind === 'plan') return { kind: 'plan', level: 'level-0' };
  if (kind === 'section') return { kind: 'section', section: 'A' };
  return { kind };
}

function draw(model: Model, kind: ViewKind, settings: DrawingSettings = DEFAULT_SETTINGS): Drawing {
  return computeDrawing(model, viewSetup(refFor(kind), settings, model.bounds()));
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
    const d = draw(box(), 'plan', { ...DEFAULT_SETTINGS, cutHeight: 5000 });
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

describe('levels', () => {
  /** Two stacked boxes: ground floor 0–3000, first floor 3000–6000 (smaller). */
  function stacked(): Model {
    const model = box();
    // A 2 x 2 m block on top of the 6 x 4 x 3 m box.
    model.edit(() => drawPolygon(model, rect(1000, 1000, 3000, 3000, 3000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 4_000_000)!;
    model.edit(() => pushPull(model, inner.id, 3000));
    return model;
  }
  const settings: DrawingSettings = {
    ...DEFAULT_SETTINGS,
    levels: [
      { id: 'level-0', name: 'Ground floor', elevation: 0 },
      { id: 'level-1', name: 'First floor', elevation: 3000 },
    ],
  };

  it('cuts each level at its own height', () => {
    const model = stacked();
    const ground = computeDrawing(model, viewSetup({ kind: 'plan', level: 'level-0' }, settings, model.bounds()));
    const first = computeDrawing(model, viewSetup({ kind: 'plan', level: 'level-1' }, settings, model.bounds()));
    expect(cutArea(ground)).toBe(24_000_000);
    expect(cutArea(first)).toBe(4_000_000);
  });

  it('does not show what lies below a level through its plan', () => {
    const model = stacked();
    // A level at 3.5 m: the ground floor roof (at 3 m) lies below it and is left out.
    const raised = { ...settings, levels: [{ id: 'level-1', name: 'Mezzanine', elevation: 3500 }] };
    const plan = computeDrawing(model, viewSetup({ kind: 'plan', level: 'level-1' }, raised, model.bounds()));
    expect(plan.bounds.max.x).toBeLessThanOrEqual(3000);
    // At exactly 3 m the roof is the floor (a terrace) and is shown.
    const first = computeDrawing(model, viewSetup({ kind: 'plan', level: 'level-1' }, settings, model.bounds()));
    expect(first.bounds.max.x).toBe(6000);
  });
});
