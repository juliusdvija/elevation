import * as THREE from 'three';
import type { Document } from '../document';
import type { Model } from '../kernel/Model';
import { buildSheets } from './build';
import type { DrawingSettings, Scene, ViewRef } from './settings';
import { MINIMAL, PAPER_SIZES, textWidth, type Primitive, type Sheet } from './sheet';

export type LayoutPaper = keyof typeof PAPER_SIZES;

/** A drawing placed on a layout page: which view, at what scale, and where (paper mm from the page's top left). */
export interface DrawingViewport {
  id: string;
  view: ViewRef;
  /** Scale denominator: 100 means 1:100. */
  scale: number;
  x: number;
  y: number;
}

/** A rendered 3D view placed on a page: which saved scene, how wide on paper (mm), and the picture's height / width. */
export interface SceneViewport {
  id: string;
  scene: string;
  width: number;
  ratio: number;
  x: number;
  y: number;
}

export type Viewport = DrawingViewport | SceneViewport;

export const isScene = (viewport: Viewport): viewport is SceneViewport => 'scene' in viewport;

/** A rendered picture to place on a page. */
export interface RenderedImage {
  href: string;
  pixels: [number, number];
}

/** Renders a scene for a page; null when pictures are not available (tests, no WebGL). */
export type ImageProvider = (scene: Scene, widthMm: number, heightMm: number) => RenderedImage | null;

/** A note on the page: text (lines split by \n) at a paper position, `size` in paper mm. */
export interface LayoutText {
  id: string;
  x: number;
  y: number;
  text: string;
  size: number;
}

/** A page of several drawings, each with its own scale. Saved with the drawing settings. */
export interface Layout {
  id: string;
  name: string;
  paper: LayoutPaper;
  viewports: Viewport[];
  /** Notes and titles on the page (absent in files from before they existed). */
  texts?: LayoutText[];
  /** A north arrow at this paper position (the model's +Y is north). */
  north?: { x: number; y: number };
}

/** Paper mm between the page edge and the frame, and between viewports when placing. */
const FRAME = 6;
const GAP = 3;
const STEP = 5; // grid the free-spot search walks
const PAGE_TITLE = 14; // paper mm at the bottom of the page for the page title

/** Something on the page that can be picked and dragged, with its box in paper mm. */
export interface PageItem extends Rect {
  kind: 'viewport' | 'text' | 'north';
  id: string;
}

export interface ViewportSheet {
  viewport: Viewport;
  sheet: Sheet;
  empty: boolean;
  title: string;
}

function shift(primitive: Primitive, dx: number, dy: number): Primitive {
  if (primitive.type === 'text' || primitive.type === 'image') return { ...primitive, x: primitive.x + dx, y: primitive.y + dy };
  return { ...primitive, lines: primitive.lines.map((line) => line.map((p) => new THREE.Vector2(p.x + dx, p.y + dy))) };
}

/** Each viewport's own sheet (its drawing with annotations, title and scale bar), at its scale. */
export function viewportSheets(
  doc: Document,
  layout: Layout,
  settings: DrawingSettings = doc.drawingSettings,
  flat: Model = doc.flatten(),
  images?: ImageProvider,
): ViewportSheet[] {
  return layout.viewports.map((viewport) => {
    if (isScene(viewport)) return sceneSheet(viewport, settings.scenes.find((s) => s.id === viewport.scene), images);
    const [built] = buildSheets(doc, [viewport.view], { scale: viewport.scale, paper: 'fit' }, flat, settings);
    return { viewport, sheet: built.sheet, empty: built.empty, title: built.setup.title };
  });
}

const VIEW_MARGIN = 12; // paper mm around a viewport's content, as in a drawing's own sheet
const VIEW_TITLE = 16; // paper mm below it for the caption

/** A scene's sheet: its picture in the same frame as a drawing, with the scene's name as the caption. */
function sceneSheet(viewport: SceneViewport, scene: Scene | undefined, images: ImageProvider | undefined): ViewportSheet {
  const style = MINIMAL;
  const w = viewport.width;
  const h = viewport.width * viewport.ratio;
  const primitives: Primitive[] = [];
  const image = scene && images ? images(scene, w, h) : null;
  if (image) {
    primitives.push({ type: 'image', x: VIEW_MARGIN, y: VIEW_MARGIN, w, h, href: image.href, pixels: image.pixels });
  } else {
    // No picture available: a placeholder box where it will go.
    const corner = (x: number, y: number) => new THREE.Vector2(VIEW_MARGIN + x, VIEW_MARGIN + y);
    primitives.push({ type: 'path', lines: [[corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)]], closed: true, stroke: style.annotation.color, width: style.annotation.width, dash: [2, 1.2] });
    primitives.push({ type: 'text', x: VIEW_MARGIN + w / 2, y: VIEW_MARGIN + h / 2, text: scene ? '3D view' : 'Scene missing', size: 3, color: style.muted, anchor: 'middle' });
  }
  const title = scene?.name ?? 'Scene';
  const ty = VIEW_MARGIN + h + 9;
  primitives.push({ type: 'text', x: VIEW_MARGIN, y: ty, text: title.toUpperCase(), size: 3.2, bold: true, color: style.ink, letterSpacing: 0.3 });
  primitives.push({ type: 'text', x: VIEW_MARGIN, y: ty + 4.6, text: '3D view', size: 2.2, color: style.muted });
  return { viewport, sheet: { width: w + VIEW_MARGIN * 2, height: h + VIEW_MARGIN * 2 + VIEW_TITLE, background: style.paper, primitives, fits: true, font: style.font }, empty: false, title };
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

/** Adds a rendered 3D view of a scene to a layout, `width` mm wide with the picture's `ratio` (height / width). */
export function addSceneViewport(doc: Document, layout: Layout, scene: Scene, width: number, ratio: number, settings: DrawingSettings = doc.drawingSettings): Layout {
  const placed = viewportSheets(doc, layout, settings).map(({ viewport, sheet }) => ({ x: viewport.x, y: viewport.y, w: sheet.width, h: sheet.height }));
  const spot = freeSpot(placed, width + VIEW_MARGIN * 2, width * ratio + VIEW_MARGIN * 2 + VIEW_TITLE, layout.paper);
  let n = layout.viewports.length + 1;
  const ids = new Set(layout.viewports.map((v) => v.id));
  while (ids.has(`vp-${n}`)) n++;
  return { ...layout, viewports: [...layout.viewports, { id: `vp-${n}`, scene: scene.id, width, ratio, x: spot.x, y: spot.y }] };
}

/** A new scene (id and default name) for a camera. */
export function nextScene(scenes: readonly Scene[], camera: Scene['camera']): Scene {
  let n = scenes.length + 1;
  const ids = new Set(scenes.map((s) => s.id));
  while (ids.has(`scene-${n}`)) n++;
  return { id: `scene-${n}`, name: `View ${n}`, camera };
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
export function composeLayout(
  doc: Document,
  layout: Layout,
  settings: DrawingSettings = doc.drawingSettings,
  flat: Model = doc.flatten(),
  images?: ImageProvider,
): { sheet: Sheet; fits: boolean; rects: PageItem[] } {
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
  const rects: PageItem[] = [];
  for (const { viewport, sheet, empty } of viewportSheets(doc, layout, settings, flat, images)) {
    rects.push({ kind: 'viewport', id: viewport.id, x: viewport.x, y: viewport.y, w: sheet.width, h: sheet.height });
    if (empty) continue;
    fits &&= viewport.x >= FRAME - 1e-6 && viewport.y >= FRAME - 1e-6 && viewport.x + sheet.width <= width - FRAME + 1e-6 && viewport.y + sheet.height <= height - FRAME - PAGE_TITLE + 1e-6;
    for (const p of sheet.primitives) primitives.push(shift(p, viewport.x, viewport.y));
  }

  for (const note of layout.texts ?? []) {
    const lines = note.text.split('\n');
    rects.push({ kind: 'text', id: note.id, x: note.x, y: note.y, w: Math.max(...lines.map((l) => textWidth(l, note.size))), h: lines.length * note.size * 1.35 + note.size * 0.3 });
    note.text.split('\n').forEach((line, i) => {
      primitives.push({ type: 'text', x: note.x, y: note.y + note.size + i * note.size * 1.35, text: line, size: note.size, color: style.ink });
    });
  }
  if (layout.north) {
    rects.push({ kind: 'north', id: 'north', x: layout.north.x - 6, y: layout.north.y - 10, w: 12, h: 16 });
    primitives.push(...northArrow(layout.north.x, layout.north.y, style.ink));
  }

  // Title block: a fine rule, the sheet's name and project at the left, its number large and pale at the right.
  const ty = height - FRAME - 6;
  primitives.push({ type: 'path', lines: [[corner(FRAME, ty - 5.5), corner(width - FRAME, ty - 5.5)]], stroke: style.annotation.color, width: 0.1 });
  primitives.push({ type: 'text', x: FRAME + 4, y: ty, text: layout.name.toUpperCase(), size: 3.2, bold: true, color: style.ink, letterSpacing: 0.3 });
  primitives.push({ type: 'text', x: FRAME + 4, y: ty + 3.6, text: doc.name, size: 2.1, color: style.muted });
  const number = 101 + Math.max(0, settings.layouts.findIndex((l) => l.id === layout.id));
  primitives.push({ type: 'text', x: width - FRAME - 4, y: ty + 3.4, text: String(number), size: 8, bold: true, color: mixPale(style), anchor: 'end' });
  return { sheet: { width, height, background: style.paper, primitives, fits, font: style.font }, fits, rects };
}

/** A pale tone for large quiet text (a sheet number). */
function mixPale(style: { paper: string; muted: string }): string {
  return `#${new THREE.Color(style.paper).lerp(new THREE.Color(style.muted), 0.35).getHexString()}`;
}

/** A north arrow: a ring, a filled half-arrow pointing up the page, and an N. Centred at (x, y), 12 mm across. */
function northArrow(x: number, y: number, ink: string): Primitive[] {
  const r = 6;
  const ring = Array.from({ length: 36 }, (_, i) => new THREE.Vector2(x + r * Math.cos((i / 36) * 2 * Math.PI), y + r * Math.sin((i / 36) * 2 * Math.PI)));
  const V = (dx: number, dy: number) => new THREE.Vector2(x + dx, y + dy);
  return [
    { type: 'path', lines: [ring], closed: true, stroke: ink, width: 0.25 },
    { type: 'path', lines: [[V(0, -r + 0.8), V(2.2, 3.2), V(0, 1.6)]], closed: true, fill: ink },
    { type: 'path', lines: [[V(0, -r + 0.8), V(-2.2, 3.2), V(0, 1.6)]], closed: true, stroke: ink, width: 0.25 },
    { type: 'text', x, y: y - r - 1.4, text: 'N', size: 3.2, bold: true, color: ink, anchor: 'middle' },
  ];
}

/** A new layout id and a default name ("Sheet 1", "Sheet 2", ...). */
export function nextLayout(layouts: readonly Layout[], paper: LayoutPaper = 'A3'): Layout {
  let n = layouts.length + 1;
  const ids = new Set(layouts.map((l) => l.id));
  while (ids.has(`sheet-${n}`)) n++;
  return { id: `sheet-${n}`, name: `Sheet ${n}`, paper, viewports: [] };
}
