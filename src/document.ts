import { History } from './core/history';
import { Model } from './kernel/Model';

/** A model plus its undo history. All user edits go through `run`. */
export class Document {
  readonly model = new Model();
  readonly history = new History();

  /** Runs a model edit as one undoable step. */
  run<T>(label: string, fn: () => T): T {
    return this.history.transact(label, (tx) => {
      const { result, edit } = this.model.edit(fn);
      if (!edit.empty) tx.record(edit);
      return result;
    });
  }
}
