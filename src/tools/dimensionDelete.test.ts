import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../document';
import { createEraserTool } from './EraserTool';
import { createSelectTool } from './SelectTool';
import { Selection } from './Selection';
import { deleteDimensions, dimensionAt } from './dimensionPick';
import type { ToolContext } from './Tool';

/** A document with three dimensions along y = 0, 3000 and 6000, each 10 m long and drawn offset 2 m below. */
function withDimensions() {
  const doc = new Document();
  const next = structuredClone(doc.drawingSettings);
  next.dimensions = [0, 3000, 6000].map((y, i) => ({ id: `d${i + 1}`, a: [0, y, 0], b: [10000, y, 0], offset: [0, -2000, 0] }));
  doc.updateDrawingSettings('Dimensions', next);
  return doc;
}

/** A top-down view at 1 px per 10 mm; `highlight` records what the tools ask the viewport to draw highlighted. */
function fakeContext(doc: Document) {
  const highlights: { selected: string[]; hover: string | null }[] = [];
  const selection = new Selection();
  const ctx = {
    doc,
    selection,
    viewport: {
      container: { append() {} },
      toScreen: (p: THREE.Vector3) => new THREE.Vector2(p.x / 10, -p.y / 10),
      setDimensionHighlight: (selected: Iterable<string>, hover: string | null) => highlights.push({ selected: [...selected], hover }),
    },
    renderer: { setHover() {} },
    picker: { pick: () => ({ kind: 'none' }), childInstance: () => undefined, isContext: () => false },
  } as unknown as ToolContext;
  return { ctx, selection, highlights };
}

const ids = (doc: Document) => doc.drawingSettings.dimensions.map((d) => d.id);
/** Screen position of a point on dimension `n` (1 to 3), `t` of the way along it. */
const on = (n: number, t = 0.5) => ({ clientX: 10000 * t * 0.1, clientY: -((n - 1) * 3000 - 2000) * 0.1 });
const pointer = (at: { clientX: number; clientY: number }, extra: object = {}) => ({ ...at, shiftKey: false, buttons: 0, ...extra }) as unknown as PointerEvent;
const key = (name: string) => ({ key: name }) as KeyboardEvent;

describe('deleting dimensions', () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  beforeEach(() => {
    // The Select tool makes a selection box element; a stand-in is enough here.
    (globalThis as { document?: unknown }).document = { createElement: () => ({ hidden: true, dataset: {}, style: {}, className: '' }) };
  });
  afterEach(() => {
    (globalThis as { document?: unknown }).document = realDocument;
  });

  it('finds the dimension under the cursor by its line or its label, and none away from them', () => {
    const { ctx } = fakeContext(withDimensions());
    expect(dimensionAt(ctx, ...Object.values(on(1)) as [number, number])).toBe('d1');
    expect(dimensionAt(ctx, on(2, 0.2).clientX, on(2, 0.2).clientY)).toBe('d2');
    expect(dimensionAt(ctx, on(3, 0.9).clientX, on(3, 0.9).clientY + 5)).toBe('d3'); // 5 px off the line still counts
    expect(dimensionAt(ctx, on(1).clientX, on(1).clientY + 60)).toBeNull(); // between dimensions
    expect(dimensionAt(ctx, -500, -500)).toBeNull();
  });

  it('deletes dimensions as one undo step, and undo brings them back in place', () => {
    const doc = withDimensions();
    const { ctx } = fakeContext(doc);
    deleteDimensions(ctx, ['d1', 'd3']);
    expect(ids(doc)).toEqual(['d2']);
    doc.history.undo();
    expect(ids(doc)).toEqual(['d1', 'd2', 'd3']);
    doc.history.redo();
    expect(ids(doc)).toEqual(['d2']);
    deleteDimensions(ctx, []);
    expect(ids(doc)).toEqual(['d2']);
  });

  it('Select tool: click selects a dimension, shift adds another, Delete removes both, undo restores', () => {
    const doc = withDimensions();
    const { ctx, selection } = fakeContext(doc);
    const tool = createSelectTool(ctx);
    tool.pointerDown!(pointer(on(1)));
    tool.pointerUp!(pointer(on(1)));
    expect([...selection.dimensions]).toEqual(['d1']);
    tool.pointerDown!(pointer(on(3), { shiftKey: true }));
    tool.pointerUp!(pointer(on(3), { shiftKey: true }));
    expect([...selection.dimensions].sort()).toEqual(['d1', 'd3']);
    expect(tool.keyDown!(key('Delete'))).toBe(true);
    expect(ids(doc)).toEqual(['d2']);
    expect(selection.empty).toBe(true);
    doc.history.undo();
    expect(ids(doc)).toEqual(['d1', 'd2', 'd3']);
  });

  it('Select tool: a click away from dimensions clears the selection, and Backspace deletes too', () => {
    const doc = withDimensions();
    const { ctx, selection } = fakeContext(doc);
    const tool = createSelectTool(ctx);
    tool.pointerDown!(pointer(on(2)));
    tool.pointerUp!(pointer(on(2)));
    expect([...selection.dimensions]).toEqual(['d2']);
    tool.pointerDown!(pointer({ clientX: on(2).clientX, clientY: on(2).clientY + 80 }));
    tool.pointerUp!(pointer({ clientX: on(2).clientX, clientY: on(2).clientY + 80 }));
    expect(selection.empty).toBe(true);
    tool.pointerDown!(pointer(on(2)));
    tool.pointerUp!(pointer(on(2)));
    expect(tool.keyDown!(key('Backspace'))).toBe(true);
    expect(ids(doc)).toEqual(['d1', 'd3']);
  });

  it('Select tool: hovering a dimension asks for it to be highlighted', () => {
    const { ctx, highlights } = fakeContext(withDimensions());
    const tool = createSelectTool(ctx);
    tool.pointerMove!(pointer(on(2)));
    expect(highlights.at(-1)).toEqual({ selected: [], hover: 'd2' });
    tool.pointerMove!(pointer({ clientX: -500, clientY: -500 }));
    expect(highlights.at(-1)?.hover).toBeNull();
  });

  it('Eraser: a click erases one dimension, a drag erases every dimension it crosses, as one step', () => {
    const doc = withDimensions();
    const { ctx } = fakeContext(doc);
    const tool = createEraserTool(ctx);
    tool.pointerDown!(pointer(on(2)));
    tool.pointerUp!(pointer(on(2)));
    expect(ids(doc)).toEqual(['d1', 'd3']);
    doc.history.undo();
    expect(ids(doc)).toEqual(['d1', 'd2', 'd3']);
    tool.pointerDown!(pointer(on(1, 0.3), { buttons: 1 }));
    tool.pointerMove!(pointer(on(2, 0.3), { buttons: 1 }));
    tool.pointerMove!(pointer(on(3, 0.3), { buttons: 1 }));
    tool.pointerUp!(pointer(on(3, 0.3)));
    expect(ids(doc)).toEqual([]);
    doc.history.undo();
    expect(ids(doc)).toEqual(['d1', 'd2', 'd3']);
  });

  it('Eraser: Escape-style cancel leaves the dimensions alone', () => {
    const doc = withDimensions();
    const { ctx } = fakeContext(doc);
    const tool = createEraserTool(ctx);
    tool.pointerDown!(pointer(on(1), { buttons: 1 }));
    tool.cancel!();
    tool.pointerUp!(pointer(on(1)));
    expect(ids(doc)).toEqual(['d1', 'd2', 'd3']);
  });
});
