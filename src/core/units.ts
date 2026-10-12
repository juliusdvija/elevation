/** Lengths are millimetres internally. */

const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

/** Parses "1200", "1,2m", "35 cm". Returns null for anything else. */
export function parseLength(text: string): number | null {
  const match = text.trim().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(mm|cm|m)?$/i);
  if (!match) return null;
  return Number(match[1]) * UNITS[(match[2] ?? 'mm').toLowerCase()];
}

/** Parses two lengths separated by ";" (or "x"), as typed for rectangles. */
export function parseLengthPair(text: string): [number, number] | null {
  const parts = text.split(/[;x]/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(parseLength);
  return a === null || b === null ? null : [a, b];
}

export function formatLength(mm: number): string {
  const rounded = Math.abs(mm) >= 10 ? Math.round(mm) : Math.round(mm * 10) / 10;
  return `${rounded} mm`;
}
