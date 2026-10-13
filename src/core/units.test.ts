import { afterEach, describe, expect, it } from 'vitest';
import { formatDimension, formatLength, parseLength, parseLengthPair, setDisplaySettings, trimNumber } from './units';

afterEach(() => setDisplaySettings({ unit: 'mm', decimals: 2 }));

describe('units', () => {
  it('parses lengths with optional units', () => {
    expect(parseLength('1200')).toBe(1200);
    expect(parseLength('1,2m')).toBe(1200);
    expect(parseLength('35 cm')).toBe(350);
    expect(parseLength('-500')).toBe(-500);
    expect(parseLength('abc')).toBeNull();
  });

  it('reads inches and feet, written out or with marks', () => {
    expect(parseLength('1 in')).toBeCloseTo(25.4);
    expect(parseLength('6"')).toBeCloseTo(152.4);
    expect(parseLength("3'")).toBeCloseTo(914.4);
    expect(parseLength('1.5ft')).toBeCloseTo(457.2);
  });

  it('takes a bare number in the display unit', () => {
    setDisplaySettings({ unit: 'cm' });
    expect(parseLength('12')).toBe(120);
    expect(parseLength('12 mm')).toBe(12);
    setDisplaySettings({ unit: 'in' });
    expect(parseLength('2')).toBeCloseTo(50.8);
    setDisplaySettings({ unit: 'm' });
    expect(parseLength('1,5')).toBe(1500);
  });

  it('parses rectangle dimensions', () => {
    expect(parseLengthPair('3000;4000')).toEqual([3000, 4000]);
    expect(parseLengthPair('3m x 2,5m')).toEqual([3000, 2500]);
    expect(parseLengthPair('3000')).toBeNull();
  });

  it('shows the precision a precise model needs, without noise', () => {
    expect(formatLength(1234)).toBe('1234 mm');
    expect(formatLength(12.5)).toBe('12.5 mm');
    expect(formatLength(2.46)).toBe('2.46 mm');
    expect(formatLength(0.075)).toBe('0.08 mm');
    expect(formatLength(1999.99999999)).toBe('2000 mm');
    expect(formatLength(-0.0001)).toBe('0 mm');
  });

  it('shows lengths in the chosen unit and number of decimals', () => {
    setDisplaySettings({ unit: 'm', decimals: 3 });
    expect(formatLength(1234)).toBe('1.234 m');
    setDisplaySettings({ unit: 'cm', decimals: 1 });
    expect(formatLength(125)).toBe('12.5 cm');
    setDisplaySettings({ unit: 'in', decimals: 2 });
    expect(formatLength(25.4)).toBe('1 in');
    expect(formatLength(38.1)).toBe('1.5 in');
    setDisplaySettings({ unit: 'mm', decimals: 0 });
    expect(formatLength(12.6)).toBe('13 mm');
  });

  it('trims numbers and writes drawing dimensions as precisely as their size needs', () => {
    expect(trimNumber(12.0, 2)).toBe('12');
    expect(trimNumber(12.3456, 2)).toBe('12.35');
    expect(formatDimension(4000.2)).toBe('4000');
    expect(formatDimension(45.67)).toBe('45.7');
    expect(formatDimension(7.456)).toBe('7.46');
  });
});
