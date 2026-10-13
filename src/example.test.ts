import { describe, expect, it } from 'vitest';
import { Document } from './document';
import { EXAMPLE_NAME, loadExample } from './example';
import { composeLayout } from './drawing/layout';
import { isClosed } from './kernel/close';
import { validateModel } from './kernel/validate';

describe('example model', () => {
  it('builds the villa from closed parts on tags, with a sheet that draws', () => {
    const doc = new Document();
    loadExample(doc);
    expect(doc.name).toBe(EXAMPLE_NAME);
    expect(doc.dirty).toBe(false);
    for (const model of doc.allModels()) expect(validateModel(model)).toEqual([]);
    const names = [...doc.definitions.values()].map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['Walls', 'Roof', 'Glass panel', 'Window', 'Front door', 'Lawn and pool', 'Water', 'Terrace', 'Tree']));
    for (const part of doc.definitions.values()) if (!/figure/i.test(part.name)) expect(isClosed(part.model)).toBe(true);
    expect(doc.drawingSettings.tags).toHaveLength(6);
    const count = (name: string) => doc.instanceCount([...doc.definitions.values()].find((d) => d.name === name)!.id);
    expect(count('Glass panel')).toBe(4);
    expect(count('Window')).toBe(3);
    expect(count('Tree')).toBe(3);

    const [layout] = doc.drawingSettings.layouts;
    expect(layout.viewports).toHaveLength(5);
    const { sheet, fits } = composeLayout(doc, layout);
    expect(fits).toBe(true);
    expect(sheet.primitives.length).toBeGreaterThan(200);
  });

  it('has a pool sunk into the lawn and a roof above the walls', () => {
    const doc = new Document();
    loadExample(doc);
    const box = doc.bounds();
    expect(box.max.z).toBeGreaterThan(3200);
    expect(box.min.z).toBeLessThan(-1500);
  });
});
