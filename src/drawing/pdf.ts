import * as THREE from 'three';
import { textWidth, type Sheet } from './sheet';

const PT_PER_MM = 72 / 25.4;
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Characters outside ASCII that WinAnsiEncoding has, as octal codes. */
const WIN_ANSI: Record<string, string> = { '–': '\\226', '—': '\\227', '·': '\\267', '−': '-', '×': '\\327', '°': '\\260', '•': '\\225' };

/** A PDF string literal, ASCII only. */
function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (WIN_ANSI[ch]) out += WIN_ANSI[ch];
    else if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127) out += ch;
    else out += '?';
  }
  return `(${out})`;
}

function rgb(hex: string): string {
  const c = new THREE.Color(hex);
  return `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}`;
}

/** The page content stream for a sheet, in PDF points with y up. */
function contentStream(sheet: Sheet): string {
  const k = PT_PER_MM;
  const X = (x: number) => fmt(x * k);
  const Y = (y: number) => fmt((sheet.height - y) * k);
  const ops: string[] = ['1 J 1 j'];
  ops.push(`${rgb(sheet.background)} rg 0 0 ${fmt(sheet.width * k)} ${fmt(sheet.height * k)} re f`);

  for (const p of sheet.primitives) {
    if (p.type === 'path') {
      const path = p.lines
        .map((line) => `${line.map((q, i) => `${X(q.x)} ${Y(q.y)} ${i === 0 ? 'm' : 'l'}`).join(' ')}${p.closed ? ' h' : ''}`)
        .join(' ');
      const style: string[] = [];
      if (p.fill) style.push(`${rgb(p.fill)} rg`);
      if (p.stroke) style.push(`${rgb(p.stroke)} RG ${fmt((p.width ?? 0.25) * k)} w`);
      style.push(p.dash ? `[${p.dash.map((d) => fmt(d * k)).join(' ')}] 0 d` : '[] 0 d');
      const paint = p.fill && p.stroke ? (p.evenOdd ? 'B*' : 'B') : p.fill ? (p.evenOdd ? 'f*' : 'f') : 'S';
      ops.push(`${style.join(' ')} ${path} ${paint}`);
    } else {
      const font = p.bold ? '/F2' : '/F1';
      const w = textWidth(p.text, p.size, p.bold, p.letterSpacing ?? 0);
      const shift = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
      const rad = ((p.rotate ?? 0) * Math.PI) / 180;
      const c = Math.cos(rad);
      const sn = Math.sin(rad);
      const x = p.x + shift * c;
      const y = p.y + shift * sn;
      // Sheet y runs down, PDF y up: a clockwise sheet rotation is a negative PDF angle.
      ops.push(
        `BT ${rgb(p.color)} rg ${font} ${fmt(p.size * k)} Tf ${fmt((p.letterSpacing ?? 0) * k)} Tc ${fmt(c)} ${fmt(-sn)} ${fmt(sn)} ${fmt(c)} ${X(x)} ${Y(y)} Tm ${pdfString(p.text)} Tj ET`,
      );
    }
  }
  return ops.join('\n');
}

/**
 * Writes sheets as a vector PDF, one page per sheet, each page the sheet's
 * paper size. Uses the standard Helvetica fonts, so nothing is embedded.
 */
export function sheetsToPdf(sheets: Sheet[], title = 'Elevation drawings'): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // object number
  };

  const catalog = add('');
  const pages = add('');
  const helvetica = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const helveticaBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(`<< /Title ${pdfString(title)} /Producer (Elevation) >>`);

  const pageIds: number[] = [];
  for (const sheet of sheets) {
    const stream = contentStream(sheet);
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${fmt(sheet.width * PT_PER_MM)} ${fmt(sheet.height * PT_PER_MM)}] ` +
          `/Resources << /Font << /F1 ${helvetica} 0 R /F2 ${helveticaBold} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  // Everything is ASCII, so string length equals byte length for the offsets.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
