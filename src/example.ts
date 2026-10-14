import * as THREE from 'three';
import type { Document } from './document';
import { addSceneViewport, addViewport, nextLayout } from './drawing/layout';
import type { DrawingSettings, Scene } from './drawing/settings';
import { DEFAULT_SETTINGS } from './drawing/settings';
import type { CameraData } from './io/format';
import { paintFaces } from './kernel/cleanup';
import { drawPolygon } from './kernel/draw';
import { faceArea } from './kernel/faces';
import { Model, type Face } from './kernel/Model';
import { pushPull } from './kernel/pushPull';
import { combineSolids } from './kernel/solidOps';

/** The model the app opens with: a small flat-roofed villa with a terrace and a pool. */
export const EXAMPLE_NAME = 'Villa';

// Plan: the garden side (terrace, pool) faces -y; the entrance is on the +y side. Millimetres.
const W = 14000; // house, along x
const D = 7000; // house, along y
const WALL_H = 3000;
const WALL_T = 250;
const FL = 150; // top of the floor and of the terrace
const ROOF_T = 300;
const INSET = 80; // how far a window frame sits inside its opening

const POOL = { x0: 3000, x1: 12000, y0: -8500, y1: -5000 };
const COPING = 500;

const COLOR = {
  render: '#f1f0ec',
  dark: '#2b2f33',
  timber: '#8a6a4a',
  deck: '#b08a5c',
  stone: '#e6e3da',
  grass: '#8fb069',
  water: '#6ec1e4',
  basin: '#7fc8e0',
  glass: '#9fc3d6',
};

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const UP = v(0, 0, 1);

/** A closed solid: `outline` extruded by `length` along `direction` (whichever way the drawn face points). */
function extrude(outline: THREE.Vector3[], direction: THREE.Vector3, length: number): Model {
  const m = new Model();
  m.edit(() => {
    drawPolygon(m, outline);
    const face = m.allFaces()[0];
    pushPull(m, face.id, face.normal.dot(direction) >= 0 ? length : -length);
  });
  return m;
}

/** An axis-aligned box. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Model {
  return extrude([v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)], UP, z1 - z0);
}

function paint(m: Model, color: string, opacity?: number, hatch?: string, material?: string): void {
  m.edit(() => paintFaces(m, m.allFaces().map((f) => f.id), color, opacity, hatch, material));
}

/** The smallest face without holes lying in an axis-aligned plane (`axis` = 0, 1 or 2 at `at`), facing along `sign`. */
function planeFace(m: Model, axis: 0 | 1 | 2, at: number, sign: 1 | -1, min = 1): Face {
  const key = (['x', 'y', 'z'] as const)[axis];
  const faces = m
    .allFaces()
    .filter((f) => f.holes.length === 0 && f.normal[key] * sign > 0.999 && Math.abs(m.position(f.outer[0])[key] - at) < 1e-6 && faceArea(m, f) > min)
    .sort((a, b) => faceArea(m, a) - faceArea(m, b));
  if (faces.length === 0) throw new Error(`Example face not found at ${key} = ${at}`);
  return faces[0];
}

type Side = 'front' | 'back' | 'left' | 'right';

/** Cuts an opening through a wall: a rectangle on the outside face of `side`, pushed in by `depth`. */
function punch(m: Model, side: Side, start: number, z: number, w: number, h: number, depth: number, outside = side === 'front' || side === 'left' ? 0 : side === 'back' ? D : W): void {
  const [axis, sign] = ({ front: [1, -1], back: [1, 1], left: [0, -1], right: [0, 1] } as const)[side];
  const point = (s: number, zz: number) => (axis === 1 ? v(s, outside, zz) : v(outside, s, zz));
  drawPolygon(m, [point(start, z), point(start + w, z), point(start + w, z + h), point(start, z + h)]);
  pushPull(m, planeFace(m, axis, outside, sign).id, -depth);
}

/** Openings as [position along the wall, sill height, width, height]. */
const OPENINGS = {
  front: { glazing: [1000, FL, 8000, 2600], windows: [[10500, 750, 2000, 1800]] },
  back: { door: [6500, FL, 1200, 2400], high: [[1000, 2100, 1800, 600], [3000, 2100, 1800, 600], [10000, 2100, 1800, 600]], windows: [[11000, 750, 2000, 1800]] },
  left: { windows: [[2500, 750, 2000, 1800]] },
} as const;
const CLADDING = { x0: 4800, x1: 9200, depth: 140 };

/** The walls and floor: a white volume with a deep terrace-side glazing opening, a door, and a few windows. */
function buildWalls(): Model {
  const m = box(0, 0, 0, W, D, WALL_H);
  m.edit(() => {
    drawPolygon(m, [v(WALL_T, WALL_T, WALL_H), v(W - WALL_T, WALL_T, WALL_H), v(W - WALL_T, D - WALL_T, WALL_H), v(WALL_T, D - WALL_T, WALL_H)]);
    pushPull(m, planeFace(m, 2, WALL_H, 1).id, -(WALL_H - FL));
    const open = (side: Side, [s, z, w, h]: readonly number[]) => punch(m, side, s, z, w, h, WALL_T);
    open('front', OPENINGS.front.glazing);
    for (const o of OPENINGS.front.windows) open('front', o);
    open('back', OPENINGS.back.door);
    for (const o of OPENINGS.back.high) open('back', o);
    for (const o of OPENINGS.back.windows) open('back', o);
    for (const o of OPENINGS.left.windows) open('left', o);
  });
  paint(m, COLOR.render, undefined, 'concrete');
  return m;
}

/** A dark-framed panel with a glass pane set back in it. Local origin at its lower left front corner; it faces -y. */
function buildGlazing(w: number, h: number, frame = 60): Model {
  const m = box(0, 0, 0, w, 90, h);
  m.edit(() => {
    drawPolygon(m, [v(frame, 0, frame), v(w - frame, 0, frame), v(w - frame, 0, h - frame), v(frame, 0, h - frame)]);
    pushPull(m, planeFace(m, 1, 0, -1).id, -60);
    paintFaces(m, m.allFaces().map((f) => f.id), COLOR.dark);
    paintFaces(m, [planeFace(m, 1, 60, -1).id], COLOR.glass, 0.35);
  });
  return m;
}

/** The front door: a dark timber slab with a vertical slot. Faces -y. */
function buildDoor(): Model {
  const [, , w, h] = OPENINGS.back.door;
  const m = box(0, 0, 0, w, 70, h);
  m.edit(() => {
    paintFaces(m, m.allFaces().map((f) => f.id), COLOR.timber, undefined, 'boards');
    drawPolygon(m, [v(w - 220, 0, 300), v(w - 140, 0, 300), v(w - 140, 0, h - 300), v(w - 220, 0, h - 300)]);
    pushPull(m, planeFace(m, 1, 0, -1).id, -25);
  });
  return m;
}

/** The roof: one flat slab, cantilevered 2.5 m over the terrace. */
function buildRoof(): Model {
  const m = box(-300, -2500, WALL_H, W + 300, D + 300, WALL_H + ROOF_T);
  paint(m, COLOR.render, undefined, 'concrete');
  return m;
}

/** Timber cladding over the entrance, with the door opening cut through it. */
function buildCladding(): Model {
  const m = box(CLADDING.x0, D, 0, CLADDING.x1, D + CLADDING.depth, WALL_H);
  const [s, z, w, h] = OPENINGS.back.door;
  m.edit(() => punch(m, 'back', s, z, w, h, CLADDING.depth, D + CLADDING.depth));
  paint(m, COLOR.timber, undefined, 'boards');
  return m;
}

/** The terrace: a timber deck level with the floor, along the whole garden side. */
function buildTerrace(): Model {
  const m = box(-500, -4000, -FL, W + 500, 0, FL);
  paint(m, COLOR.deck, undefined, 'boards');
  return m;
}

/** The lawn, with the pool let into it: a stone coping and a basin. */
function buildGarden(): Model {
  const m = box(-2500, -10000, -1800, 16500, 9000, -FL);
  m.edit(() => {
    const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];
    paintFaces(m, m.allFaces().map((f) => f.id), COLOR.grass, undefined, 'grass');
    drawPolygon(m, rect(POOL.x0 - COPING, POOL.y0 - COPING, POOL.x1 + COPING, POOL.y1 + COPING, -FL));
    const rim = planeFace(m, 2, -FL, 1, 1);
    pushPull(m, rim.id, 250);
    paintFaces(m, [planeFace(m, 2, 100, 1).id], COLOR.stone, undefined, 'concrete');
    drawPolygon(m, rect(POOL.x0, POOL.y0, POOL.x1, POOL.y1, 100));
    pushPull(m, planeFace(m, 2, 100, 1, 1).id, -1600);
    // The basin: every face inside the pool outline, below the coping top.
    const inside = (f: Face) => m.faceVertices(f).every((id) => {
      const p = m.position(id);
      return p.x >= POOL.x0 - 1e-6 && p.x <= POOL.x1 + 1e-6 && p.y >= POOL.y0 - 1e-6 && p.y <= POOL.y1 + 1e-6 && p.z < 100 + 1e-6;
    });
    paintFaces(m, m.allFaces().filter(inside).map((f) => f.id), COLOR.basin);
  });
  return m;
}

/** The water: a thin translucent slab a little below the coping. */
function buildWater(): Model {
  const m = box(POOL.x0 + 20, POOL.y0 + 20, -450, POOL.x1 - 20, POOL.y1 - 20, -300);
  paint(m, COLOR.water, 0.5, undefined, 'water');
  return m;
}

/** A stone path from the entrance. */
function buildPath(): Model {
  const m = box(6000, D + CLADDING.depth, -FL, 8200, 9000, FL - 20);
  paint(m, COLOR.stone, undefined, 'concrete');
  return m;
}

/** A dining table: a top with four slim legs fused to its underside. */
function buildTable(): Model {
  const m = box(0, 0, 700, 2000, 900, 750);
  m.edit(() => {
    for (const [x, y] of [[0, 0], [1900, 0], [0, 800], [1900, 800]]) {
      drawPolygon(m, [v(x, y, 700), v(x + 100, y, 700), v(x + 100, y + 100, 700), v(x, y + 100, 700)]);
      pushPull(m, planeFace(m, 2, 700, -1, 1).id, 700);
    }
    paintFaces(m, m.allFaces().map((f) => f.id), COLOR.timber, undefined, 'boards');
  });
  return m;
}

/** A sun lounger: a low slab with a raised back. Long side along y. */
function buildLounger(): Model {
  const m = box(0, 0, 0, 650, 1900, 300);
  m.edit(() => {
    drawPolygon(m, [v(0, 1300, 300), v(650, 1300, 300), v(650, 1900, 300), v(0, 1900, 300)]);
    pushPull(m, planeFace(m, 2, 300, 1, 1).id, 250);
    paintFaces(m, m.allFaces().map((f) => f.id), '#f7f6f2');
  });
  return m;
}

/** A tree in the simplest shape: a trunk with a block of leaves, fused. */
function buildTree(): Model {
  const trunk = box(-100, -100, 0, 100, 100, 1700);
  paint(trunk, '#6b5a47');
  const crown = box(-800, -800, 1500, 800, 800, 2900);
  paint(crown, '#5f8a4e');
  return combineSolids(trunk, crown, 'union');
}

/** A kitchen island, a sofa and a bed: plain boxes. */
const buildIsland = () => paintTo(box(0, 0, 0, 3000, 1000, 900), '#3a3f45');
const buildSofa = () => {
  const m = box(0, 0, 0, 2400, 950, 420);
  m.edit(() => {
    drawPolygon(m, [v(0, 700, 420), v(2400, 700, 420), v(2400, 950, 420), v(0, 950, 420)]);
    pushPull(m, planeFace(m, 2, 420, 1, 1).id, 380);
  });
  return paintTo(m, '#7d8a96');
};
const buildBed = () => paintTo(box(0, 0, 0, 1700, 2100, 450), '#d8d3c8');

function paintTo(m: Model, color: string): Model {
  paint(m, color);
  return m;
}

const compose = (...parts: THREE.Matrix4[]) => parts.reduce((m, p) => m.multiply(p), new THREE.Matrix4());
const move = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const turn = (angle: number) => new THREE.Matrix4().makeRotationZ(angle);
const mirrorX = () => new THREE.Matrix4().makeScale(-1, 1, 1);
const grow = (f: number) => new THREE.Matrix4().makeScale(f, f, f);

/**
 * Replaces the document with the villa: walls with openings, glazing, a door and furniture as components,
 * a cantilevered roof, a terrace and a pool, tags, saved views, dimensions, two levels and a sheet. Built
 * through the same kernel operations the tools use. Returns the camera to start from.
 */
export function loadExample(doc: Document): CameraData {
  doc.load({ nextId: 1, vertices: [], edges: [], faces: [], guides: [] }, EXAMPLE_NAME, null);

  doc.run('Example', () => {
    const ctx = doc.context.model;
    // addGroupFromModel puts an instance in; swap it for a tagged one, and hand back a way to place more.
    const part = (model: Model, name: string, tag: string, kind: 'group' | 'component' = 'group') => {
      const id = doc.addGroupFromModel(model, name, kind);
      const definition = ctx.instance(id).definition;
      ctx.removeInstance(id);
      return { definition, add: (matrix = new THREE.Matrix4()) => ctx.addInstance(definition, matrix, tag) };
    };

    part(buildGarden(), 'Lawn and pool', 'tag-garden').add();
    part(buildWater(), 'Water', 'tag-pool').add();
    part(buildTerrace(), 'Terrace', 'tag-garden').add();
    part(buildPath(), 'Entrance path', 'tag-garden').add();
    part(buildWalls(), 'Walls', 'tag-structure').add();
    part(buildRoof(), 'Roof', 'tag-roof').add();
    part(buildCladding(), 'Entrance cladding', 'tag-structure').add();

    const [gx, gz, gw, gh] = OPENINGS.front.glazing;
    const panel = part(buildGlazing(gw / 4, gh), 'Glass panel', 'tag-glazing', 'component');
    for (let i = 0; i < 4; i++) panel.add(move(gx + (gw / 4) * i, INSET, gz));
    // The window turns up on three sides: front, back and left; the left one is mirrored.
    const window = part(buildGlazing(2000, 1800), 'Window', 'tag-glazing', 'component');
    for (const [x, z] of OPENINGS.front.windows) window.add(move(x, INSET, z));
    for (const [x, z] of OPENINGS.back.windows) window.add(compose(move(x + 2000, D - INSET, z), turn(Math.PI)));
    for (const [y, z] of OPENINGS.left.windows) window.add(compose(move(INSET, y + 2000, z), turn(-Math.PI / 2), mirrorX(), move(-2000, 0, 0)));
    const high = part(buildGlazing(1800, 600, 40), 'High window', 'tag-glazing', 'component');
    for (const [x, z] of OPENINGS.back.high) high.add(compose(move(x + 1800, D - INSET, z), turn(Math.PI)));
    const [dx, dz, dw] = OPENINGS.back.door;
    part(buildDoor(), 'Front door', 'tag-glazing', 'component').add(compose(move(dx + dw, D - 90, dz), turn(Math.PI)));

    part(buildIsland(), 'Kitchen island', 'tag-furniture').add(move(5500, 3200, FL));
    part(buildSofa(), 'Sofa', 'tag-furniture').add(move(1500, 1800, FL));
    part(buildBed(), 'Bed', 'tag-furniture').add(move(11300, 4200, FL));
    const table = part(buildTable(), 'Dining table', 'tag-furniture', 'component');
    table.add(move(1500, 4800, FL));
    table.add(compose(move(W - 1500, 5800, FL), mirrorX(), turn(Math.PI / 2)));
    const lounger = part(buildLounger(), 'Sun lounger', 'tag-garden', 'component');
    lounger.add(move(2000, -3500, FL));
    lounger.add(move(3000, -3500, FL));
    lounger.add(compose(move(14000, -9500, -FL + 250), turn(Math.PI / 2)));
    const tree = part(buildTree(), 'Tree', 'tag-garden', 'component');
    tree.add(move(-1200, -2500, -FL));
    tree.add(compose(move(15500, 3000, -FL), grow(1.3)));
    tree.add(compose(move(-1500, 7800, -FL), grow(1.2)));

    // The scale figure stands on the terrace.
    const figure = doc.placeFigure(move(11500, -2500, FL));
    const figureDefinition = ctx.instance(figure).definition;
    ctx.removeInstance(figure);
    ctx.addInstance(figureDefinition, move(11500, -2500, FL), 'tag-garden');
  });

  const camera = (position: [number, number, number], target: [number, number, number]): CameraData => ({ position, target, ortho: false, orthoHeight: 9000 });
  const overview = camera([-11000, -21000, 9500], [7000, -1500, 800]);
  const scenes: Scene[] = [
    { id: 'scene-1', name: 'Garden view', camera: overview },
    { id: 'scene-2', name: 'Pool', camera: camera([19500, -17500, 3800], [7000, -5500, 0]) },
    { id: 'scene-3', name: 'Entrance', camera: camera([21000, 17500, 6000], [7000, 5000, 1200]) },
    { id: 'scene-4', name: 'Roof off', camera: camera([6000, -9500, 21000], [7000, 3000, 0]), hidden: ['tag-roof'] },
  ];
  const settings: DrawingSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    levels: [
      { id: 'level-0', name: 'Ground floor', elevation: 0 },
      { id: 'level-1', name: 'Roof', elevation: WALL_H },
    ],
    sections: [
      { id: 'A', axis: 'y', position: D / 2 },
      { id: 'B', axis: 'x', position: 7000 },
    ],
    shading: false,
    tags: [
      { id: 'tag-structure', name: 'Walls', visible: true },
      { id: 'tag-roof', name: 'Roof', visible: true },
      { id: 'tag-glazing', name: 'Glazing and doors', visible: true },
      { id: 'tag-furniture', name: 'Furniture', visible: true },
      { id: 'tag-garden', name: 'Garden and terrace', visible: true },
      { id: 'tag-pool', name: 'Water', visible: true },
    ],
    dimensions: [
      { id: 'd1', a: [0, 0, 0], b: [W, 0, 0], offset: [0, -1500, 0] },
      { id: 'd2', a: [W, 0, 0], b: [W, D, 0], offset: [1500, 0, 0] },
      { id: 'd3', a: [POOL.x0, POOL.y0, 0], b: [POOL.x1, POOL.y0, 0], offset: [0, -1500, 0] },
      { id: 'd4', a: [POOL.x1, POOL.y0, 0], b: [POOL.x1, POOL.y1, 0], offset: [1500, 0, 0] },
      { id: 'd5', a: [W, 0, 0], b: [W, 0, WALL_H + ROOF_T], offset: [1500, 0, 0] },
    ],
    scenes,
  };
  doc.updateDrawingSettings('Example', settings);

  // A sheet: plan, front elevation and two sections at 1:100, and the garden view.
  let sheet = { ...nextLayout([], 'A2'), name: 'Villa' };
  sheet = addViewport(doc, sheet, { kind: 'plan', level: 'level-0' }, 100);
  sheet = addViewport(doc, sheet, { kind: 'front' }, 100);
  sheet = addViewport(doc, sheet, { kind: 'section', section: 'A' }, 100);
  sheet = addViewport(doc, sheet, { kind: 'section', section: 'B' }, 100);
  sheet = addSceneViewport(doc, sheet, scenes[0], 140, 0.6);
  sheet = { ...sheet, north: { x: 560, y: 40 } };
  doc.updateDrawingSettings('Example', { ...doc.drawingSettings, layouts: [sheet] });

  doc.history.clear();
  doc.markSaved(EXAMPLE_NAME, null);
  return overview;
}
