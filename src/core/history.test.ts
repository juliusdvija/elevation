import { describe, expect, it, vi } from 'vitest';
import { History, type Operation } from './history';

function setter(state: { value: number }, next: number): Operation {
  let previous = 0;
  return {
    apply: () => {
      previous = state.value;
      state.value = next;
    },
    revert: () => {
      state.value = previous;
    },
  };
}

describe('History', () => {
  it('undoes and redoes a transaction as one step', () => {
    const state = { value: 0 };
    const history = new History();
    history.transact('Set twice', (tx) => {
      tx.run(setter(state, 1));
      tx.run(setter(state, 2));
    });
    expect(state.value).toBe(2);

    history.undo();
    expect(state.value).toBe(0);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(state.value).toBe(2);
  });

  it('reverts everything when the transaction throws', () => {
    const state = { value: 0 };
    const history = new History();
    expect(() =>
      history.transact('Broken', (tx) => {
        tx.run(setter(state, 5));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(state.value).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('joins nested transactions into the outer one', () => {
    const state = { value: 0 };
    const history = new History();
    history.transact('Outer', (tx) => {
      tx.run(setter(state, 1));
      history.transact('Inner', (inner) => inner.run(setter(state, 2)));
    });
    expect(history.undoLabel).toBe('Outer');
    history.undo();
    expect(state.value).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('does not record empty transactions and clears redo on a new commit', () => {
    const state = { value: 0 };
    const history = new History();
    const listener = vi.fn();
    history.changed.on(listener);

    history.transact('Nothing', () => {});
    expect(history.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    history.transact('A', (tx) => tx.run(setter(state, 1)));
    history.undo();
    history.transact('B', (tx) => tx.run(setter(state, 3)));
    expect(history.canRedo).toBe(false);
    expect(listener.mock.calls.map(([e]) => e.kind)).toEqual(['commit', 'undo', 'commit']);
  });

  it('drops the oldest steps beyond the limit', () => {
    const state = { value: 0 };
    const history = new History(2);
    for (const n of [1, 2, 3]) history.transact(`Set ${n}`, (tx) => tx.run(setter(state, n)));
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    expect(state.value).toBe(1);
  });
});
