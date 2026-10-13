import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../document';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { addViewport, composeLayout, nextLayout, tidyLayout, viewportSheets, type Layout } from './layout';
import { sheetsToPdf } from './pdf';
import { DEFAULT_SETTINGS } from './settings';
import { sheetToSvg } from './svg';
import { PAPER_SIZES } from './sheet';
import { parse, serialize, toFile, FORMAT_VERSION } from '../io/format';
import { Model } from '../kernel/Model';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function house(): Document {
  const doc = new Document();
  const m = doc.model;
  doc.run('Box', () => {
    drawPolygon(m, [v(0, 0), v(8000, 0), v(8000, 6000), v(0, 6000)]);
    pushPull(m, m.allFaces()[0].id, -6000);
  });
  return doc;
}

const rects = (doc: Document, layout: Layout) => viewportSheets(doc, layout).map(({ viewport, sheet }) => ({ x: viewport.x, y: viewport.y, w: sheet.width, h: sheet.height }));
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layouts', () => {
  it('places each added view in a free spot, none overlapping', () => {
    const doc = house();
    let layout = nextLayout([], 'A2');
    for (const view of [{ kind: 'plan' as const, level: 'level-0' }, { kind: 'front' as const }, { kind: 'right' as const }, { kind: 'section' as const, section: 'A' }]) {
      layout = addViewport(doc, layout, view, 100);
    }
    expect(layout.viewports).toHaveLength(4);
    const r = rects(doc, layout);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(overlap(r[i], r[j])).toBe(false);
    expect(composeLayout(doc, layout).fits).toBe(true);
  });

  it('draws every viewport at its own scale on one page of the chosen paper', () => {
    const doc = house();
    let layout = nextLayout([], 'A3');
    layout = addViewport(doc, layout, { kind: 'plan', level: 'level-0' }, 100);
    layout = addViewport(doc, layout, { kind: 'front' }, 200);
    const { sheet } = composeLayout(doc, layout);
    expect([sheet.width, sheet.height]).toEqual(PAPER_SIZES.A3);
    const texts = sheet.primitives.flatMap((p) => (p.type === 'text' ? [p.text] : []));
    expect(texts.some((t) => t.includes('1:100'))).toBe(true);
    expect(texts.some((t) => t.includes('1:200'))).toBe(true);
    expect(texts).toContain('SHEET 1');
    const svg = sheetToSvg(sheet);
    expect(svg).toContain('<svg');
    expect(new TextDecoder().decode(sheetsToPdf([sheet]).slice(0, 5))).toBe('%PDF-');
  });

  it('moves a drawing with its viewport', () => {
    const doc = house();
    let layout = addViewport(doc, nextLayout([], 'A2'), { kind: 'front' }, 100);
    const at = (l: Layout) => {
      const { sheet } = composeLayout(doc, l);
      // Everything after the page frame belongs to the viewport (or the page title, which stays put).
      const xs = sheet.primitives.slice(1).flatMap((p) => (p.type === 'path' ? p.lines.flat().map((q) => q.x) : []));
      return Math.min(...xs);
    };
    const before = at(layout);
    layout = { ...layout, viewports: layout.viewports.map((vp) => ({ ...vp, x: vp.x + 100 })) };
    expect(at(layout)).toBeCloseTo(before + 100, 3);
  });

  it('reports a page that is too small, and tidies viewports back into place', () => {
    const doc = house();
    let layout = addViewport(doc, nextLayout([], 'A4'), { kind: 'front' }, 20);
    expect(composeLayout(doc, layout).fits).toBe(false);
    layout = addViewport(doc, nextLayout([], 'A1'), { kind: 'front' }, 100);
    layout = addViewport(doc, layout, { kind: 'right' }, 100);
    const stacked = { ...layout, viewports: layout.viewports.map((vp) => ({ ...vp, x: 10, y: 10 })) };
    const tidy = tidyLayout(doc, stacked);
    const r = rects(doc, tidy);
    expect(overlap(r[0], r[1])).toBe(false);
  });

  it('puts a drawing that does not fit below the page, clear of the others', () => {
    const doc = house();
    let layout = addViewport(doc, nextLayout([], 'A4'), { kind: 'front' }, 100);
    layout = addViewport(doc, layout, { kind: 'right' }, 100);
    layout = addViewport(doc, layout, { kind: 'plan', level: 'level-0' }, 100);
    const r = rects(doc, layout);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) expect(overlap(r[i], r[j])).toBe(false);
    expect(composeLayout(doc, layout).fits).toBe(false);
  });

  it('draws notes (several lines) and a north arrow on the page', () => {
    const doc = house();
    const layout: Layout = { ...nextLayout([], 'A3'), texts: [{ id: 't1', x: 20, y: 30, text: 'House Smit\nConcept 2', size: 6 }], north: { x: 400, y: 30 } };
    const { sheet, rects } = composeLayout(doc, layout);
    const texts = sheet.primitives.flatMap((p) => (p.type === 'text' ? [p] : []));
    const lines = texts.filter((t) => t.text === 'House Smit' || t.text === 'Concept 2');
    expect(lines).toHaveLength(2);
    expect(lines[1].y).toBeGreaterThan(lines[0].y);
    expect(texts.some((t) => t.text === 'N' && t.x === 400)).toBe(true);
    expect(rects.map((r) => r.kind)).toEqual(['text', 'north']);
  });

  it('reports where each viewport sits on the page', () => {
    const doc = house();
    const layout = addViewport(doc, nextLayout([], 'A3'), { kind: 'front' }, 100);
    const [rect] = composeLayout(doc, layout).rects;
    expect(rect).toMatchObject({ id: layout.viewports[0].id, x: layout.viewports[0].x, y: layout.viewports[0].y });
    expect(rect.w).toBeGreaterThan(0);
  });

  it('is saved and loaded with the drawing settings', () => {
    const doc = house();
    const layout = addViewport(doc, nextLayout([], 'A3'), { kind: 'front' }, 100);
    doc.updateDrawingSettings('Layout', { ...doc.drawingSettings, layouts: [layout] });
    const m = new Model();
    const file = parse(serialize(toFile(m.toData(), undefined, [], doc.drawingSettings)));
    expect(file.version).toBe(FORMAT_VERSION);
    expect(file.drawing?.layouts).toEqual([layout]);
    // Files from before layouts existed load with none.
    const old = new Document();
    const { layouts: _omitted, ...beforeLayouts } = DEFAULT_SETTINGS;
    old.load(m.toData(), 'old', null, { drawing: beforeLayouts as never });
    expect(old.drawingSettings.layouts).toEqual([]);
  });
});
