import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../kernel/Model';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { paintFaces } from '../kernel/cleanup';
import { Document } from '../document';
import { buildSheets } from './build';
import { sheetToSvg } from './svg';
import { sheetsToPdf } from './pdf';
import { hatchSegments, HATCHES } from './hatch';
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

describe('colour fills', () => {
  function painted() {
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -3000));
    return m;
  }

  it('adds no fills when nothing is painted', () => {
    const m = painted();
    for (const kind of ['front', 'right'] as const) {
      expect(computeDrawing(m, viewSetup({ kind }, DEFAULT_SETTINGS, m.bounds())).fills).toEqual([]);
    }
  });

  it('fills the wall facing the viewer with its paint, far faces first, and the rest in paper colour', () => {
    const m = painted();
    const front = m.allFaces().find((f) => f.normal.y < -0.99)!;
    m.edit(() => paintFaces(m, [front.id], '#b5654a'));
    const fills = computeDrawing(m, viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, m.bounds())).fills;
    // Front and back wall are seen face on; the sides and top/bottom are edge-on.
    expect(fills.map((f) => f.color)).toEqual([null, '#b5654a']);
  });

  it('shows a face seen from behind in paper colour, not its paint', () => {
    const m = painted();
    const front = m.allFaces().find((f) => f.normal.y < -0.99)!;
    m.edit(() => paintFaces(m, [front.id], '#b5654a'));
    const back = computeDrawing(m, viewSetup({ kind: 'back' }, DEFAULT_SETTINGS, m.bounds())).fills;
    expect(back.every((f) => f.color === null)).toBe(true);
  });

  it('draws the fills before the lines on a sheet', () => {
    const doc = new Document();
    doc.run('Box', () => {
      drawPolygon(doc.model, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]);
      pushPull(doc.model, doc.model.allFaces()[0].id, -3000);
      paintFaces(doc.model, doc.model.allFaces().filter((f) => f.normal.y < -0.99).map((f) => f.id), '#b5654a');
    });
    const [{ sheet }] = buildSheets(doc, [{ kind: 'front' }], { scale: 100 });
    const firstFill = sheet.primitives.findIndex((p) => p.type === 'path' && p.fill === '#b5654a');
    const firstLine = sheet.primitives.findIndex((p) => p.type === 'path' && p.stroke && !p.fill);
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(firstLine);
  });

  it('lets edges show through glass, and fills the glass translucently', () => {
    const m = new Model();
    // A wide box, and a small one standing behind it: seen from the front it is hidden by the wall.
    m.edit(() => drawPolygon(m, [v(0, 0), v(6000, 0), v(6000, 1000), v(0, 1000)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -3000));
    m.edit(() => drawPolygon(m, [v(2000, 4000), v(3000, 4000), v(3000, 5000), v(2000, 5000)]));
    m.edit(() => pushPull(m, m.allFaces().find((f) => f.normal.z < -0.99 && m.position(f.outer[0]).y >= 4000)!.id, -2000));
    const setup = viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, m.bounds());
    const solid = computeDrawing(m, setup);
    const walls = m.allFaces().filter((f) => Math.abs(f.normal.y) > 0.99 && m.position(f.outer[0]).y < 1500);
    m.edit(() => paintFaces(m, walls.map((f) => f.id), '#9fc3d6', 0.4));
    const glassy = computeDrawing(m, setup);
    // The small box's outline is hidden by the walls until they are glass.
    expect(glassy.lines.length).toBeGreaterThan(solid.lines.length);
    expect(glassy.fills.some((f) => f.opacity === 0.4 && f.color === '#9fc3d6')).toBe(true);
  });

  it('writes the opacity to SVG and PDF', () => {
    const doc = new Document();
    doc.run('Box', () => {
      drawPolygon(doc.model, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]);
      pushPull(doc.model, doc.model.allFaces()[0].id, -3000);
      paintFaces(doc.model, doc.model.allFaces().filter((f) => f.normal.y < -0.99).map((f) => f.id), '#9fc3d6', 0.4);
    });
    const [{ sheet }] = buildSheets(doc, [{ kind: 'front' }], { scale: 100 });
    expect(sheetToSvg(sheet)).toContain('opacity="0.4"');
    const pdf = new TextDecoder().decode(sheetsToPdf([sheet]));
    expect(pdf).toContain('/ca 0.4');
    expect(pdf).toContain('/GS1 gs');
  });

describe('shading', () => {
  function house() {
    const m = new Model();
    m.edit(() => drawPolygon(m, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]));
    m.edit(() => pushPull(m, m.allFaces()[0].id, -3000));
    return m;
  }

  it('adds no fills or shadows without shading', () => {
    const m = house();
    for (const ref of [{ kind: 'front' as const }, { kind: 'plan' as const, level: 'level-0' }]) {
      const d = computeDrawing(m, viewSetup(ref, DEFAULT_SETTINGS, m.bounds()));
      expect(d.fills).toEqual([]);
      expect(d.shadows).toEqual([]);
    }
  });

  it('shades faces by their orientation to the light: lit sides lighter than the side away from it', () => {
    const m = house();
    const front = computeDrawing(m, viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    const right = computeDrawing(m, viewSetup({ kind: 'right' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    const left = computeDrawing(m, viewSetup({ kind: 'left' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    const lit = (d: Drawing) => Math.max(...d.fills.map((f) => f.shade ?? 0));
    // Light comes from the front and the left (-y, -x): the front and left walls catch it, the right wall does not.
    expect(lit(front)).toBeGreaterThan(0.8);
    expect(lit(left)).toBeGreaterThan(lit(right));
    expect(lit(right)).toBeCloseTo(0.72, 5);
    expect(front.fills.every((f) => f.shade !== undefined && f.shade >= 0.72 && f.shade <= 1)).toBe(true);
  });

  it('throws counter-clockwise ground shadows in a ground-level plan only', () => {
    const m = house();
    const plan = computeDrawing(m, viewSetup({ kind: 'plan', level: 'level-0' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    expect(plan.shadows.length).toBeGreaterThan(0);
    for (const polygon of plan.shadows) expect(signedArea(polygon)).toBeGreaterThan(0);
    // The light travels to +x and +y, so the shadow reaches past the building on that side.
    expect(Math.max(...plan.shadows.flat().map((p) => p.x))).toBeGreaterThan(4000);
    expect(plan.bounds.max.x).toBeGreaterThan(4000);
    const front = computeDrawing(m, viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    expect(front.shadows).toEqual([]);
  });

  it('casts the shadow of an overhang onto the wall below it, and none on a plain box', () => {
    const plain = house();
    const setup = viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, plain.bounds());
    expect(computeDrawing(plain, setup, { shading: true }).fills.some((f) => f.shadows)).toBe(false);

    // The same box with a slab sticking out 1 m over the front near the top.
    const m = house();
    m.edit(() => drawPolygon(m, [v(0, -1000, 2500), v(4000, -1000, 2500), v(4000, 0, 2500), v(0, 0, 2500)]));
    const slab = m.allFaces().find((f) => Math.abs(f.normal.z) > 0.99 && m.position(f.outer[0]).z === 2500 && m.position(f.outer[0]).y <= 0 && m.faceVertices(f).some((id) => m.position(id).y === -1000))!;
    m.edit(() => pushPull(m, slab.id, slab.normal.z > 0 ? 500 : -500));
    const drawing = computeDrawing(m, viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, m.bounds()), { shading: true });
    const shadowed = drawing.fills.filter((f) => f.shadows && f.shadows.length > 0);
    expect(shadowed.length).toBeGreaterThan(0);
    // Shadow polygons are counter-clockwise and lie below the slab (z < 3000).
    for (const f of shadowed) for (const poly of f.shadows!) expect(signedArea(poly)).toBeGreaterThan(0);
    const lowest = Math.min(...shadowed.flatMap((f) => f.shadows!.flat().map((p) => p.y)));
    expect(lowest).toBeLessThan(2500);
  });

  it('keeps shadows inside the face they fall on in SVG and PDF', () => {
    const doc = new Document();
    doc.run('Boxes', () => {
      drawPolygon(doc.model, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]);
      pushPull(doc.model, doc.model.allFaces()[0].id, -3000);
      drawPolygon(doc.model, [v(0, -1000, 2500), v(4000, -1000, 2500), v(4000, 0, 2500), v(0, 0, 2500)]);
      const slab = doc.model.allFaces().find((f) => Math.abs(f.normal.z) > 0.99 && doc.model.position(f.outer[0]).z === 2500 && doc.model.faceVertices(f).some((id) => doc.model.position(id).y === -1000))!;
      pushPull(doc.model, slab.id, slab.normal.z > 0 ? 500 : -500);
    });
    doc.updateDrawingSettings('Shading', { ...doc.drawingSettings, shading: true });
    const [{ sheet }] = buildSheets(doc, [{ kind: 'front' }], { scale: 100 });
    expect(sheet.primitives.some((p) => p.type === 'path' && p.clip && p.opacity === 0.22)).toBe(true);
    expect(sheetToSvg(sheet)).toMatch(/<clipPath id="clip0"><path d="[^"]+" clip-rule="evenodd"\/><\/clipPath>/);
    expect(new TextDecoder().decode(sheetsToPdf([sheet]))).toContain(' W* n ');
  });

  it('writes the shadow as one translucent path under the fills on a sheet', () => {
    const doc = new Document();
    doc.run('Box', () => {
      drawPolygon(doc.model, [v(0, 0), v(4000, 0), v(4000, 3000), v(0, 3000)]);
      pushPull(doc.model, doc.model.allFaces()[0].id, -3000);
    });
    doc.updateDrawingSettings('Shading', { ...doc.drawingSettings, shading: true });
    const [{ sheet }] = buildSheets(doc, [{ kind: 'plan', level: 'level-0' }], { scale: 100 });
    const translucent = sheet.primitives.findIndex((p) => p.type === 'path' && p.opacity === 0.13);
    const firstFill = sheet.primitives.findIndex((p, i) => i !== translucent && p.type === 'path' && p.fill && p.stroke === p.fill);
    expect(translucent).toBeGreaterThanOrEqual(0);
    expect(translucent).toBeLessThan(firstFill);
  });
});

  describe('hatching', () => {
    const wall = { minX: 0, minY: 0, maxX: 6000, maxY: 3000 };

    it('spaces patterns out until they read on paper, and caps how many lines a face gets', () => {
      for (const { id } of HATCHES) {
        const fine = hatchSegments(id, wall, 20); // 1:20: close to true size
        const coarse = hatchSegments(id, wall, 200); // 1:200: spread out
        expect(fine.length).toBeGreaterThan(0);
        expect(coarse.length).toBeGreaterThan(0);
        // However fine the scale, a face never gets more lines than the cap allows.
        expect(fine.length).toBeLessThan(2500);
        expect(coarse.length).toBeLessThan(2500);
      }
      // A small panel at a coarse scale still gets a pattern that is not finer than 1.3 mm on paper.
      const spacing = hatchSegments('brick', { minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, 100).filter(([a, b]) => a.y === b.y).map(([a]) => a.y);
      expect(Math.min(...spacing.slice(1).map((y, i) => y - spacing[i]).filter((d) => d > 0)) / 100).toBeGreaterThanOrEqual(1.3);
      expect(hatchSegments('nonsense', wall, 100)).toEqual([]);
    });

    it('lays brick courses horizontally and boards vertically', () => {
      const courses = hatchSegments('brick', wall, 50).filter(([a, b]) => a.y === b.y);
      expect(courses.length).toBeGreaterThan(5);
      const boards = hatchSegments('boards', wall, 50);
      expect(boards.every(([a, b]) => a.x === b.x)).toBe(true);
    });

    it('carries a face hatch into the drawing and onto the sheet, clipped to the face', () => {
      const doc = new Document();
      doc.run('Box', () => {
        drawPolygon(doc.model, [v(0, 0), v(6000, 0), v(6000, 3000), v(0, 3000)]);
        pushPull(doc.model, doc.model.allFaces()[0].id, -3000);
        paintFaces(doc.model, doc.model.allFaces().filter((f) => f.normal.y < -0.99).map((f) => f.id), '#b5654a', undefined, 'brick');
      });
      const model = doc.flatten();
      const drawing = computeDrawing(model, viewSetup({ kind: 'front' }, DEFAULT_SETTINGS, model.bounds()));
      const hatched = drawing.fills.filter((f) => f.hatch);
      expect(hatched).toHaveLength(1);
      expect(hatched[0].hatch!.kind).toBe('brick');
      const [{ sheet }] = buildSheets(doc, [{ kind: 'front' }], { scale: 50 });
      const path = sheet.primitives.find((p) => p.type === 'path' && p.clip && p.opacity === 0.6 && !p.fill);
      expect(path).toBeTruthy();
      // The same wall seen from behind (the hatch is on its front only) has no pattern.
      const back = computeDrawing(model, viewSetup({ kind: 'back' }, DEFAULT_SETTINGS, model.bounds()));
      expect(back.fills.some((f) => f.hatch)).toBe(false);
    });
  });
});
