import * as THREE from 'three';
import type { Drawing } from './project';
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
}

export const MINIMAL: DrawingStyle = {
  paper: '#fbfaf7',
  poche: '#1d1d1b',
  cutWidth: 0.35,
  near: { color: '#1d1d1b', width: 0.25 },
  far: { color: '#aeaba3', width: 0.1 },
  groundWidth: 0.5,
  annotation: { color: '#8a8780', width: 0.13 },
  ink: '#1d1d1b',
  muted: '#8a8780',
  font: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
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
const LEVEL_GUTTER = 34; // paper mm right of the drawing for level labels
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

/** Lays out a drawing with its annotations, title and scale bar on a sheet. */
export function layoutSheet(drawing: Drawing, setup: ViewSetup, annotations: Annotations, options: SheetOptions): Sheet {
  const style = options.style ?? MINIMAL;
  const s = options.scale;
  const b = drawing.bounds.isEmpty() ? new THREE.Box2(new THREE.Vector2(), new THREE.Vector2(1000, 1000)) : drawing.bounds.clone();
  if (setup.ground) b.min.y = Math.min(b.min.y, 0);
  const levels = setup.ground ? (annotations.levels ?? []) : [];
  for (const l of levels) {
    b.min.y = Math.min(b.min.y, l.elevation);
    b.max.y = Math.max(b.max.y, l.elevation);
  }
  const dimensions = annotations.dimensions ?? [];
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

  // Section poché and its outline.
  if (drawing.cutLoops.length > 0) {
    out.push({ type: 'path', lines: drawing.cutLoops.map((loop) => loop.map((p) => P(p.x, p.y))), closed: true, fill: style.poche, evenOdd: true });
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
      fill: style.ink,
    });
    out.push({ type: 'text', x: x + 3, y: y - 0.8, text: level.name, size: 2.2, bold: true, color: style.ink });
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
  out.push({ type: 'text', x: MARGIN, y: ty, text: setup.title.toUpperCase(), size: 3.2, bold: true, color: style.ink, letterSpacing: 0.3 });
  const subtitle = [setup.subtitle, `1:${s}`].filter(Boolean).join('  ·  ');
  out.push({ type: 'text', x: MARGIN, y: ty + 4.6, text: subtitle, size: 2.2, color: style.muted });
  out.push(...scaleBar(s, style, width - MARGIN, ty - 3));

  return { width, height, background: style.paper, primitives: out, fits, font: style.font };
}

/** A scale bar with round metre ticks, right-aligned at `right`. */
function scaleBar(scale: number, style: DrawingStyle, right: number, y: number): Primitive[] {
  const steps = [1000, 2000, 5000, 10000, 20000, 50000];
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
  out.push({ type: 'text', x: right, y: y + 4.2, text: `${(step * segments) / 1000} m`, size: 2.2, color: style.muted, anchor: 'middle' });
  return out;
}
