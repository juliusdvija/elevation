import { Emitter } from './emitter';

/**
 * A reversible change to the model. `apply` must be safe to call again
 * after `revert` (that is how redo works).
 */
export interface Operation {
  apply(): void;
  revert(): void;
}

export interface Transaction {
  readonly label: string;
  readonly ops: readonly Operation[];
}

export type HistoryEvent =
  | { kind: 'commit'; transaction: Transaction }
  | { kind: 'undo'; transaction: Transaction }
  | { kind: 'redo'; transaction: Transaction };

/** Handle passed into a running transaction to record operations. */
export interface TransactionScope {
  /** Applies the operation immediately and records it for undo. */
  run(op: Operation): void;
}

/**
 * Every model edit runs inside a transaction: one user action is one undo step,
 * and listeners get one change event per action (this is what the drawing
 * engine will listen to for live updates).
 */
export class History {
  readonly changed = new Emitter<HistoryEvent>();

  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private open: { label: string; ops: Operation[] } | null = null;

  constructor(private readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  get inTransaction(): boolean {
    return this.open !== null;
  }

  /**
   * Runs `fn` as one undoable step. Nested calls join the outer transaction.
   * If `fn` throws, everything it did is reverted and the error rethrown.
   */
  transact<T>(label: string, fn: (scope: TransactionScope) => T): T {
    if (this.open) {
      const ops = this.open.ops;
      return fn({ run: (op) => runOp(op, ops) });
    }

    const open = { label, ops: [] as Operation[] };
    this.open = open;
    let result: T;
    try {
      result = fn({ run: (op) => runOp(op, open.ops) });
    } catch (error) {
      for (const op of [...open.ops].reverse()) op.revert();
      throw error;
    } finally {
      this.open = null;
    }

    if (open.ops.length > 0) {
      const transaction: Transaction = { label, ops: open.ops };
      this.undoStack.push(transaction);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.changed.emit({ kind: 'commit', transaction });
    }
    return result;
  }

  undo(): boolean {
    if (this.open) throw new Error('Cannot undo during a transaction');
    const transaction = this.undoStack.pop();
    if (!transaction) return false;
    for (const op of [...transaction.ops].reverse()) op.revert();
    this.redoStack.push(transaction);
    this.changed.emit({ kind: 'undo', transaction });
    return true;
  }

  redo(): boolean {
    if (this.open) throw new Error('Cannot redo during a transaction');
    const transaction = this.redoStack.pop();
    if (!transaction) return false;
    for (const op of transaction.ops) op.apply();
    this.undoStack.push(transaction);
    this.changed.emit({ kind: 'redo', transaction });
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

function runOp(op: Operation, ops: Operation[]): void {
  op.apply();
  ops.push(op);
}
