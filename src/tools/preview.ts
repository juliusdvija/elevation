import type { Operation } from '../core/history';
import type { ToolContext } from './Tool';

/**
 * Applies `fn` tentatively across all models (without an undo step) and
 * returns a handle that reverts it. Used for live previews of Move/Rotate,
 * which may edit a group's parent as well as the group.
 */
export function previewEdit(ctx: ToolContext, fn: () => void): Operation | null {
  const models = ctx.doc.allModels().filter((m) => !m.journaling);
  for (const m of models) m.beginJournal();
  try {
    fn();
  } catch (error) {
    for (const m of models) m.abortJournal();
    throw error;
  }
  const edits = models.map((m) => m.endJournal()).filter((e) => !e.empty);
  if (edits.length === 0) return null;
  return {
    apply: () => edits.forEach((e) => e.apply()),
    revert: () => [...edits].reverse().forEach((e) => e.revert()),
  };
}
