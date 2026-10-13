import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from './document';
import { drawPolygon } from './kernel/draw';
import { pushPull } from './kernel/pushPull';
import { Model } from './kernel/Model';
import { DEFAULT_SETTINGS } from './drawing/settings';
import { buildSheets } from './drawing/build';
import { nextTag } from './ui/TagsPanel';
import { parse, serialize, toFile } from './io/format';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

/** A document with two groups: a big box on the ground, and a small box far away on its own tag. */
function twoGroups() {
  const doc = new Document();
  doc.reset();
  const m = doc.model;
  const box = (x: number, size: number) => {
    drawPolygon(m, [v(x, 0), v(x + size, 0), v(x + size, size), v(x, size)]);
    const ground = m.allFaces().find((f) => f.normal.z === -1 && m.position(f.outer[0]).x === x && f.id > 0 && m.faceVertices(f).some((id) => m.position(id).x === x + size))!;
    pushPull(m, ground.id, -size);
  };
  let a = 0;
  let b = 0;
  doc.run('Boxes', () => {
    box(5000, 1000);
    const near = m.allFaces().map((f) => f.id);
    a = doc.makeDefinition('group', near, m.allEdges().map((e) => e.id), []);
    box(20000, 2000);
    const rest = m.allFaces().filter((f) => m.faceVertices(f).every((id) => m.position(id).x >= 20000)).map((f) => f.id);
    const restEdges = m.allEdges().filter((e) => m.position(e.a).x >= 20000 && m.position(e.b).x >= 20000).map((e) => e.id);
    b = doc.makeDefinition('group', rest, restEdges, []);
  });
  return { doc, a, b };
}

describe('tags', () => {
  it('puts an instance on a tag and off again, as undoable edits that survive saving', () => {
    const { doc, a } = twoGroups();
    const m = doc.model;
    expect(m.instance(a).tag).toBeUndefined();
    const { edit } = m.edit(() => m.setInstanceTag(a, 'tag-1'));
    expect(m.instance(a).tag).toBe('tag-1');
    const copy = new Model();
    copy.load(m.toData());
    expect(copy.instance(a).tag).toBe('tag-1');
    edit.revert();
    expect(m.instance(a).tag).toBeUndefined();
    edit.apply();
    m.edit(() => m.setInstanceTag(a, undefined));
    expect(m.instance(a).tag).toBeUndefined();
    expect('tag' in m.instance(a)).toBe(false);
  });

  it('hides what is on a hidden tag everywhere: placements, bounds, and the flattened model the drawings use', () => {
    const { doc, a, b } = twoGroups();
    doc.updateDrawingSettings('Tags', { ...doc.drawingSettings, tags: [{ id: 'tag-1', name: 'Far box', visible: true }] });
    doc.model.edit(() => doc.model.setInstanceTag(b, 'tag-1'));
    const all = doc.bounds();
    const placements = doc.placements().length;
    expect(all.max.x).toBeGreaterThanOrEqual(22000);

    let changes = 0;
    doc.geometryChanged.on(() => changes++);
    doc.setHiddenTags(['tag-1']);
    expect(changes).toBeGreaterThan(0);
    expect(doc.placements().length).toBe(placements - 1);
    expect(doc.bounds().max.x).toBeLessThan(10000);
    expect(doc.flatten().bounds().max.x).toBeLessThan(10000);
    // Hiding is a view state: no undo step.
    expect(doc.history.undoLabel).not.toBe('Show Tag');

    // Drawings leave it out, too.
    const [{ sheet: hiddenSheet }] = buildSheets(doc, [{ kind: 'plan', level: 'level-0' }], { scale: 100 });
    doc.setHiddenTags([]);
    const [{ sheet: shownSheet }] = buildSheets(doc, [{ kind: 'plan', level: 'level-0' }], { scale: 100 });
    expect(shownSheet.width).toBeGreaterThan(hiddenSheet.width);
    void a;
  });

  it('keeps tags with the settings, and the tags a scene hides', () => {
    const { doc } = twoGroups();
    const tag = nextTag([]);
    expect(tag).toEqual({ id: 'tag-1', name: 'Tag 1', visible: true });
    expect(nextTag([tag]).id).toBe('tag-2');
    doc.updateDrawingSettings('Tags', {
      ...doc.drawingSettings,
      tags: [tag],
      scenes: [{ id: 'scene-1', name: 'Without', camera: { position: [1, 2, 3], target: [0, 0, 0], ortho: false, orthoHeight: 1000 }, hidden: ['tag-1'] }],
    });
    const file = parse(serialize(toFile(new Model().toData(), undefined, [], doc.drawingSettings)));
    expect(file.drawing?.tags).toEqual([tag]);
    expect(file.drawing?.scenes?.[0].hidden).toEqual(['tag-1']);
    // Files from before tags load with none.
    const old = new Document();
    const { tags: _omitted, ...beforeTags } = DEFAULT_SETTINGS;
    old.load(new Model().toData(), 'old', null, { drawing: beforeTags as never });
    expect(old.drawingSettings.tags).toEqual([]);
  });
});
