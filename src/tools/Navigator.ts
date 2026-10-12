import type * as THREE from 'three';
import type { Viewport } from '../viewport/Viewport';

export type NavigationMode = 'orbit' | 'pan';

const ORBIT_SPEED = 0.006; // radians per pixel
const WHEEL_SPEED = 0.0015;

/** Camera navigation shared by the middle mouse button and the Orbit/Pan tools. */
export class Navigator {
  private drag: { mode: NavigationMode; pivot: THREE.Vector3; x: number; y: number } | null = null;

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
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(delta * WHEEL_SPEED);
    this.viewport.rig.zoomAt(this.viewport.pickPoint(e.clientX, e.clientY), factor);
    this.viewport.requestRender();
  }

  zoomExtents(): void {
    this.viewport.rig.fit(this.viewport.contentBounds());
    this.viewport.requestRender();
  }
}
