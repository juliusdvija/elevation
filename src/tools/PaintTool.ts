import { Emitter } from '../core/emitter';
import { MATERIALS } from '../core/materials';
import { paintFaces } from '../kernel/cleanup';
import type { Id } from '../kernel/Model';
import type { Tool, ToolContext } from './Tool';

/** Architectural palette: the material catalogue (a colour, and for most a hatch pattern shown in drawings). */
export const PALETTE: { name: string; color: string; opacity?: number; hatch?: string; material: string }[] = MATERIALS.map((m) => ({
  name: m.name,
  color: m.color,
  opacity: m.opacity,
  hatch: m.hatch,
  material: m.id,
}));

/** The colour the paint tool applies (undefined clears paint). Shared with the palette. */
export class PaintState {
  readonly changed = new Emitter<void>();
  private current: string | undefined = PALETTE[1].color;
  private currentOpacity: number | undefined;
  private currentHatch: string | undefined;
  private currentMaterial: string | undefined = PALETTE[1].material;
  /** Whether materials bring their hatch pattern along (on by default). */
  patterns = true;

  get color(): string | undefined {
    return this.current;
  }

  /** Below 1 for glass; undefined for solid paint. */
  get opacity(): number | undefined {
    return this.currentOpacity;
  }

  /** The hatch pattern for drawings, when patterns are on. */
  get hatch(): string | undefined {
    return this.patterns ? this.currentHatch : undefined;
  }

  /** The catalogue material (for the photorealistic view); undefined for plain paint. */
  get material(): string | undefined {
    return this.currentMaterial;
  }

  set color(color: string | undefined) {
    this.set(color);
  }

  set(color: string | undefined, opacity?: number, hatch?: string, material?: string): void {
    this.current = color;
    this.currentMaterial = material;
    this.currentOpacity = opacity;
    this.currentHatch = hatch;
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
        state.set(face.color, face.opacity, face.hatch, face.material);
        return;
      }
      const targets = ctx.selection.faces.has(id) ? [...ctx.selection.faces] : [id];
      ctx.doc.run('Paint', () => paintFaces(model, targets, state.color, state.opacity, state.hatch, state.material));
    },

    cancel() {
      ctx.renderer.setHover(null);
    },
    deactivate() {
      ctx.renderer.setHover(null);
    },
  };
}
