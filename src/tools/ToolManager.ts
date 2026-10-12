import { Emitter } from '../core/emitter';
import type { Tool, ToolContext } from './Tool';

/**
 * Routes viewport input: middle button to the navigator (orbit, Shift to pan),
 * left button to the active tool, wheel to zoom.
 */
export class ToolManager {
  readonly changed = new Emitter<Tool>();
  private readonly tools = new Map<string, Tool>();
  private current: Tool | null = null;
  private middleDrag = false;

  constructor(private readonly ctx: ToolContext) {
    const canvas = ctx.viewport.canvas;
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.pointerUp(e));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        ctx.navigator.wheel(e);
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get active(): Tool | null {
    return this.current;
  }

  get all(): Tool[] {
    return [...this.tools.values()];
  }

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  activate(id: string): void {
    const tool = this.tools.get(id);
    if (!tool || tool === this.current) return;
    this.current?.deactivate?.();
    this.current = tool;
    tool.activate?.();
    this.ctx.viewport.canvas.style.cursor = tool.cursor;
    this.ctx.setHint(tool.hint);
    this.changed.emit(tool);
  }

  /** Abandons whatever the active tool is doing. */
  cancel(): void {
    this.current?.cancel?.();
  }

  /** Gives the active tool first refusal, then matches tool shortcuts. */
  keyDown(e: KeyboardEvent): boolean {
    if (this.current?.keyDown?.(e)) return true;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const key = e.key === ' ' ? 'Space' : e.key.toUpperCase();
    const tool = this.all.find((t) => t.shortcut === key);
    if (!tool) return false;
    this.activate(tool.id);
    return true;
  }

  private pointerDown(e: PointerEvent): void {
    try {
      this.ctx.viewport.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; dragging still works.
    }
    if (e.button === 1) {
      e.preventDefault();
      this.middleDrag = true;
      this.ctx.navigator.begin(e.shiftKey ? 'pan' : 'orbit', e);
    } else if (e.button === 0) {
      this.current?.pointerDown?.(e);
    }
  }

  private pointerMove(e: PointerEvent): void {
    if (this.middleDrag) {
      this.ctx.navigator.setMode(e.shiftKey ? 'pan' : 'orbit');
      this.ctx.navigator.move(e);
    } else {
      this.current?.pointerMove?.(e);
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (this.ctx.viewport.canvas.hasPointerCapture(e.pointerId)) {
      this.ctx.viewport.canvas.releasePointerCapture(e.pointerId);
    }
    if (this.middleDrag && (e.button === 1 || e.type === 'pointercancel')) {
      this.middleDrag = false;
      this.ctx.navigator.end();
    } else if (e.button === 0) {
      this.current?.pointerUp?.(e);
    }
  }
}
