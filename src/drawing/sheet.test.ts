import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../document';
import { drawPolygon } from '../kernel/draw';
import { pushPull } from '../kernel/pushPull';
import { buildSheets } from './build';
import { sheetsToPdf } from './pdf';
import { allViews, DEFAULT_SETTINGS } from './settings';
import { PAPER_SIZES } from './sheet';
import { sheetToSvg } from './svg';
import { parse, serialize, toFile } from '../io/format';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function house(): Document {
  const doc = new Document();
  const m = doc.model;
  doc.run('Box', () => {
    drawPolygon(m, [v(0, 0), v(8000, 0), v(8000, 6000), v(0, 6000)]);
    pushPull(m, m.allFaces()[0].id, -6000);
  });
  doc.updateDrawingSettings('Levels', {
    ...DEFAULT_SETTINGS,
    levels: [
      { id: 'level-0', name: 'Ground floor', elevation: 0 },
      { id: 'level-1', name: 'First floor', elevation: 3000 },
    ],
  });
  return doc;
}

const texts = (sheet: ReturnType<typeof buildSheets>[number]['sheet']) =>
  sheet.primitives.flatMap((p) => (p.type === 'text' ? [p.text] : []));

describe('sheets', () => {
  it('marks both sections on a plan', () => {
    const doc = house();
    const [{ sheet }] = buildSheets(doc, [{ kind: 'plan', level: 'level-0' }], { scale: 100 });
    const labels = texts(sheet);
    // Each section letter appears at both ends of its cut line.
    expect(labels.filter((t) => t === 'A')).toHaveLength(2);
    expect(labels.filter((t) => t === 'B')).toHaveLength(2);
    expect(labels).toContain('GROUND FLOOR');
  });

  it('marks levels on elevations and sections', () => {
    const doc = house();
    for (const ref of [{ kind: 'front' as const }, { kind: 'section' as const, section: 'A' }]) {
      const [{ sheet }] = buildSheets(doc, [ref], { scale: 100 });
      const labels = texts(sheet);
      expect(labels).toContain('Ground floor');
      expect(labels).toContain('First floor');
      expect(labels).toContain('+3000');
    }
  });

  it('places a drawing on a paper size and reports when it does not fit', () => {
    const doc = house();
    const [{ sheet }] = buildSheets(doc, [{ kind: 'front' }], { scale: 100, paper: 'A3' });
    expect([sheet.width, sheet.height]).toEqual(PAPER_SIZES.A3);
    expect(sheet.fits).toBe(true);
    const [{ sheet: tooBig }] = buildSheets(doc, [{ kind: 'front' }], { scale: 20, paper: 'A4' });
    expect(tooBig.fits).toBe(false);
  });

  it('renders valid SVG', () => {
    const doc = house();
    const [{ sheet }] = buildSheets(doc, [{ kind: 'plan', level: 'level-0' }], { scale: 100 });
    const svg = sheetToSvg(sheet);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill-rule="evenodd"');
  });
});

describe('pdf', () => {
  it('writes one page per drawing with a correct cross-reference table', () => {
    const doc = house();
    const refs = allViews(doc.drawingSettings);
    const built = buildSheets(doc, refs, { scale: 100, paper: 'A3' });
    const bytes = sheetsToPdf(built.map((b) => b.sheet), 'House');
    const text = new TextDecoder().decode(bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(refs.length);
    // A3 landscape in points.
    expect(text).toContain(`/MediaBox [0 0 ${Math.round((420 * 72) / 25.4 * 1000) / 1000}`);

    // Every xref entry points at its object.
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    entries.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // Only ASCII, so byte offsets equal character offsets.
    expect(bytes.length).toBe(text.length);
  });
});

describe('drawing settings', () => {
  it('can be undone and are saved with the file', () => {
    const doc = house();
    expect(doc.drawingSettings.levels).toHaveLength(2);
    doc.history.undo();
    expect(doc.drawingSettings.levels).toHaveLength(1);
    doc.history.redo();

    const file = parse(serialize(toFile(doc.model.toData(), undefined, [], doc.drawingSettings)));
    const copy = new Document();
    copy.load(file.model, 'copy', null, { drawing: file.drawing });
    expect(copy.drawingSettings.levels.map((l) => l.name)).toEqual(['Ground floor', 'First floor']);
  });
});
