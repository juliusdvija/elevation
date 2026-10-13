/** Lengths are millimetres internally. What the user sees and types is up to the display setting. */

export type DisplayUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** Millimetres per unit, and the suffix shown. */
export const UNIT_INFO: Record<DisplayUnit, { mm: number; suffix: string; label: string }> = {
  mm: { mm: 1, suffix: 'mm', label: 'Millimetres' },
  cm: { mm: 10, suffix: 'cm', label: 'Centimetres' },
  m: { mm: 1000, suffix: 'm', label: 'Metres' },
  in: { mm: 25.4, suffix: 'in', label: 'Inches' },
  ft: { mm: 304.8, suffix: 'ft', label: 'Feet' },
};

export interface DisplaySettings {
  unit: DisplayUnit;
  /** Digits after the decimal point; trailing zeros are dropped. */
  decimals: number;
}

let display: DisplaySettings = { unit: 'mm', decimals: 2 };

export function displaySettings(): DisplaySettings {
  return display;
}

export function setDisplaySettings(next: Partial<DisplaySettings>): void {
  display = { ...display, ...next };
}

/** Suffixes that can follow a number: the units, with ' and " for feet and inches. */
const SUFFIXES: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8 };

/**
 * Parses "1200", "1,2m", "35 cm", `6"`, "3'" or "1.5 in". A number alone is in the display unit
 * (typing 12 with centimetres on is 12 cm). Returns null for anything else.
 */
export function parseLength(text: string): number | null {
  const match = text.trim().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(mm|cm|m|in|ft|"|')?$/i);
  if (!match) return null;
  const factor = match[2] ? SUFFIXES[match[2].toLowerCase()] : UNIT_INFO[display.unit].mm;
  return Number(match[1]) * factor;
}

/** Parses two lengths separated by ";" (or "x"), as typed for rectangles. */
export function parseLengthPair(text: string): [number, number] | null {
  const parts = text.split(/[;x]/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(parseLength);
  return a === null || b === null ? null : [a, b];
}

/** A number with at most `decimals` digits after the point, without trailing zeros. */
export function trimNumber(value: number, decimals: number): string {
  const d = Math.max(0, decimals);
  if (!Number.isFinite(value) || Math.abs(value) < 1e-6) return '0'; // (numbers that print as 1e-7 cannot be shifted as text)
  // Shift by exponent instead of multiplying, so 0.075 rounds to 0.08 (0.075 * 100 is 7.499999...).
  const rounded = Math.sign(value) * Number(`${Math.round(Number(`${Math.abs(value)}e${d}`))}e-${d}`);
  const text = rounded.toFixed(d);
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
}

/** A length in the display unit with its suffix: "12.5 mm", "1.234 m". */
export function formatLength(mm: number): string {
  const info = UNIT_INFO[display.unit];
  return `${trimNumber(mm / info.mm, display.decimals)} ${info.suffix}`;
}

/** Drawing scales (the denominator: 100 is 1:100, 0.5 is 2:1). Enlarging scales are for small parts. */
export const DRAWING_SCALES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/** "1:100" for a reducing scale, "2:1" for an enlarging one. */
export function scaleLabel(scale: number): string {
  return scale >= 1 ? `1:${trimNumber(scale, 2)}` : `${trimNumber(1 / scale, 2)}:1`;
}

/** A length for a dimension on a drawing: millimetres, as precise as it needs to be (up to 2 decimals), no suffix. */
export function formatDimension(mm: number): string {
  return trimNumber(mm, Math.abs(mm) >= 100 ? 0 : Math.abs(mm) >= 10 ? 1 : 2);
}
