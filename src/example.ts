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
import { circlePoints, roundedRectangle } from './kernel/shapes';

export const EXAMPLE_NAME = 'Example - pill box';

const W = 60;
const D = 40;
const HEIGHT = 20;
const WALL = 3;
const LID = 4;
const LID_GAP = 8; // how far the lid floats above the base in the drawings

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];
const UP = v(0, 0, 1);

/** The face without holes pointing up at height `z`, the smallest one over `min` (the one just drawn, not the ring around it). */
function upFace(m: Model, z: number, min = 0): Face {
  const faces = m.allFaces().filter((f) => f.holes.length === 0 && f.normal.z > 0.999 && Math.abs(m.position(f.outer[0]).z - z) < 1e-6 && faceArea(m, f) > min);
  faces.sort((a, b) => faceArea(m, a) - faceArea(m, b));
  if (faces.length === 0) throw new Error('Example face not found');
  return faces[0];
}

/** Pulls the one face just drawn in the ground plane up by `height`, whichever way it faces. */
function raise(m: Model, height: number): void {
  const face = m.allFaces()[0];
  pushPull(m, face.id, face.normal.z > 0 ? height : -height);
}

const posts: [number, number][] = [[9, 9], [W - 9, 9], [9, D - 9], [W - 9, D - 9]];

/** The base: a rounded tray with a floor, four screw posts, and a thin wall. */
function buildBase(): Model {
  const m = new Model();
  m.edit(() => {
    drawPolygon(m, roundedRectangle(rect(0, 0, W, D, 0), 5));
    raise(m, HEIGHT);
    drawPolygon(m, roundedRectangle(rect(WALL, WALL, W - WALL, D - WALL, HEIGHT), 2));
    pushPull(m, upFace(m, HEIGHT, 1).id, -(HEIGHT - WALL));
    for (const [x, y] of posts) {
      drawPolygon(m, circlePoints(v(x, y, WALL), UP, 3, 16));
      pushPull(m, upFace(m, WALL, 1).id, 14);
    }
  });
  return m;
}

/** The lid: a rounded plate with four screw holes and a window. */
function buildLid(): Model {
  const m = new Model();
  m.edit(() => {
    drawPolygon(m, roundedRectangle(rect(0, 0, W, D, 0), 5));
    raise(m, LID);
    for (const [x, y] of posts) {
      drawPolygon(m, circlePoints(v(x, y, LID), UP, 1.2, 12));
      pushPull(m, upFace(m, LID, 1).id, -LID);
    }
    drawPolygon(m, roundedRectangle(rect(12, 12, W - 12, D - 12, LID), 2));
    pushPull(m, upFace(m, LID, 1).id, -LID);
  });
  return m;
}

/** The window pane: a thin glass plate that sits in the lid's opening. */
function buildGlass(): Model {
  const m = new Model();
  m.edit(() => {
    drawPolygon(m, roundedRectangle(rect(12, 12, W - 12, D - 12, 0), 2));
    raise(m, 1);
    paintFaces(m, m.allFaces().map((f) => f.id), '#9ec5e8', 0.35);
  });
  return m;
}

function paintAll(m: Model, color: string): void {
  m.edit(() => paintFaces(m, m.allFaces().map((f) => f.id), color));
}

/**
 * Replaces the document with a small example: a pill box in three parts, with tags, saved views,
 * dimensions and a sheet at 2:1. Built through the same kernel operations the tools use.
 */
export function loadExample(doc: Document): CameraData {
  doc.load({ nextId: 1, vertices: [], edges: [], faces: [], guides: [] }, EXAMPLE_NAME, null);

  const base = buildBase();
  paintAll(base, '#d9d3c5');
  const lid = buildLid();
  paintAll(lid, '#33404f');
  const glass = buildGlass();

  doc.run('Example', () => {
    const place = (model: Model, name: string, z: number, tag: string) => {
      const id = doc.addGroupFromModel(model, name);
      const ctx = doc.context.model;
      const definition = ctx.instance(id).definition;
      ctx.removeInstance(id);
      ctx.addInstance(definition, new THREE.Matrix4().makeTranslation(0, 0, z), tag);
    };
    place(base, 'Base', 0, 'tag-base');
    place(lid, 'Lid', HEIGHT + LID_GAP, 'tag-lid');
    place(glass, 'Window', HEIGHT + LID_GAP + 1.5, 'tag-lid');
  });

  const camera = (position: [number, number, number], ortho = false): CameraData => ({ position, target: [W / 2, D / 2, 16], ortho, orthoHeight: 90 });
  const scenes: Scene[] = [
    { id: 'scene-1', name: 'Exploded', camera: camera([W / 2 + 85, D / 2 - 110, 85]) },
    { id: 'scene-2', name: 'Base only', camera: camera([W / 2 + 70, D / 2 - 85, 70]), hidden: ['tag-lid'] },
  ];
  const settings: DrawingSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    cutHeight: 10,
    shading: false,
    tags: [
      { id: 'tag-base', name: 'Base', visible: true },
      { id: 'tag-lid', name: 'Lid and window', visible: true },
    ],
    dimensions: [
      { id: 'd1', a: [0, 0, 0], b: [W, 0, 0], offset: [0, -9, 0] },
      { id: 'd2', a: [W, 0, 0], b: [W, D, 0], offset: [9, 0, 0] },
      { id: 'd3', a: [W, 0, 0], b: [W, 0, HEIGHT], offset: [9, 0, 0] },
    ],
    scenes,
  };
  doc.updateDrawingSettings('Example', settings);

  // A sheet: plan, front elevation and a section at 2:1, and the exploded view.
  let sheet = { ...nextLayout([], 'A3'), name: 'Pill box' };
  sheet = addViewport(doc, sheet, { kind: 'plan', level: 'level-0' }, 0.5);
  sheet = addViewport(doc, sheet, { kind: 'front' }, 0.5);
  sheet = addViewport(doc, sheet, { kind: 'section', section: 'A' }, 0.5);
  sheet = addSceneViewport(doc, sheet, scenes[0], 90, 0.6);
  doc.updateDrawingSettings('Example', { ...doc.drawingSettings, layouts: [sheet] });

  doc.history.clear();
  doc.markSaved(EXAMPLE_NAME, null);
  return camera([W / 2 + 85, D / 2 - 110, 85]);
}
