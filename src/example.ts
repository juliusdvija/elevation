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

export const EXAMPLE_NAME = 'Example - small house';

// Plan: the front (door side) faces -y. Millimetres.
const W = 8000; // along x
const D = 6000; // along y
const WALL_H = 2700;
const WALL_T = 250;
const FLOOR_T = 150;
const PITCH = Math.tan((35 * Math.PI) / 180);

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

function paint(m: Model, color: string, opacity?: number, hatch?: string): void {
  m.edit(() => paintFaces(m, m.allFaces().map((f) => f.id), color, opacity, hatch));
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

/** The four walls with an open top, the floor, and a window and door opening cut through. */
function buildWalls(): Model {
  const m = box(0, 0, 0, W, D, WALL_H);
  m.edit(() => {
    drawPolygon(m, [v(WALL_T, WALL_T, WALL_H), v(W - WALL_T, WALL_T, WALL_H), v(W - WALL_T, D - WALL_T, WALL_H), v(WALL_T, D - WALL_T, WALL_H)]);
    pushPull(m, planeFace(m, 2, WALL_H, 1).id, -(WALL_H - FLOOR_T));
    for (const [x, z, w, h] of WINDOWS.front) punch(m, 'front', x, z, w, h);
    punch(m, 'front', DOOR.x, 0, DOOR.w, DOOR.h);
    for (const [x, z, w, h] of WINDOWS.back) punch(m, 'back', x, z, w, h);
    for (const [y, z, w, h] of WINDOWS.side) {
      punch(m, 'left', y, z, w, h);
      punch(m, 'right', y, z, w, h);
    }
  });
  return m;
}

/** Windows as [position along the wall, sill height, width, height], per side. */
const WINDOWS = {
  front: [[900, 900, 1200, 1300], [5900, 900, 1200, 1300]] as [number, number, number, number][],
  back: [[900, 900, 1200, 1300], [3400, 900, 1200, 1300], [5900, 900, 1200, 1300]] as [number, number, number, number][],
  side: [[2400, 900, 1200, 1300]] as [number, number, number, number][],
};
const DOOR = { x: 3550, w: 900, h: 2100 };

/** Cuts an opening through a wall: a rectangle on the outside face pushed in through the wall thickness. */
function punch(m: Model, side: 'front' | 'back' | 'left' | 'right', start: number, z: number, w: number, h: number): void {
  const [axis, at, sign] = { front: [1, 0, -1], back: [1, D, 1], left: [0, 0, -1], right: [0, W, 1] }[side] as [0 | 1, number, 1 | -1];
  const point = (s: number, zz: number) => (axis === 1 ? v(s, at, zz) : v(at, s, zz));
  drawPolygon(m, [point(start, z), point(start + w, z), point(start + w, z + h), point(start, z + h)]);
  pushPull(m, planeFace(m, axis, at, sign).id, -WALL_T);
}

/** A window: a frame with a glass pane set back in it. Local origin at its lower left front corner; it faces -y. */
function buildWindow(w: number, h: number): Model {
  const m = box(0, 0, 0, w, 90, h);
  m.edit(() => {
    const t = 70;
    drawPolygon(m, [v(t, 0, t), v(w - t, 0, t), v(w - t, 0, h - t), v(t, 0, h - t)]);
    pushPull(m, planeFace(m, 1, 0, -1).id, -60);
    paintFaces(m, m.allFaces().map((f) => f.id), '#f2f2ee');
    const pane = planeFace(m, 1, 60, -1);
    paintFaces(m, [pane.id], '#9fc3d6', 0.4);
  });
  return m;
}

/** A front door in timber with a raised panel. Faces -y. */
function buildDoor(): Model {
  const m = box(0, 0, 0, DOOR.w, 70, DOOR.h);
  m.edit(() => {
    paintFaces(m, m.allFaces().map((f) => f.id), '#7a5230', undefined, 'boards');
    drawPolygon(m, [v(150, 0, 300), v(DOOR.w - 150, 0, 300), v(DOOR.w - 150, 0, 1100), v(150, 0, 1100)]);
    pushPull(m, planeFace(m, 1, 0, -1).id, -20);
  });
  return m;
}

/** A gable roof, ridge along y, with overhangs, as a solid prism. */
function buildRoof(): Model {
  const over = 500;
  const rise = (W / 2 + over) * PITCH;
  const m = extrude([v(-over, -over, WALL_H), v(W + over, -over, WALL_H), v(W / 2, -over, WALL_H + rise)], v(0, 1, 0), D + 2 * over);
  paint(m, '#cf7b5a', undefined, 'tiles');
  return m;
}

function buildChimney(): Model {
  const m = box(6200, 2500, WALL_H, 6700, 3000, WALL_H + 1750);
  paint(m, '#8c4f3b', undefined, 'brick');
  return m;
}

/** A concrete porch slab in front of the door. */
function buildPorch(): Model {
  const m = box(2900, -1700, 0, 5100, 0, 150);
  paint(m, '#a9a9a4', undefined, 'concrete');
  return m;
}

function buildSteps(): Model {
  const m = box(3050, -2300, 0, 4950, -1700, 80);
  paint(m, '#a9a9a4', undefined, 'concrete');
  return m;
}

function buildGround(): Model {
  const m = box(-2000, -3200, -120, W + 2000, D + 2000, 0);
  paint(m, '#8fb069', undefined, 'grass');
  return m;
}

/** A table: a top with four legs fused to its underside. */
function buildTable(): Model {
  const m = box(0, 0, 700, 1200, 800, 750);
  m.edit(() => {
    for (const [x, y] of [[0, 0], [1100, 0], [0, 700], [1100, 700]]) {
      drawPolygon(m, [v(x, y, 700), v(x + 100, y, 700), v(x + 100, y + 100, 700), v(x, y + 100, 700)]);
      pushPull(m, planeFace(m, 2, 700, -1, 1).id, 700);
    }
    paintFaces(m, m.allFaces().map((f) => f.id), '#c19a6b', undefined, 'boards');
  });
  return m;
}

const place = (matrix: THREE.Matrix4, ...parts: THREE.Matrix4[]) => parts.reduce((m, p) => m.multiply(p), matrix.clone());
const move = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const turn = (angle: number) => new THREE.Matrix4().makeRotationZ(angle);
const mirrorX = () => new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Replaces the document with a small example house: walls with openings, windows, a door and furniture as
 * components, a roof, a porch, tags, saved views, dimensions, two levels and a sheet. Built through the same
 * kernel operations the tools use.
 */
export function loadExample(doc: Document): CameraData {
  doc.load({ nextId: 1, vertices: [], edges: [], faces: [], guides: [] }, EXAMPLE_NAME, null);

  const walls = buildWalls();
  paint(walls, '#b5654a', undefined, 'brick');

  doc.run('Example', () => {
    const ctx = doc.context.model;
    // addGroupFromModel already puts an instance in; replace it by a tagged one.
    const tagged = (model: Model, name: string, tag: string, kind: 'group' | 'component' = 'group') => {
      const id = doc.addGroupFromModel(model, name, kind);
      const definition = ctx.instance(id).definition;
      ctx.removeInstance(id);
      return { definition, add: (matrix: THREE.Matrix4) => ctx.addInstance(definition, matrix, tag) };
    };

    tagged(buildGround(), 'Garden', 'tag-site').add(new THREE.Matrix4());
    tagged(walls, 'Walls', 'tag-walls').add(new THREE.Matrix4());
    tagged(buildRoof(), 'Roof', 'tag-roof').add(new THREE.Matrix4());
    tagged(buildChimney(), 'Chimney', 'tag-roof').add(new THREE.Matrix4());
    tagged(buildPorch(), 'Porch', 'tag-site').add(new THREE.Matrix4());
    tagged(buildSteps(), 'Steps', 'tag-site').add(new THREE.Matrix4());

    const windowPart = tagged(buildWindow(1200, 1300), 'Window', 'tag-openings', 'component');
    const inset = 80;
    for (const [x, z] of WINDOWS.front) windowPart.add(move(x, inset, z));
    WINDOWS.back.forEach(([x, z], i) => windowPart.add(i === 1 ? place(move(x, D - inset, z), turn(Math.PI), mirrorX()) : place(move(x + 1200, D - inset, z), turn(Math.PI))));
    for (const [y, z] of WINDOWS.side) {
      windowPart.add(place(move(W - inset, y, z), turn(Math.PI / 2)));
      windowPart.add(place(move(inset, y + 1200, z), turn(-Math.PI / 2)));
    }
    tagged(buildDoor(), 'Front door', 'tag-openings', 'component').add(move(DOOR.x, 90, 0));

    const table = tagged(buildTable(), 'Table', 'tag-furniture', 'component');
    table.add(move(1200, 3200, FLOOR_T));
    table.add(place(move(W - 1200, 3200, FLOOR_T), mirrorX()));

    // The scale figure stands by the steps.
    const figure = doc.placeFigure(move(1900, -2200, 0));
    const figureDefinition = ctx.instance(figure).definition;
    ctx.removeInstance(figure);
    ctx.addInstance(figureDefinition, move(1900, -2200, 0), 'tag-site');
  });

  const camera = (position: [number, number, number], target: [number, number, number] = [W / 2, D / 2, 1500]): CameraData => ({ position, target, ortho: false, orthoHeight: 9000 });
  const overview = camera([-9500, -13500, 8500]);
  const scenes: Scene[] = [
    { id: 'scene-1', name: 'Overview', camera: overview },
    { id: 'scene-2', name: 'Roof off', camera: camera([-3000, -9000, 13000]), hidden: ['tag-roof'] },
    { id: 'scene-3', name: 'Garden side', camera: camera([14500, 16500, 6500]) },
  ];
  const settings: DrawingSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    levels: [
      { id: 'level-0', name: 'Ground floor', elevation: 0 },
      { id: 'level-1', name: 'Roof', elevation: WALL_H },
    ],
    shading: true,
    tags: [
      { id: 'tag-walls', name: 'Walls', visible: true },
      { id: 'tag-roof', name: 'Roof and chimney', visible: true },
      { id: 'tag-openings', name: 'Windows and door', visible: true },
      { id: 'tag-furniture', name: 'Furniture', visible: true },
      { id: 'tag-site', name: 'Garden and porch', visible: true },
    ],
    dimensions: [
      { id: 'd1', a: [0, 0, 0], b: [W, 0, 0], offset: [0, -2800, 0] },
      { id: 'd2', a: [W, 0, 0], b: [W, D, 0], offset: [1400, 0, 0] },
      { id: 'd3', a: [W, 0, 0], b: [W, 0, WALL_H], offset: [1400, 0, 0] },
      { id: 'd4', a: [DOOR.x, 0, 0], b: [DOOR.x + DOOR.w, 0, 0], offset: [0, -2600, 0] },
    ],
    scenes,
  };
  doc.updateDrawingSettings('Example', settings);

  // A sheet: plan, front elevation and a section at 1:100, and the overview.
  let sheet = { ...nextLayout([], 'A2'), name: 'Small house' };
  sheet = addViewport(doc, sheet, { kind: 'plan', level: 'level-0' }, 100);
  sheet = addViewport(doc, sheet, { kind: 'front' }, 100);
  sheet = addViewport(doc, sheet, { kind: 'section', section: 'A' }, 100);
  sheet = addSceneViewport(doc, sheet, scenes[0], 110, 0.62);
  sheet = { ...sheet, north: { x: 560, y: 40 } };
  doc.updateDrawingSettings('Example', { ...doc.drawingSettings, layouts: [sheet] });

  doc.history.clear();
  doc.markSaved(EXAMPLE_NAME, null);
  return overview;
}
