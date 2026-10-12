import type { Navigator } from './Navigator';
import type { Viewport } from '../viewport/Viewport';
import type { History } from '../core/history';

export interface ToolContext {
  viewport: Viewport;
  navigator: Navigator;
  history: History;
  setHint(text: string): void;
}

/**
 * A modelling or navigation tool. Receives left-button pointer events on the
 * viewport; the middle button is always handled by the navigator.
 */
export interface Tool {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  readonly hint: string;
  readonly cursor: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(e: PointerEvent): void;
  pointerMove?(e: PointerEvent): void;
  pointerUp?(e: PointerEvent): void;
  /** Return true when the key was handled. */
  keyDown?(e: KeyboardEvent): boolean;
}
