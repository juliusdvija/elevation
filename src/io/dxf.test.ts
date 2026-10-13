import { describe, expect, it } from 'vitest';
import { buildUnderlay, parseDxf } from './dxf';

/** Group code / value pairs as DXF writes them. */
const dxf = (header: string, entities: string) => `0\nSECTION\n2\nHEADER\n${header}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const line = (x1: number, y1: number, x2: number, y2: number) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;

describe('DXF import', () => {
  it('reads lines, closed polylines, circles and arcs, and the units in the header', () => {
    const entities =
      line(0, 0, 4000, 0) +
      '0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n1000\n20\n0\n10\n1000\n20\n1000\n10\n0\n20\n1000\n' +
      '0\nCIRCLE\n8\n0\n10\n500\n20\n500\n30\n0\n40\n250\n' +
      '0\nARC\n8\n0\n10\n0\n20\n0\n30\n0\n40\n1000\n50\n0\n51\n90\n' +
      '0\nTEXT\n8\n0\n10\n0\n20\n0\n1\nhello\n0\nHATCH\n8\n0\n';
    const d = parseDxf(dxf('9\n$INSUNITS\n70\n4\n', entities));
    expect(d.unitMm).toBe(1);
    expect(d.paths).toHaveLength(4);
    expect(d.paths[1]).toMatchObject({ closed: true });
    expect(d.paths[1].points).toHaveLength(4);
    expect(d.paths[2].points).toHaveLength(24);
    // The quarter arc runs from (1000, 0) to (0, 1000).
    const arc = d.paths[3].points;
    expect(arc[0][0]).toBeCloseTo(1000);
    expect(arc.at(-1)![1]).toBeCloseTo(1000);
    expect(Object.fromEntries(d.skipped)).toEqual({ TEXT: 1, HATCH: 1 });
  });

  it('turns a bulge into an arc on the right side of the chord', () => {
    // A half circle from (0,0) to (2000,0): positive bulge, counter-clockwise, so it bows below the chord.
    const bulged = parseDxf(dxf('', '0\nLWPOLYLINE\n8\n0\n70\n0\n10\n0\n20\n0\n42\n1\n10\n2000\n20\n0\n'));
    const ys = bulged.paths[0].points.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-1000, 0);
    expect(Math.max(...ys)).toBeCloseTo(0, 5);
    // Negative bulge bows the other way.
    const other = parseDxf(dxf('', '0\nLWPOLYLINE\n8\n0\n70\n0\n10\n0\n20\n0\n42\n-1\n10\n2000\n20\n0\n'));
    expect(Math.max(...other.paths[0].points.map((p) => p[1]))).toBeCloseTo(1000, 0);
    // A bulge past a half circle stays on the same side of the chord's end points.
    const big = parseDxf(dxf('', '0\nLWPOLYLINE\n8\n0\n70\n0\n10\n0\n20\n0\n42\n2\n10\n2000\n20\n0\n'));
    const bx = big.paths[0].points.map((p) => p[0]);
    expect(Math.min(...bx)).toBeLessThan(0); // bulges out beyond the chord's ends
  });

  it('reads old-style POLYLINE with VERTEX records', () => {
    const entities = '0\nPOLYLINE\n8\n0\n70\n1\n0\nVERTEX\n8\n0\n10\n0\n20\n0\n0\nVERTEX\n8\n0\n10\n1000\n20\n0\n0\nVERTEX\n8\n0\n10\n1000\n20\n1000\n0\nSEQEND\n';
    const d = parseDxf(dxf('', entities));
    expect(d.paths).toHaveLength(1);
    expect(d.paths[0]).toMatchObject({ closed: true });
    expect(d.paths[0].points).toHaveLength(3);
  });

  it('builds loose edges in millimetres, welding shared corners and leaving no faces', () => {
    const d = parseDxf(dxf('9\n$INSUNITS\n70\n6\n', line(0, 0, 4, 0) + line(4, 0, 4, 3) + line(4, 3, 0, 0)));
    const model = buildUnderlay(d, d.unitMm!);
    expect(model.faceCount).toBe(0);
    expect(model.edgeCount).toBe(3);
    expect(model.vertexCount).toBe(3);
    expect(model.bounds().max.x).toBe(4000);
    const moved = buildUnderlay(parseDxf(dxf('', line(5000, 7000, 6000, 7000))), 1, true);
    expect(moved.bounds().min.toArray()).toEqual([0, 0, 0]);
  });

  it('explains files it cannot read', () => {
    expect(() => parseDxf('AutoCAD Binary DXF\r\n\x1a\0')).toThrow(/ASCII/);
    expect(() => parseDxf('not a dxf')).toThrow(/ENTITIES/);
  });
});
