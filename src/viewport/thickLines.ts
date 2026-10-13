import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

/**
 * Line segments with a width in screen pixels (plain WebGL lines are always one pixel). Positions are
 * pairs of points, three numbers each, like `THREE.LineSegments`. Not pickable.
 */
export class ThickLines extends LineSegments2 {
  private readonly size = new THREE.Vector2();

  constructor(color: number, width: number, opacity = 1) {
    const material = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity });
    super(new LineSegmentsGeometry(), material);
    this.frustumCulled = false;
    this.raycast = () => {};
    this.setSegments([]);
    // The material needs the size of what is being drawn into, to turn pixels into clip space.
    this.onBeforeRender = (renderer) => {
      const target = renderer.getRenderTarget();
      if (target) this.size.set(target.width, target.height);
      else renderer.getSize(this.size);
      material.resolution.copy(this.size);
    };
  }

  setSegments(positions: ArrayLike<number>): void {
    this.geometry.dispose();
    const geometry = new LineSegmentsGeometry();
    if (positions.length >= 6) {
      geometry.setPositions(Array.from(positions));
    } else {
      geometry.setPositions([0, 0, 0, 0, 0, 0]);
      geometry.instanceCount = 0;
    }
    this.geometry = geometry;
  }
}
