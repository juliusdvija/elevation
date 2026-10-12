import { describe, expect, it } from 'vitest';
import { fuzz } from './fuzz';

/**
 * Random sequences of modelling operations (drawing, push/pull, move, copy,
 * rotate, erase, offset, circles, lines) must keep the model valid, undo and
 * redo exactly, and stay drawable. Seeds are fixed so failures reproduce;
 * `scripts/fuzz.test.ts` runs many more for exploration.
 */
describe('fuzz', () => {
  it('keeps the model valid through random operation sequences', () => {
    const failures = [];
    for (let seed = 1; seed <= 60; seed++) {
      const f = fuzz(seed, 25);
      if (f) failures.push(`seed ${seed} step ${f.step}: ${f.problems[0].kind} ${f.problems[0].detail.split('\n')[0]} after ${f.log.at(-1)}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
