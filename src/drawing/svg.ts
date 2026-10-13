import type * as THREE from 'three';
import type { Sheet } from './sheet';

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Renders a sheet as an SVG document in paper millimetres. */
export function sheetToSvg(sheet: Sheet): string {
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(sheet.width)}mm" height="${fmt(sheet.height)}mm" viewBox="0 0 ${fmt(sheet.width)} ${fmt(sheet.height)}" font-family="${escape(sheet.font)}">`,
  );
  out.push(`<rect width="100%" height="100%" fill="${sheet.background}"/>`);
  const loops = (lines: THREE.Vector2[][], closed: boolean) => lines.map((line) => `M${line.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join('L')}${closed ? 'Z' : ''}`).join('');
  let clips = 0;
  for (const p of sheet.primitives) {
    if (p.type === 'path') {
      let clipAttr = '';
      if (p.clip) {
        const id = `clip${clips++}`;
        out.push(`<clipPath id="${id}"><path d="${loops(p.clip, true)}" clip-rule="evenodd"/></clipPath>`);
        clipAttr = `clip-path="url(#${id})"`;
      }
      const d = p.lines.map((line) => `M${line.map((q) => `${fmt(q.x)} ${fmt(q.y)}`).join('L')}${p.closed ? 'Z' : ''}`).join('');
      const attrs = [
        `d="${d}"`,
        `fill="${p.fill ?? 'none'}"`,
        p.evenOdd ? 'fill-rule="evenodd"' : '',
        p.stroke ? `stroke="${p.stroke}" stroke-width="${fmt(p.width ?? 0.25)}" stroke-linecap="round" stroke-linejoin="round"` : '',
        p.dash ? `stroke-dasharray="${p.dash.map(fmt).join(' ')}"` : '',
        p.opacity !== undefined ? `opacity="${fmt(p.opacity)}"` : '',
        clipAttr,
      ];
      out.push(`<path ${attrs.filter(Boolean).join(' ')}/>`);
    } else {
      const attrs = [
        `x="${fmt(p.x)}"`,
        `y="${fmt(p.y)}"`,
        `font-size="${fmt(p.size)}"`,
        p.bold ? 'font-weight="600"' : '',
        `fill="${p.color}"`,
        p.anchor && p.anchor !== 'start' ? `text-anchor="${p.anchor}"` : '',
        p.letterSpacing ? `letter-spacing="${fmt(p.letterSpacing)}"` : '',
        p.rotate ? `transform="rotate(${fmt(p.rotate)} ${fmt(p.x)} ${fmt(p.y)})"` : '',
      ];
      out.push(`<text ${attrs.filter(Boolean).join(' ')}>${escape(p.text)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('');
}
