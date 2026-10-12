import * as THREE from 'three';
import type { ViewSetup } from '../drawing/views';
import type { Viewport } from './Viewport';

const MARGIN = 1000; // mm around the model

/** Translucent plane in the 3D view showing where a plan or section cuts. */
export class CutPlaneGizmo {
  private readonly group = new THREE.Group();
  private readonly fill: THREE.Mesh;
  private readonly outline: THREE.LineLoop;

  constructor(private readonly viewport: Viewport) {
    this.fill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x2f6fde, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.outline = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x2f6fde, transparent: true, opacity: 0.7 }),
    );
    for (const obj of [this.fill, this.outline]) obj.raycast = () => {};
    this.group.add(this.fill, this.outline);
    this.group.visible = false;
    viewport.overlay.add(this.group);
  }

  show(setup: ViewSetup | null, bounds: THREE.Box3): void {
    if (!setup || setup.cut === null || bounds.isEmpty()) {
      this.group.visible = false;
      this.viewport.requestRender();
      return;
    }
    // Span the model's extent in the view's (u, v) directions.
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const p = new THREE.Vector3(x, y, z).sub(setup.origin);
          u0 = Math.min(u0, p.dot(setup.u));
          u1 = Math.max(u1, p.dot(setup.u));
          v0 = Math.min(v0, p.dot(setup.v));
          v1 = Math.max(v1, p.dot(setup.v));
        }
      }
    }
    const corner = (u: number, v: number) =>
      setup.origin.clone().addScaledVector(setup.u, u).addScaledVector(setup.v, v).addScaledVector(setup.w, setup.cut!);
    const pts = [
      corner(u0 - MARGIN, v0 - MARGIN),
      corner(u1 + MARGIN, v0 - MARGIN),
      corner(u1 + MARGIN, v1 + MARGIN),
      corner(u0 - MARGIN, v1 + MARGIN),
    ];
    this.fill.geometry.dispose();
    this.fill.geometry = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.group.visible = true;
    this.viewport.requestRender();
  }
}
