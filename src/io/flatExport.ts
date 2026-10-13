import * as THREE from 'three';
import type { Id, Model } from '../kernel/Model';
import { planeFrame, to2D } from '../kernel/math';

/** One flattened face: its loops (outline first, then holes) in millimetres, with the part's lower left corner at (0, 0). */
export interface FlatPart {
  face: Id;
  loops: THREE.Vector2[][];
  width: number;
  height: number;
}

export interface FlatLayout {
  parts: (FlatPart & { x: number; y: number })[];
  width: number;
  height: number;
}

/**
 * Lays each face flat in its own plane at true size, turned so its longest outline edge runs along x
 * (the shape is the same, it is just a good way up for cutting). Each face is seen from the side its normal
 * points to, so the outside of a solid faces up and nothing is mirrored.
 */
export function flattenFace(model: Model, faceId: Id): FlatPart {
  const face = model.face(faceId);
  const frame = planeFrame({ normal: face.normal.clone(), d: face.normal.dot(model.position(face.outer[0])) });
  const project = (loop: readonly Id[]) => loop.map((v) => to2D(frame, model.position(v)));
  let loops = [project(face.outer), ...face.holes.map(project)];
  // Rotate the longest outline edge onto the x axis.
  const outline = loops[0];
  let longest = { length: 0, angle: 0 };
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const length = p.distanceTo(q);
    if (length > longest.length + 1e-9) longest = { length, angle: Math.atan2(q.y - p.y, q.x - p.x) };
  });
  const c = Math.cos(-longest.angle);
  const s = Math.sin(-longest.angle);
  loops = loops.map((loop) => loop.map((p) => new THREE.Vector2(p.x * c - p.y * s, p.x * s + p.y * c)));
  const all = loops.flat();
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  loops = loops.map((loop) => loop.map((p) => new THREE.Vector2(p.x - minX, p.y - minY)));
  return { face: faceId, loops, width: Math.max(...loops.flat().map((p) => p.x)), height: Math.max(...loops.flat().map((p) => p.y)) };
}

/** Parts in rows no wider than `maxWidth`, `gap` apart. */
export function layoutParts(parts: FlatPart[], gap = 5, maxWidth = 600): FlatLayout {
  const placed: FlatLayout['parts'] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  // Tallest first keeps rows tidy.
  for (const part of [...parts].sort((a, b) => b.height - a.height)) {
    if (x > 0 && x + part.width > maxWidth) {
      y += rowHeight + gap;
      x = 0;
      rowHeight = 0;
    }
    placed.push({ ...part, x, y });
    x += part.width + gap;
    rowHeight = Math.max(rowHeight, part.height);
    width = Math.max(width, x - gap);
  }
  return { parts: placed, width, height: y + rowHeight };
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** An SVG in millimetres (its size attributes say so): one closed path per part, cut lines as thin red hairlines. */
export function layoutToSvg(layout: FlatLayout): string {
  const margin = 2;
  const w = layout.width + margin * 2;
  const h = layout.height + margin * 2;
  // SVG's y runs down; parts are placed with y up, so flip.
  const point = (part: FlatLayout['parts'][number], p: THREE.Vector2) => `${fmt(part.x + p.x + margin)} ${fmt(h - (part.y + p.y + margin))}`;
  const paths = layout.parts.map((part) => `<path id="part-${part.face}" d="${part.loops.map((loop) => `M${loop.map((p) => point(part, p)).join('L')}Z`).join('')}" fill="none" stroke="#ff0000" stroke-width="0.1" fill-rule="evenodd"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">${paths.join('')}</svg>`;
}

/** An ASCII DXF in millimetres with one closed LWPOLYLINE per loop, on a CUT layer. */
export function layoutToDxf(layout: FlatLayout): string {
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const part of layout.parts) {
    for (const loop of part.loops) {
      out.push('0', 'LWPOLYLINE', '8', 'CUT', '90', String(loop.length), '70', '1');
      for (const p of loop) out.push('10', fmt(part.x + p.x), '20', fmt(part.y + p.y));
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}
