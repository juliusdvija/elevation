import * as THREE from 'three';
import type { Drawing } from './project';
import { formatDimension, scaleLabel, trimNumber } from '../core/units';
import { hatchSegments } from './hatch';
import type { Level } from './settings';
import type { ViewSetup } from './views';

/**
 * Drawing style tokens. Widths and sizes are in paper millimetres, so a sheet
 * printed at its scale has exactly these line weights.
 */
export interface DrawingStyle {
  paper: string;
  poche: string;
  cutWidth: number;
  /** Projection lines fade from near to far. */
  near: { color: string; width: number };
  far: { color: string; width: number };
  groundWidth: number;
  annotation: { color: string; width: number };
  ink: string;
  muted: string;
  font: string;
  /** Large cut masses (earth, trees) are drawn pale with a fine hatch, not solid; [above ground, below ground]. */
  mass: { fill: string; hatch: string }[];
}

export const MINIMAL: DrawingStyle = {
  paper: '#fbfaf7',
  poche: '#1d1d1b',
  cutWidth: 0.3,
  near: { color: '#26262a', width: 0.18 },
  far: { color: '#b9b6ae', width: 0.08 },
  groundWidth: 0.4,
  annotation: { color: '#8a8780', width: 0.13 },
  ink: '#1d1d1b',
  muted: '#8a8780',
  font: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mass: [
    { fill: '#f1efe9', hatch: '#9a978f' },
    { fill: '#ebe7de', hatch: '#b3aea3' },
  ],
};

/** Paper-space primitives (mm, y down) that both SVG and PDF render. */
export type Primitive =
  | {
      type: 'path';
      /** Polylines, each a list of points. */
      lines: THREE.Vector2[][];
      closed?: boolean;
      stroke?: string;
      width?: number;
      fill?: string;
      evenOdd?: boolean;
      dash?: number[];
      /** Opacity of the fill and stroke, 0 to 1 (absent: solid). */
      opacity?: number;
      /** Paint only inside these loops (even-odd): a shadow stays on the face it falls on. */
      clip?: THREE.Vector2[][];
    }
  | {
      /** A picture (a rendered 3D view): a JPEG data URL placed in a box, paper mm. */
      type: 'image';
      x: number;
      y: number;
      w: number;
      h: number;
      href: string;
      /** Pixel size of the JPEG, for PDF. */
      pixels: [number, number];
    }
  | {
      type: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      bold?: boolean;
      color: string;
      anchor?: 'start' | 'middle' | 'end';
      letterSpacing?: number;
      /** Degrees clockwise on the sheet, about (x, y). */
      rotate?: number;
    };

export interface Sheet {
  width: number;
  height: number;
  background: string;
  primitives: Primitive[];
  /** False when the drawing does not fit the chosen paper at this scale. */
  fits: boolean;
  /** For SVG text. */
  font: string;
}

/** A section cut to mark on a plan: a line in plan coordinates and the way it looks. */
export interface SectionMarker {
  id: string;
  /** A point on the cut line and the line's direction, in plan (u, v) coordinates. */
  point: THREE.Vector2;
  direction: THREE.Vector2;
  /** Viewing direction, in plan coordinates. */
  look: THREE.Vector2;
}

/** A dimension in drawing (u, v) coordinates: the measured points and the ends of its line. */
export interface DimensionMarker {
  a: THREE.Vector2;
  b: THREE.Vector2;
  a2: THREE.Vector2;
  b2: THREE.Vector2;
  text: string;
}

export interface Annotations {
  /** Dimensions parallel to this view. */
  dimensions?: DimensionMarker[];
  /** Also dimension the drawing itself: overall size, and the cut walls in a chain. */
  autoDimensions?: boolean;
  /** Level markers on elevations and sections. */
  levels?: Level[];
  /** Section symbols on plans. */
  sections?: SectionMarker[];
}

export type Paper = 'fit' | 'A4' | 'A3' | 'A2' | 'A1';

/** Landscape paper sizes (mm). */
export const PAPER_SIZES: Record<Exclude<Paper, 'fit'>, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
};

export interface SheetOptions {
  /** Scale denominator: 100 means 1:100. */
  scale: number;
  paper?: Paper;
  style?: DrawingStyle;
}

const MARGIN = 12; // paper mm around everything
const TITLE_BLOCK = 16; // paper mm below the drawing for the title
const DEPTH_STEPS = 5;
const SHADOW_OPACITY = 0.22; // a cast shadow is about as dark as a face turned from the light
const LEVEL_GUTTER = 34; // paper mm right of the drawing for level labels
const SOLID_CUT = 3.5; // paper mm: cut regions thinner than this are solid, thicker ones hatched
const SECTION_OVERHANG = 8; // paper mm a section line runs past the drawing

/** Rough text width for layout (PDF has no layout engine). */
export function textWidth(text: string, size: number, bold = false, letterSpacing = 0): number {
  return text.length * size * (bold ? 0.6 : 0.53) + text.length * letterSpacing;
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

function formatLevel(mm: number): string {
  const rounded = Math.round(mm);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)}`;
}

/** The part of a loop at or above `y0` (Sutherland-Hodgman against one half-plane). */
function clipLoopAbove(loop: THREE.Vector2[], y0 = 0): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length];
    const pIn = p.y >= y0;
    const qIn = q.y >= y0;
    if (pIn) out.push(p);
    if (pIn !== qIn) out.push(new THREE.Vector2(p.x + ((q.x - p.x) * (y0 - p.y)) / (q.y - p.y), y0));
  });
  return out;
}

/** An elevation without what lies below the ground line: fills and lines are cut off at height 0. */
function clipAtGround(drawing: Drawing): Drawing {
  const bounds = new THREE.Box2();
  const fills = drawing.fills
    .map((f) => ({ ...f, loops: f.loops.map((l) => clipLoopAbove(l)).filter((l) => l.length >= 3) }))
    .filter((f) => f.loops.length > 0);
  const lines = drawing.lines.flatMap((l) => {
    if (l.a.y < 0 && l.b.y < 0) return [];
    if (l.a.y >= 0 && l.b.y >= 0) return [l];
    const [up, down] = l.a.y >= 0 ? [l.a, l.b] : [l.b, l.a];
    const cut = new THREE.Vector2(up.x + ((down.x - up.x) * (0 - up.y)) / (down.y - up.y), 0);
    return [{ ...l, a: up, b: cut }];
  });
  for (const l of lines) bounds.expandByPoint(l.a).expandByPoint(l.b);
  for (const f of fills) for (const loop of f.loops) for (const p of loop) bounds.expandByPoint(p);
  return { ...drawing, fills, lines, bounds };
}

const area = (loop: THREE.Vector2[]) => Math.abs(THREE.ShapeUtils.area(loop));
const perimeter = (loop: THREE.Vector2[]) => loop.reduce((sum, p, i) => sum + p.distanceTo(loop[(i + 1) % loop.length]), 0);

function insideLoop(p: THREE.Vector2, loop: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const c = loop[j];
    if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Groups section loops into regions: an outline with the holes directly inside it. */
function cutRegions(loops: THREE.Vector2[][]): THREE.Vector2[][][] {
  const depth = loops.map((loop, i) => loops.filter((other, j) => j !== i && insideLoop(loop[0], other)).length);
  const regions: THREE.Vector2[][][] = [];
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) regions.push([loop]);
  });
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) return;
    // The innermost outline that holds it (one level up).
    const owner = regions.find((r) => depth[loops.indexOf(r[0])] === depth[i] - 1 && insideLoop(loop[0], r[0]));
    (owner ?? regions[0])?.push(loop);
  });
  return regions;
}

/** Fine diagonal lines across a box (paper mm), for hatching a large cut mass. */
function diagonalHatch(box: THREE.Box2, spacing: number): THREE.Vector2[][] {
  const lines: THREE.Vector2[][] = [];
  const h = box.max.y - box.min.y;
  for (let x = box.min.x - h; x < box.max.x; x += spacing) lines.push([new THREE.Vector2(x, box.max.y), new THREE.Vector2(x + h, box.min.y)]);
  return lines;
}

/** Overall width and height of a drawing, and a chain along its cut walls. Offsets are paper mm times the scale. */
function autoDimensionMarkers(drawing: Drawing, b: THREE.Box2, s: number): DimensionMarker[] {
  const db = drawing.bounds;
  if (db.isEmpty() || (db.max.x - db.min.x < 1 && db.max.y - db.min.y < 1)) return [];
  const out: DimensionMarker[] = [];
  const V = (x: number, y: number) => new THREE.Vector2(x, y);
  const text = (mm: number) => formatDimension(mm);
  const bottom = b.min.y;
  const left = db.min.x;
  const width = db.max.x - db.min.x;
  const height = db.max.y - db.min.y;
  if (width > 1) out.push({ a: V(db.min.x, bottom), b: V(db.max.x, bottom), a2: V(db.min.x, bottom - 15 * s), b2: V(db.max.x, bottom - 15 * s), text: text(width) });
  if (height > 1) out.push({ a: V(left, db.min.y), b: V(left, db.max.y), a2: V(left - 9 * s, db.min.y), b2: V(left - 9 * s, db.max.y), text: text(height) });
  // Chain: the distinct positions of the cut walls along the width.
  const xs = [...new Set(drawing.cutLoops.flat().map((p) => Math.round(p.x)))].sort((p, q) => p - q);
  const stops = xs.filter((x, i) => i === 0 || x - xs[i - 1] >= 40);
  if (stops.length >= 3 && stops.length <= 14) {
    for (let i = 1; i < stops.length; i++) {
      out.push({ a: V(stops[i - 1], bottom), b: V(stops[i], bottom), a2: V(stops[i - 1], bottom - 8 * s), b2: V(stops[i], bottom - 8 * s), text: text(stops[i] - stops[i - 1]) });
    }
  }
  return out;
}

/** Lays out a drawing with its annotations, title and scale bar on a sheet. */
export function layoutSheet(input: Drawing, setup: ViewSetup, annotations: Annotations, options: SheetOptions): Sheet {
  const style = options.style ?? MINIMAL;
  // An elevation stops at the ground line; a section keeps what is below it.
  const drawing = setup.ground && setup.cut === null ? clipAtGround(input) : input;
  const s = options.scale;
  const b = drawing.bounds.isEmpty() ? new THREE.Box2(new THREE.Vector2(), new THREE.Vector2(1000, 1000)) : drawing.bounds.clone();
  if (setup.ground) b.min.y = Math.min(b.min.y, 0);
  const levels = setup.ground ? (annotations.levels ?? []) : [];
  for (const l of levels) {
    b.min.y = Math.min(b.min.y, l.elevation);
    b.max.y = Math.max(b.max.y, l.elevation);
  }
  const dimensions = [...(annotations.dimensions ?? [])];
  if (annotations.autoDimensions) dimensions.push(...autoDimensionMarkers(drawing, b, s));
  for (const d of dimensions) for (const p of [d.a, d.b, d.a2, d.b2]) b.expandByPoint(p);
  const sections = setup.kind === 'plan' ? (annotations.sections ?? []) : [];
  const overhang = SECTION_OVERHANG * s;
  if (sections.length > 0) b.expandByScalar(overhang + 6 * s);

  const contentW = (b.max.x - b.min.x) / s + (levels.length > 0 ? LEVEL_GUTTER : 0);
  const contentH = (b.max.y - b.min.y) / s;
  const neededW = contentW + MARGIN * 2;
  const neededH = contentH + MARGIN * 2 + TITLE_BLOCK;

  let width = Math.max(neededW, 120);
  let height = neededH;
  let fits = true;
  if (options.paper && options.paper !== 'fit') {
    [width, height] = PAPER_SIZES[options.paper];
    fits = neededW <= width + 1e-6 && neededH <= height + 1e-6;
  }
  // Centre the drawing in the space above the title block.
  const ox = Math.max(MARGIN, (width - contentW) / 2);
  const oy = Math.max(MARGIN, (height - TITLE_BLOCK - contentH) / 2);
  const px = (u: number) => ox + (u - b.min.x) / s;
  const py = (v: number) => oy + (b.max.y - v) / s;
  const P = (u: number, v: number) => new THREE.Vector2(px(u), py(v));
  const out: Primitive[] = [];

  // Cast shadows on the ground, under everything: one path, so overlaps do not darken twice.
  if (drawing.shadows.length > 0) {
    out.push({ type: 'path', lines: drawing.shadows.map((poly) => poly.map((p) => P(p.x, p.y))), closed: true, fill: style.ink, opacity: 0.13 });
  }

  // Colour fills, far to near, one path per face (even-odd would punch holes where two overlap).
  // A hair of stroke in the fill colour hides the seams between neighbours.
  for (const fill of drawing.fills) {
    // Colours are eased towards the paper so a coloured drawing stays calm; glass and white are left alone.
    const base = fill.color ? mix(style.paper, fill.color, 0.9) : style.paper;
    // Shading darkens towards black; a fully lit face keeps its own colour.
    const color = fill.shade !== undefined && fill.shade < 1 ? mix('#000000', base, fill.shade) : base;
    const loops = fill.loops.map((loop) => loop.map((p) => P(p.x, p.y)));
    out.push({ type: 'path', lines: loops, closed: true, fill: color, stroke: color, width: 0.08, evenOdd: true, ...(fill.opacity !== undefined ? { opacity: fill.opacity } : {}) });
    // A hatch pattern in the face's plane (brick courses, boards ...), kept inside it, a darker shade of its colour.
    if (fill.hatch) {
      const segments = hatchSegments(fill.hatch.kind, fill.hatch.box, s);
      if (segments.length > 0) {
        const lines = segments.map(([a, b]) => {
          const p = fill.hatch!.map(a.x, a.y);
          const q = fill.hatch!.map(b.x, b.y);
          return [P(p.x, p.y), P(q.x, q.y)];
        });
        out.push({ type: 'path', lines, stroke: mix('#000000', base, 0.5), width: 0.07, opacity: 0.6, clip: loops });
      }
    }
    // Shadows other faces cast on this one, kept inside it.
    if (fill.shadows && fill.shadows.length > 0) {
      out.push({ type: 'path', lines: fill.shadows.map((poly) => poly.map((p) => P(p.x, p.y))), closed: true, fill: '#000000', opacity: SHADOW_OPACITY, clip: loops });
    }
  }

  // Projection lines, far first so near lines draw on top.
  const buckets: THREE.Vector2[][][] = Array.from({ length: DEPTH_STEPS }, () => []);
  for (const line of drawing.lines) {
    const i = Math.min(DEPTH_STEPS - 1, Math.floor(line.depth * DEPTH_STEPS));
    buckets[i].push([P(line.a.x, line.a.y), P(line.b.x, line.b.y)]);
  }
  for (let i = DEPTH_STEPS - 1; i >= 0; i--) {
    if (buckets[i].length === 0) continue;
    const t = i / (DEPTH_STEPS - 1);
    out.push({
      type: 'path',
      lines: buckets[i],
      stroke: mix(style.near.color, style.far.color, t),
      width: style.near.width + (style.far.width - style.near.width) * t,
    });
  }

  // Section poché. Thin cut elements (walls, slabs) are solid; large masses (earth, trees) are pale with a fine hatch.
  if (drawing.cutLoops.length > 0) {
    const solid: THREE.Vector2[][] = [];
    for (const region of cutRegions(drawing.cutLoops)) {
      const paper = region.map((loop) => loop.map((p) => P(p.x, p.y)));
      const thickness = (2 * (area(paper[0]) - paper.slice(1).reduce((sum, l) => sum + area(l), 0))) / paper.reduce((sum, l) => sum + perimeter(l), 0);
      if (thickness <= SOLID_CUT) {
        solid.push(...paper);
        continue;
      }
      const below = region[0].every((p) => p.y <= 1e-6);
      const tone = style.mass[below ? 1 : 0];
      out.push({ type: 'path', lines: paper, closed: true, fill: tone.fill, evenOdd: true });
      const box = new THREE.Box2().setFromPoints(paper[0]);
      out.push({ type: 'path', lines: diagonalHatch(box, 1.3), stroke: tone.hatch, width: 0.07, clip: paper });
    }
    if (solid.length > 0) out.push({ type: 'path', lines: solid, closed: true, fill: style.poche, evenOdd: true });
  }
  if (drawing.cutSegments.length > 0) {
    out.push({ type: 'path', lines: drawing.cutSegments.map(([a, c]) => [P(a.x, a.y), P(c.x, c.y)]), stroke: style.poche, width: style.cutWidth });
  }

  // Ground line.
  if (setup.ground) {
    // Past the building, but not off the paper.
    const reach = Math.min(1500, (MARGIN - 4) * s);
    out.push({ type: 'path', lines: [[P(b.min.x - reach, 0), P(b.max.x + reach, 0)]], stroke: style.ink, width: style.groundWidth });
  }

  // Level markers: a light line across, a triangle and the level's name and height at the right.
  for (const level of levels) {
    const y = py(level.elevation);
    const right = px(b.max.x);
    if (level.elevation !== 0) {
      out.push({ type: 'path', lines: [[new THREE.Vector2(px(b.min.x), y), new THREE.Vector2(right + 3, y)]], stroke: style.annotation.color, width: style.annotation.width, dash: [2, 1.2] });
    }
    const x = right + 6;
    out.push({
      type: 'path',
      lines: [[new THREE.Vector2(x - 1.4, y - 2.2), new THREE.Vector2(x + 1.4, y - 2.2), new THREE.Vector2(x, y)]],
      closed: true,
      fill: style.muted,
    });
    out.push({ type: 'text', x: x + 3, y: y - 0.8, text: level.name, size: 2, color: style.muted });
    out.push({ type: 'text', x: x + 3, y: y + 2.4, text: formatLevel(level.elevation), size: 2, color: style.muted });
  }

  // Section symbols: a light cut line, heavy ends, arrows in the viewing direction, the letter.
  for (const section of sections) {
    const { point, direction, look } = section;
    // Extent of the cut line: across the drawing bounds, plus the overhang.
    const corners = [b.min, new THREE.Vector2(b.max.x, b.min.y), b.max, new THREE.Vector2(b.min.x, b.max.y)];
    const ts = corners.map((c) => c.clone().sub(point).dot(direction));
    const t0 = Math.min(...ts) + 6 * s;
    const t1 = Math.max(...ts) - 6 * s;
    const end0 = point.clone().addScaledVector(direction, t0);
    const end1 = point.clone().addScaledVector(direction, t1);
    out.push({ type: 'path', lines: [[P(end0.x, end0.y), P(end1.x, end1.y)]], stroke: style.annotation.color, width: style.annotation.width, dash: [4, 1.2, 0.8, 1.2] });
    for (const [end, inward] of [
      [end0, 1],
      [end1, -1],
    ] as const) {
      const a = P(end.x, end.y);
      const along = P(end.x + direction.x * inward, end.y + direction.y * inward).sub(a).normalize();
      const lookPaper = P(end.x + look.x, end.y + look.y).sub(a).normalize();
      out.push({ type: 'path', lines: [[a, a.clone().addScaledVector(along, 4)]], stroke: style.ink, width: 0.5 });
      // Arrow from the line end, pointing where the section looks.
      const tip = a.clone().addScaledVector(lookPaper, 3.2);
      out.push({ type: 'path', lines: [[a.clone().addScaledVector(along, 1.3), tip, a.clone().addScaledVector(along, -1.3)]], closed: true, fill: style.ink });
      const label = a.clone().addScaledVector(along, -3.2).addScaledVector(lookPaper, 1.2);
      out.push({ type: 'text', x: label.x, y: label.y + 1.1, text: section.id, size: 3.2, bold: true, color: style.ink, anchor: 'middle' });
    }
  }

  // Dimensions: extension lines, the dimension line with slashes at the ends, the length above it.
  for (const d of dimensions) {
    const a = P(d.a.x, d.a.y);
    const bb = P(d.b.x, d.b.y);
    const a2 = P(d.a2.x, d.a2.y);
    const b2 = P(d.b2.x, d.b2.y);
    const along = b2.clone().sub(a2);
    if (along.length() < 0.5) continue;
    along.normalize();
    const away = (from: THREE.Vector2, to: THREE.Vector2) => {
      const v = to.clone().sub(from);
      return v.length() < 1e-6 ? new THREE.Vector2() : v.normalize();
    };
    // Extension lines run from just off the measured point to a little past the dimension line.
    for (const [from, to] of [[a, a2], [bb, b2]] as const) {
      const dir = away(from, to);
      out.push({ type: 'path', lines: [[from.clone().addScaledVector(dir, 1.2), to.clone().addScaledVector(dir, 1.8)]], stroke: style.annotation.color, width: style.annotation.width });
    }
    const ext = 1.2;
    out.push({ type: 'path', lines: [[a2.clone().addScaledVector(along, -ext), b2.clone().addScaledVector(along, ext)]], stroke: style.ink, width: 0.18 });
    const slash = new THREE.Vector2(along.x + along.y, along.y - along.x).normalize().multiplyScalar(1.1);
    for (const end of [a2, b2]) out.push({ type: 'path', lines: [[end.clone().sub(slash), end.clone().add(slash)]], stroke: style.ink, width: 0.4 });
    let angle = (Math.atan2(along.y, along.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    const rad = (angle * Math.PI) / 180;
    const normal = new THREE.Vector2(Math.sin(rad), -Math.cos(rad)); // the side of the line the text sits on
    const at = a2.clone().add(b2).multiplyScalar(0.5).addScaledVector(normal, 0.9);
    out.push({ type: 'text', x: at.x, y: at.y, text: d.text, size: 2.2, color: style.ink, anchor: 'middle', rotate: angle });
  }

  // Title block and scale bar.
  const ty = height - MARGIN - TITLE_BLOCK + 9;
  out.push({ type: 'path', lines: [[new THREE.Vector2(MARGIN, ty - 6), new THREE.Vector2(width - MARGIN, ty - 6)]], stroke: style.annotation.color, width: 0.1 });
  out.push({ type: 'text', x: MARGIN, y: ty, text: setup.title.toUpperCase(), size: 3.2, bold: true, color: style.ink, letterSpacing: 0.3 });
  const subtitle = [setup.subtitle, scaleLabel(s)].filter(Boolean).join('  ·  ');
  out.push({ type: 'text', x: MARGIN, y: ty + 4.6, text: subtitle, size: 2.2, color: style.muted });
  out.push(...scaleBar(s, style, width - MARGIN, ty - 3));

  return { width, height, background: style.paper, primitives: out, fits, font: style.font };
}

/** A scale bar with round metre ticks, right-aligned at `right`. */
function scaleBar(scale: number, style: DrawingStyle, right: number, y: number): Primitive[] {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const step = steps.find((st) => st / scale >= 8) ?? steps.at(-1)!;
  const segments = 4;
  const seg = step / scale;
  const x = right - seg * segments;
  const out: Primitive[] = [];
  for (let i = 0; i < segments; i++) {
    const x0 = x + i * seg;
    const box = [new THREE.Vector2(x0, y), new THREE.Vector2(x0 + seg, y), new THREE.Vector2(x0 + seg, y + 1.2), new THREE.Vector2(x0, y + 1.2)];
    out.push({ type: 'path', lines: [box], closed: true, fill: i % 2 ? style.paper : style.ink, stroke: style.ink, width: 0.15 });
  }
  out.push({ type: 'text', x, y: y + 4.2, text: '0', size: 2.2, color: style.muted, anchor: 'middle' });
  out.push({ type: 'text', x: right, y: y + 4.2, text: step * segments >= 1000 ? `${trimNumber((step * segments) / 1000, 2)} m` : `${trimNumber(step * segments, 2)} mm`, size: 2.2, color: style.muted, anchor: 'middle' });
  return out;
}
