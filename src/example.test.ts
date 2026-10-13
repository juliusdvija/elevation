import { describe, expect, it } from 'vitest';
import { Document } from './document';
import { EXAMPLE_NAME, loadExample } from './example';
import { composeLayout } from './drawing/layout';
import { isClosed } from './kernel/close';
import { validateModel } from './kernel/validate';

describe('example model', () => {
  it('builds a house of closed parts on tags, with a sheet that draws', () => {
    const doc = new Document();
    loadExample(doc);
    expect(doc.name).toBe(EXAMPLE_NAME);
    expect(doc.dirty).toBe(false);
    for (const model of doc.allModels()) expect(validateModel(model)).toEqual([]);
    const names = [...doc.definitions.values()].map((d) => d.name).sort();
    expect(names).toEqual(expect.arrayContaining(['Walls', 'Roof', 'Window', 'Front door', 'Table', 'Chimney', 'Porch', 'Steps', 'Garden']));
    for (const part of doc.definitions.values()) if (!/figure/i.test(part.name)) expect(isClosed(part.model)).toBe(true);
    expect(doc.drawingSettings.tags).toHaveLength(5);
    // Windows: 2 front, 3 back, 2 side; one door; two tables.
    const count = (name: string) => {
      const def = [...doc.definitions.values()].find((d) => d.name === name)!;
      return doc.instanceCount(def.id);
    };
    expect(count('Window')).toBe(7);
    expect(count('Table')).toBe(2);

    const [layout] = doc.drawingSettings.layouts;
    expect(layout.viewports).toHaveLength(4);
    const { sheet, fits } = composeLayout(doc, layout);
    expect(fits).toBe(true);
    expect(sheet.primitives.length).toBeGreaterThan(200);
  });

  it('has the right size', () => {
    const doc = new Document();
    loadExample(doc);
    const box = doc.bounds();
    expect(box.max.z).toBeGreaterThan(5000); // the roof ridge
  });
});
