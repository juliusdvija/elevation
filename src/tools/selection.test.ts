import { describe, expect, it } from 'vitest';
import { Selection } from './Selection';

describe('selecting dimensions', () => {
  it('holds dimensions by id, counts them as a selection, toggles them and forgets deleted ones', () => {
    const selection = new Selection();
    let changes = 0;
    selection.changed.on(() => changes++);
    expect(selection.empty).toBe(true);
    selection.add({ kind: 'dimension', id: 'd1' });
    selection.toggle({ kind: 'dimension', id: 'd2' });
    expect(selection.empty).toBe(false);
    expect([...selection.dimensions]).toEqual(['d1', 'd2']);
    selection.toggle({ kind: 'dimension', id: 'd2' });
    expect([...selection.dimensions]).toEqual(['d1']);
    selection.pruneDimensions(new Set(['d3']));
    expect(selection.dimensions.size).toBe(0);
    expect(selection.empty).toBe(true);
    selection.add({ kind: 'dimension', id: 'd3' });
    selection.clear();
    expect(selection.dimensions.size).toBe(0);
    expect(changes).toBeGreaterThanOrEqual(5);
  });
});
