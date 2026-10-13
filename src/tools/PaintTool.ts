import { Emitter } from '../core/emitter';
import { paintFaces } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

/** Architectural palette: plaster, brick, timber, concrete, metal, glass, greenery. */
export const PALETTE: { name: string; color: string; opacity?: number }[] = [
  { name: 'Plaster', color: '#ece8e1' },
  { name: 'Brick', color: '#b5654a' },
  { name: 'Terracotta', color: '#cf7b5a' },
  { name: 'Timber', color: '#c19a6b' },
  { name: 'Sand', color: '#d9c7a3' },
  { name: 'Concrete', color: '#a9a9a4' },
  { name: 'Slate', color: '#5f6b73' },
  { name: 'Black metal', color: '#2b2b2b' },
  { name: 'Glass', color: '#9fc3d6', opacity: 0.4 },
  { name: 'Moss', color: '#8fae6e' },
  { name: 'Forest', color: '#4f6b52' },
  { name: 'Water', color: '#6f9bb5' },
];

/** The colour the paint tool applies (undefined clears paint). Shared with the palette. */
export class PaintState {
  readonly changed = new Emitter<void>();
  private current: string | undefined = PALETTE[1].color;
  private currentOpacity: number | undefined;

  get color(): string | undefined {
    return this.current;
  }

  /** Below 1 for glass; undefined for solid paint. */
  get opacity(): number | undefined {
    return this.currentOpacity;
  }

  set color(color: string | undefined) {
    this.set(color);
  }

  set(color: string | undefined, opacity?: number): void {
    this.current = color;
    this.currentOpacity = opacity;
    this.changed.emit();
  }
}

/**
 * Paint bucket: click a face to give it the current colour. Clicking a face
 * that is selected paints the whole selection. Alt+click picks up a face's colour.
 */
export function createPaintTool(ctx: ToolContext, state: PaintState): Tool {
  const faceAt = (e: PointerEvent): Id | null => {
    const hit = ctx.picker.face(e.clientX, e.clientY);
    return hit && ctx.picker.isContext(hit.placement) ? hit.id : null;
  };

  return {
    id: 'paint',
    label: 'Paint',
    shortcut: 'B',
    hint: 'Click a face to paint it. Click a selected face to paint the whole selection. Alt+click picks up a colour.',
    cursor: 'crosshair',

    pointerMove(e) {
      const id = faceAt(e);
      ctx.renderer.setHover(id === null ? null : { faces: [id], edges: [] });
    },

    pointerDown(e) {
      const id = faceAt(e);
      if (id === null) return;
      const model = ctx.doc.context.model;
      if (e.altKey) {
        const face = model.face(id);
        state.set(face.color, face.opacity);
        return;
      }
      const targets = ctx.selection.faces.has(id) ? [...ctx.selection.faces] : [id];
      ctx.doc.run('Paint', () => paintFaces(model, targets, state.color, state.opacity));
    },

    cancel() {
      ctx.renderer.setHover(null);
    },
    deactivate() {
      ctx.renderer.setHover(null);
    },
  };
}
