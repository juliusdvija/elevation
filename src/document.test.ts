import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from './document';
import { drawPolygon } from './kernel/draw';
import { pushPull } from './kernel/pushPull';
import { faceArea } from './kernel/faces';
import { validateModel } from './kernel/validate';
import { parse, serialize, toFile } from './io/format';
import { computeDrawing } from './drawing/project';
import { viewSetup } from './drawing/views';
import { DEFAULT_SETTINGS } from './drawing/settings';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];

/** A document with a 1 x 1 x 1 m box at x0. */
function withBox(doc: Document, x0 = 0) {
  const m = doc.context.model;
  doc.run('Box', () => {
    drawPolygon(m, rect(x0, 0, x0 + 1000, 1000));
    const ground = m.allFaces().find((f) => f.normal.z === -1 && m.position(f.outer[0]).x >= x0)!;
    pushPull(m, ground.id, -1000);
  });
}

const groupAll = (doc: Document, kind: 'group' | 'component' = 'group') =>
  doc.run('Make Group', () => {
    const m = doc.context.model;
    return doc.makeDefinition(kind, m.allFaces().map((f) => f.id), m.allEdges().map((e) => e.id), []);
  });

describe('groups', () => {
  it('moves geometry into a group and back on undo', () => {
    const doc = new Document();
    withBox(doc);
    const instance = groupAll(doc);
    expect(doc.model.faceCount).toBe(0);
    expect(doc.model.vertexCount).toBe(0);
    const def = doc.definition(doc.model.instance(instance).definition);
    expect(def.model.faceCount).toBe(6);
    expect(validateModel(def.model)).toEqual([]);

    doc.history.undo();
    expect(doc.model.faceCount).toBe(6);
    expect(doc.model.allInstances()).toHaveLength(0);
    doc.history.redo();
    expect(doc.model.faceCount).toBe(0);
    expect(doc.model.allInstances()).toHaveLength(1);
  });

  it('keeps grouped geometry from sticking to new geometry', () => {
    const doc = new Document();
    withBox(doc);
    groupAll(doc);
    // A box drawn right against the group stays separate.
    withBox(doc, 1000);
    expect(doc.model.faceCount).toBe(6);
    const def = [...doc.definitions.values()][0];
    expect(def.model.faceCount).toBe(6);
  });

  it('edits inside a group with undo, and explodes back into loose geometry', () => {
    const doc = new Document();
    withBox(doc);
    const instance = groupAll(doc);
    doc.enter(instance);
    const inner = doc.context.model;
    const top = inner.allFaces().find((f) => f.normal.z === 1)!;
    doc.run('Push/Pull', () => pushPull(inner, top.id, 500));
    expect(Math.round(faceArea(inner, inner.allFaces().find((f) => f.normal.x === 1)!))).toBe(1_500_000);
    doc.history.undo();
    expect(Math.round(faceArea(inner, inner.allFaces().find((f) => f.normal.x === 1)!))).toBe(1_000_000);
    doc.history.redo();
    doc.exit();

    doc.run('Explode', () => doc.explode(instance));
    expect(doc.model.allInstances()).toHaveLength(0);
    expect(doc.model.faceCount).toBe(6);
    expect(doc.bounds().max.z).toBe(1500);
  });

  it('places instances with their transform', () => {
    const doc = new Document();
    withBox(doc);
    const instance = groupAll(doc);
    doc.run('Move', () => doc.model.setInstanceMatrix(instance, new THREE.Matrix4().makeTranslation(5000, 0, 0)));
    expect(doc.bounds().min.x).toBe(5000);
    expect(doc.flatten().faceCount).toBe(6);
  });
});

describe('components', () => {
  it('shares edits between copies of a component', () => {
    const doc = new Document();
    withBox(doc);
    const first = groupAll(doc, 'component');
    const defId = doc.model.instance(first).definition;
    const second = doc.run('Copy', () => doc.model.addInstance(defId, new THREE.Matrix4().makeTranslation(3000, 0, 0)));
    doc.enter(second);
    const inner = doc.context.model;
    doc.run('Push/Pull', () => pushPull(inner, inner.allFaces().find((f) => f.normal.z === 1)!.id, 1000));
    doc.exit();
    // Both copies are now 2 m tall.
    expect(doc.flatten().bounds().max.z).toBe(2000);
    expect(doc.model.instance(first).definition).toBe(doc.model.instance(second).definition);
  });

  it('makes a copied group unique when it is edited', () => {
    const doc = new Document();
    withBox(doc);
    const first = groupAll(doc, 'group');
    const defId = doc.model.instance(first).definition;
    const second = doc.run('Copy', () => doc.model.addInstance(defId, new THREE.Matrix4().makeTranslation(3000, 0, 0)));
    doc.enter(second);
    const inner = doc.context.model;
    doc.run('Push/Pull', () => pushPull(inner, inner.allFaces().find((f) => f.normal.z === 1)!.id, 1000));
    doc.exit();
    expect(doc.model.instance(first).definition).not.toBe(doc.model.instance(second).definition);
    expect(doc.definition(doc.model.instance(first).definition).model.bounds().max.z).toBe(1000);
  });
});

describe('saving groups', () => {
  it('round-trips definitions and instances', () => {
    const doc = new Document();
    withBox(doc);
    const instance = groupAll(doc, 'component');
    doc.run('Move', () => doc.model.setInstanceMatrix(instance, new THREE.Matrix4().makeTranslation(0, 2000, 0)));
    const text = serialize(toFile(doc.model.toData(), undefined, doc.definitionsInUse()));

    const copy = new Document();
    const file = parse(text);
    copy.load(file.model, 'copy', null, { definitions: file.definitions });
    expect(copy.bounds().min.y).toBe(2000);
    expect(copy.flatten().faceCount).toBe(6);
    expect([...copy.definitions.values()][0].kind).toBe('component');
  });

  it('draws grouped geometry in plans', () => {
    const doc = new Document();
    withBox(doc);
    groupAll(doc);
    const flat = doc.flatten();
    const drawing = computeDrawing(flat, viewSetup({ kind: 'plan', level: 'level-0' }, { ...DEFAULT_SETTINGS, cutHeight: 500 }, flat.bounds()));
    expect(drawing.cutLoops).toHaveLength(1);
  });
});

describe('scale figure', () => {
  it('is one shared component placed in the current context', () => {
    const doc = new Document();
    const a = doc.run('Figure', () => doc.placeFigure(new THREE.Matrix4().makeTranslation(1000, 0, 0)));
    const b = doc.run('Figure', () => doc.placeFigure(new THREE.Matrix4().makeTranslation(3000, 0, 0)));
    expect(doc.model.instance(a).definition).toBe(doc.model.instance(b).definition);
    expect(doc.definitions.size).toBe(1);
    const bounds = doc.flatten().bounds();
    expect(bounds.max.z).toBeCloseTo(1785);
    expect(bounds.min.x).toBeLessThan(1000);
    expect(bounds.max.x).toBeGreaterThan(3000);
    doc.history.undo();
    expect(doc.model.allInstances().length).toBe(1);
  });

  it('turns to face the camera, in 3D and in each elevation, without changing the file', () => {
    const doc = new Document();
    doc.reset();
    expect(doc.dirty).toBe(false);
    expect(doc.history.canUndo).toBe(false);
    const width = (m: THREE.Box3) => ({ x: m.max.x - m.min.x, y: m.max.y - m.min.y });
    doc.setViewer(new THREE.Vector3(0, -10000, 1500));
    expect(width(doc.bounds()).x).toBeGreaterThan(300);
    expect(width(doc.bounds()).y).toBeLessThan(1);
    expect(doc.setViewer(new THREE.Vector3(10000, 0, 1500))).toBe(true);
    expect(width(doc.bounds()).y).toBeGreaterThan(300);
    expect(width(doc.bounds()).x).toBeLessThan(1);
    expect(doc.dirty).toBe(false);
    const right = doc.flatten(new THREE.Vector3(1e6, 0, 0)).bounds();
    expect(right.max.y - right.min.y).toBeGreaterThan(300);
    expect(parse(serialize(toFile(doc.model.toData(), undefined, doc.definitionsInUse()))).definitions?.[0].faceMe).toBe(true);
  });
});
