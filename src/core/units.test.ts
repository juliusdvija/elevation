import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, parseLengthPair } from './units';

describe('units', () => {
  it('parses lengths with optional units', () => {
    expect(parseLength('1200')).toBe(1200);
    expect(parseLength('1,2m')).toBe(1200);
    expect(parseLength('35 cm')).toBe(350);
    expect(parseLength('-500')).toBe(-500);
    expect(parseLength('abc')).toBeNull();
  });

  it('parses rectangle dimensions', () => {
    expect(parseLengthPair('3000;4000')).toEqual([3000, 4000]);
    expect(parseLengthPair('3m x 2,5m')).toEqual([3000, 2500]);
    expect(parseLengthPair('3000')).toBeNull();
  });

  it('formats lengths in millimetres', () => {
    expect(formatLength(1234.4)).toBe('1234 mm');
    expect(formatLength(2.46)).toBe('2.5 mm');
  });
});
