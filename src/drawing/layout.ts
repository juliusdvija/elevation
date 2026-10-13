import * as THREE from 'three';
import type { Document } from '../document';
import type { Model } from '../kernel/Model';
import { buildSheets } from './build';
import type { DrawingSettings, ViewRef } from './settings';
import { MINIMAL, PAPER_SIZES, type Primitive, type Sheet } from './sheet';

export type LayoutPaper = keyof typeof PAPER_SIZES;

/** A drawing placed on a layout page: which view, at what scale, and where (paper mm from the page's top left). */
export interface Viewport {
  id: string;
  view: ViewRef;
  /** Scale denominator: 100 means 1:100. */
  scale: number;
  x: number;
  y: number;
}

/** A page of several drawings, each with its own scale. Saved with the drawing settings. */
export interface Layout {
  id: string;
  name: string;
  paper: LayoutPaper;
  viewports: Viewport[];
}

/** Paper mm between the page edge and the frame, and between viewports when placing. */
const FRAME = 6;
const GAP = 3;
const STEP = 5; // grid the free-spot search walks
const PAGE_TITLE = 14; // paper mm at the bottom of the page for the page title

export interface ViewportSheet {
  viewport: Viewport;
  sheet: Sheet;
  empty: boolean;
  title: string;
}

function shift(primitive: Primitive, dx: number, dy: number): Primitive {
  if (primitive.type === 'text') return { ...primitive, x: primitive.x + dx, y: primitive.y + dy };
  return { ...primitive, lines: primitive.lines.map((line) => line.map((p) => new THREE.Vector2(p.x + dx, p.y + dy))) };
}

/** Each viewport's own sheet (its drawing with annotations, title and scale bar), at its scale. */
export function viewportSheets(doc: Document, layout: Layout, settings: DrawingSettings = doc.drawingSettings, flat: Model = doc.flatten()): ViewportSheet[] {
  return layout.viewports.map((viewport) => {
    const [built] = buildSheets(doc, [viewport.view], { scale: viewport.scale, paper: 'fit' }, flat, settings);
    return { viewport, sheet: built.sheet, empty: built.empty, title: built.setup.title };
  });
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * The first free spot (left to right, top to bottom) for a w x h viewport. When the page
 * has none, the first free spot below it: clear of the other drawings, and the page reports
 * that it does not fit.
 */
function freeSpot(placed: Rect[], w: number, h: number, paper: LayoutPaper): { x: number; y: number } {
  const [pw, ph] = PAPER_SIZES[paper];
  const bottom = Math.max(ph, ...placed.map((r) => r.y + r.h + GAP)) + h + STEP;
  for (let y = FRAME; y < bottom; y += STEP) {
    for (let x = FRAME; x + w <= pw - FRAME + 1e-6; x += STEP) {
      if (y + h > ph - FRAME - PAGE_TITLE + 1e-6 && y < ph) continue; // not partly on the page
      if (!placed.some((r) => overlaps({ x, y, w, h }, r))) return { x, y };
    }
  }
  return { x: FRAME, y: bottom };
}

/** Adds a view to a layout, in the first free place that fits it (below the page when nothing does). */
export function addViewport(doc: Document, layout: Layout, view: ViewRef, scale: number, settings: DrawingSettings = doc.drawingSettings): Layout {
  const flat = doc.flatten();
  const [built] = buildSheets(doc, [view], { scale, paper: 'fit' }, flat, settings);
  const placed = viewportSheets(doc, layout, settings, flat).map(({ viewport, sheet }) => ({ x: viewport.x, y: viewport.y, w: sheet.width, h: sheet.height }));
  const spot = freeSpot(placed, built.sheet.width, built.sheet.height, layout.paper);
  let n = layout.viewports.length + 1;
  const ids = new Set(layout.viewports.map((v) => v.id));
  while (ids.has(`vp-${n}`)) n++;
  return { ...layout, viewports: [...layout.viewports, { id: `vp-${n}`, view, scale, x: spot.x, y: spot.y }] };
}

/** Places every viewport again, in order, in the first free spots. */
export function tidyLayout(doc: Document, layout: Layout, settings: DrawingSettings = doc.drawingSettings): Layout {
  const sheets = viewportSheets(doc, layout, settings);
  const placed: Rect[] = [];
  const viewports = sheets.map(({ viewport, sheet }) => {
    const spot = freeSpot(placed, sheet.width, sheet.height, layout.paper);
    placed.push({ ...spot, w: sheet.width, h: sheet.height });
    return { ...viewport, ...spot };
  });
  return { ...layout, viewports };
}

/** The page: every viewport's drawing at its position, inside a frame, with the page title. */
export function composeLayout(doc: Document, layout: Layout, settings: DrawingSettings = doc.drawingSettings, flat: Model = doc.flatten()): { sheet: Sheet; fits: boolean } {
  const [width, height] = PAPER_SIZES[layout.paper];
  const style = MINIMAL;
  const primitives: Primitive[] = [];
  const corner = (x: number, y: number) => new THREE.Vector2(x, y);
  primitives.push({
    type: 'path',
    lines: [[corner(FRAME, FRAME), corner(width - FRAME, FRAME), corner(width - FRAME, height - FRAME), corner(FRAME, height - FRAME)]],
    closed: true,
    stroke: style.annotation.color,
    width: style.annotation.width,
  });

  let fits = true;
  for (const { viewport, sheet, empty } of viewportSheets(doc, layout, settings, flat)) {
    if (empty) continue;
    fits &&= viewport.x >= FRAME - 1e-6 && viewport.y >= FRAME - 1e-6 && viewport.x + sheet.width <= width - FRAME + 1e-6 && viewport.y + sheet.height <= height - FRAME - PAGE_TITLE + 1e-6;
    for (const p of sheet.primitives) primitives.push(shift(p, viewport.x, viewport.y));
  }

  const ty = height - FRAME - 5;
  primitives.push({ type: 'text', x: FRAME + 4, y: ty, text: layout.name.toUpperCase(), size: 3.6, bold: true, color: style.ink, letterSpacing: 0.3 });
  primitives.push({ type: 'text', x: width - FRAME - 4, y: ty, text: doc.name, size: 2.4, color: style.muted, anchor: 'end' });
  return { sheet: { width, height, background: style.paper, primitives, fits, font: style.font }, fits };
}

/** A new layout id and a default name ("Sheet 1", "Sheet 2", ...). */
export function nextLayout(layouts: readonly Layout[], paper: LayoutPaper = 'A3'): Layout {
  let n = layouts.length + 1;
  const ids = new Set(layouts.map((l) => l.id));
  while (ids.has(`sheet-${n}`)) n++;
  return { id: `sheet-${n}`, name: `Sheet ${n}`, paper, viewports: [] };
}
