import { describe, expect, it } from 'vitest';
import { niceSpacing } from './helpers';

describe('grid spacing', () => {
  it('rounds up to the next 1-2-5 step', () => {
    expect(niceSpacing(0.9)).toBe(1);
    expect(niceSpacing(1.1)).toBe(2);
    expect(niceSpacing(3)).toBe(5);
    expect(niceSpacing(5.1)).toBe(10);
    expect(niceSpacing(36)).toBe(50);
    expect(niceSpacing(720)).toBe(1000);
  });

  it('works for very small and very large steps, within limits', () => {
    expect(niceSpacing(0.03)).toBe(0.1);
    expect(niceSpacing(0.3)).toBe(0.5);
    expect(niceSpacing(1e9)).toBe(100_000);
    expect(niceSpacing(0)).toBe(0.1);
  });
});
