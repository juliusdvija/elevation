import type * as THREE from 'three';
import type { Viewport } from '../viewport/Viewport';

export type NavigationMode = 'orbit' | 'pan';
/** Mouse: the wheel zooms. Trackpad: two-finger scroll orbits, Shift pans, pinch zooms. */
export type InputScheme = 'mouse' | 'trackpad';

const ORBIT_SPEED = 0.006; // radians per pixel
const WHEEL_SPEED = 0.0015;
const PINCH_SPEED = 0.01;

/** Camera navigation shared by the middle mouse button and the Orbit/Pan tools. */
export class Navigator {
  private drag: { mode: NavigationMode; pivot: THREE.Vector3; x: number; y: number } | null = null;

  scheme: InputScheme = 'mouse';

  constructor(private readonly viewport: Viewport) {}

  get active(): boolean {
    return this.drag !== null;
  }

  begin(mode: NavigationMode, e: PointerEvent): void {
    this.drag = { mode, pivot: this.viewport.pickPoint(e.clientX, e.clientY), x: e.clientX, y: e.clientY };
  }

  /** Switches between orbit and pan mid-drag (e.g. when Shift is pressed). */
  setMode(mode: NavigationMode): void {
    if (this.drag) this.drag.mode = mode;
  }

  move(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;

    const { rig } = this.viewport;
    if (drag.mode === 'orbit') rig.orbit(drag.pivot, -dx * ORBIT_SPEED, dy * ORBIT_SPEED);
    else rig.pan(dx, dy, this.viewport.height, drag.pivot);
    this.viewport.requestRender();
  }

  end(): void {
    this.drag = null;
  }

  wheel(e: WheelEvent): void {
    if (this.scheme === 'trackpad' && !e.ctrlKey) {
      // Pinch arrives as ctrl+wheel; plain two-finger scrolling orbits, with Shift it pans.
      const pivot = this.viewport.pickPoint(e.clientX, e.clientY);
      const { rig } = this.viewport;
      if (e.shiftKey) rig.pan(-(e.deltaX || e.deltaY), e.deltaX ? e.deltaY : 0, this.viewport.height, pivot);
      else rig.orbit(pivot, -e.deltaX * ORBIT_SPEED, -e.deltaY * ORBIT_SPEED);
      this.viewport.requestRender();
      return;
    }
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(delta * (e.ctrlKey ? PINCH_SPEED : WHEEL_SPEED));
    this.viewport.rig.zoomAt(this.viewport.pickPoint(e.clientX, e.clientY), factor);
    this.viewport.requestRender();
  }

  zoomExtents(): void {
    this.viewport.rig.fit(this.viewport.contentBounds());
    this.viewport.requestRender();
  }
}
