import { describe, expect, it } from 'vitest';
import { Document } from './document';
import { EXAMPLE_NAME, loadExample } from './example';
import { composeLayout } from './drawing/layout';
import { isClosed } from './kernel/close';
import { validateModel } from './kernel/validate';

describe('example model', () => {
  it('builds three closed parts on tags, with a sheet that draws', () => {
    const doc = new Document();
    loadExample(doc);
    expect(doc.name).toBe(EXAMPLE_NAME);
    expect(doc.dirty).toBe(false);
    for (const model of doc.allModels()) {
      expect(validateModel(model)).toEqual([]);
    }
    const parts = [...doc.definitions.values()];
    expect(parts.map((d) => d.name).sort()).toEqual(['Base', 'Lid', 'Window']);
    for (const part of parts) expect(isClosed(part.model)).toBe(true);
    expect(doc.drawingSettings.tags.map((t) => t.id)).toEqual(['tag-base', 'tag-lid']);
    expect(doc.placements().length).toBe(4); // the root and three parts

    const [layout] = doc.drawingSettings.layouts;
    expect(layout.viewports).toHaveLength(4);
    const { sheet, fits } = composeLayout(doc, layout);
    expect(fits).toBe(true);
    expect(sheet.primitives.length).toBeGreaterThan(50);
  });

  it('has a base of the right size', () => {
    const doc = new Document();
    loadExample(doc);
    const box = doc.bounds();
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(60);
    expect(box.max.y).toBeCloseTo(40);
    expect(box.max.z).toBeGreaterThan(30);
  });
});
