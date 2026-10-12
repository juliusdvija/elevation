import * as THREE from 'three';
import type { Drawing } from './project';
import type { ViewSetup } from './views';

/**
 * Drawing style tokens. Widths are in paper millimetres, so a drawing exported
 * at 1:100 prints with these exact line weights.
 */
export interface DrawingStyle {
  paper: string;
  poche: string;
  cutWidth: number;
  /** Projection lines fade from near to far. */
  near: { color: string; width: number };
  far: { color: string; width: number };
  groundWidth: number;
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
  ink: '#1d1d1b',
  muted: '#8a8780',
  font: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const DEPTH_STEPS = 5;
const MARGIN = 12; // mm of paper around the drawing

export interface SvgOptions {
  /** Drawing scale denominator: 100 means 1:100. */
  scale: number;
  style?: DrawingStyle;
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A scale bar with round metre ticks, right-aligned at `right`. */
function scaleBar(scale: number, style: DrawingStyle, right: number, y: number): string {
  const steps = [1000, 2000, 5000, 10000, 20000, 50000];
  const step = steps.find((st) => st / scale >= 8) ?? steps.at(-1)!;
  const segments = 4;
  const x = right - (step * segments) / scale;
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    parts.push(
      `<rect x="${fmt(x + (i * step) / scale)}" y="${fmt(y)}" width="${fmt(step / scale)}" height="1.2" fill="${i % 2 ? style.paper : style.ink}" stroke="${style.ink}" stroke-width="0.15"/>`,
    );
  }
  for (const i of [0, segments]) {
    parts.push(
      `<text x="${fmt(x + (i * step) / scale)}" y="${fmt(y + 4.2)}" font-size="2.2" text-anchor="middle" fill="${style.muted}">${(i * step) / 1000}${i === segments ? ' m' : ''}</text>`,
    );
  }
  return `<g>${parts.join('')}</g>`;
}

/** Renders a drawing as a print-ready SVG in paper millimetres. */
export function drawingToSvg(drawing: Drawing, setup: ViewSetup, options: SvgOptions): string {
  const style = options.style ?? MINIMAL;
  const s = options.scale;
  const b = drawing.bounds.isEmpty() ? new THREE.Box2(new THREE.Vector2(), new THREE.Vector2(1000, 1000)) : drawing.bounds.clone();
  if (setup.ground) {
    b.min.y = Math.min(b.min.y, 0);
  }

  // Wide enough for the title block on small drawings.
  const width = Math.max((b.max.x - b.min.x) / s + MARGIN * 2, 120);
  const drawingHeight = (b.max.y - b.min.y) / s;
  const height = drawingHeight + MARGIN * 2 + 14;
  // Model (u, v) to paper (x, y): flip v so up is up.
  const px = (u: number) => fmt((u - b.min.x) / s + MARGIN);
  const py = (v: number) => fmt((b.max.y - v) / s + MARGIN);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}" font-family="${escape(style.font)}">`,
  );
  out.push(`<rect width="100%" height="100%" fill="${style.paper}"/>`);

  // Projection lines, bucketed by depth so far lines fade out.
  const buckets: string[][] = Array.from({ length: DEPTH_STEPS }, () => []);
  for (const line of drawing.lines) {
    const i = Math.min(DEPTH_STEPS - 1, Math.floor(line.depth * DEPTH_STEPS));
    buckets[i].push(`M${px(line.a.x)} ${py(line.a.y)}L${px(line.b.x)} ${py(line.b.y)}`);
  }
  out.push('<g fill="none" stroke-linecap="round">');
  // Far first, so near lines draw on top.
  for (let i = DEPTH_STEPS - 1; i >= 0; i--) {
    if (buckets[i].length === 0) continue;
    const t = i / (DEPTH_STEPS - 1);
    const color = mix(style.near.color, style.far.color, t);
    const w = style.near.width + (style.far.width - style.near.width) * t;
    out.push(`<path d="${buckets[i].join('')}" stroke="${color}" stroke-width="${fmt(w)}"/>`);
  }
  out.push('</g>');

  if (drawing.cutLoops.length > 0) {
    const d = drawing.cutLoops.map((loop) => `M${loop.map((p) => `${px(p.x)} ${py(p.y)}`).join('L')}Z`).join('');
    out.push(`<path d="${d}" fill="${style.poche}" fill-rule="evenodd"/>`);
  }
  if (drawing.cutSegments.length > 0) {
    const d = drawing.cutSegments.map(([a, c]) => `M${px(a.x)} ${py(a.y)}L${px(c.x)} ${py(c.y)}`).join('');
    out.push(`<path d="${d}" fill="none" stroke="${style.poche}" stroke-width="${style.cutWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  if (setup.ground) {
    const overhang = 1500;
    out.push(
      `<path d="M${px(b.min.x - overhang)} ${py(0)}L${px(b.max.x + overhang)} ${py(0)}" stroke="${style.ink}" stroke-width="${style.groundWidth}"/>`,
    );
  }

  // Title block under the drawing.
  const ty = MARGIN + drawingHeight + 9;
  out.push(
    `<text x="${MARGIN}" y="${fmt(ty)}" font-size="3.2" font-weight="600" letter-spacing="0.3" fill="${style.ink}">${escape(setup.title.toUpperCase())}</text>`,
  );
  const subtitle = [setup.subtitle, `1:${s}`].filter(Boolean).join('  ·  ');
  out.push(`<text x="${MARGIN}" y="${fmt(ty + 4.6)}" font-size="2.2" fill="${style.muted}">${escape(subtitle)}</text>`);
  out.push(scaleBar(s, style, width - MARGIN, ty - 3));

  out.push('</svg>');
  return out.join('');
}
