import { describe, expect, it } from 'vitest';
import { parseFactors } from './ScaleTool';

describe('typed scale factors', () => {
  it('reads one factor for all axes, with a decimal point or comma', () => {
    expect(parseFactors('2')?.toArray()).toEqual([2, 2, 2]);
    expect(parseFactors('0.5')?.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(parseFactors('0,5')?.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(parseFactors('-1')?.toArray()).toEqual([-1, -1, -1]);
  });

  it('reads three factors, a negative one flipping that axis', () => {
    expect(parseFactors('1,-1,1')?.toArray()).toEqual([1, -1, 1]);
    expect(parseFactors('2, 1, 0.5')?.toArray()).toEqual([2, 1, 0.5]);
    expect(parseFactors('1 -1 1')?.toArray()).toEqual([1, -1, 1]);
  });

  it('refuses zero, two numbers and words', () => {
    expect(parseFactors('0')).toBeNull();
    expect(parseFactors('1,0,1')).toBeNull();
    expect(parseFactors('1 2')).toBeNull();
    expect(parseFactors('big')).toBeNull();
    expect(parseFactors('')).toBeNull();
  });
});
