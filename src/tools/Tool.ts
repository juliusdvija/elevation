import type { Document } from '../document';
import type { ModelRenderer } from '../viewport/ModelRenderer';
import type { Viewport } from '../viewport/Viewport';
import type { Navigator } from './Navigator';
import type { Picker } from './Picker';
import type { Selection } from './Selection';
import type { SnapMarker } from './overlay';

export interface ToolContext {
  doc: Document;
  viewport: Viewport;
  renderer: ModelRenderer;
  navigator: Navigator;
  picker: Picker;
  selection: Selection;
  marker: SnapMarker;
  setHint(text: string): void;
  /** Shows a live value in the Measurements box (empty clears it). */
  setMeasurement(value: string): void;
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
  /** Abandons the operation in progress (Esc, undo, switching tools). */
  cancel?(): void;
  /** Receives text typed into the Measurements box; return true if accepted. */
  onMeasurement?(text: string): boolean;
}
