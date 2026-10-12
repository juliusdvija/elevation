import * as THREE from 'three';
import type { Id, Model } from '../kernel/Model';
import { closestBetweenSegments } from '../kernel/math';
import type { ModelRenderer } from '../viewport/ModelRenderer';
import type { Viewport } from '../viewport/Viewport';

export type Pick =
  | { kind: 'vertex'; id: Id; point: THREE.Vector3 }
  | { kind: 'midpoint'; id: Id; point: THREE.Vector3 }
  | { kind: 'edge'; id: Id; point: THREE.Vector3 }
  | { kind: 'face'; id: Id; point: THREE.Vector3 }
  | { kind: 'ground'; point: THREE.Vector3 }
  | { kind: 'none' };

export interface FaceHit {
  id: Id;
  point: THREE.Vector3;
  distance: number;
}

const VERTEX_RADIUS = 10; // px
const EDGE_RADIUS = 6; // px
const GROUND = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/** Finds what is under the cursor, with screen-space tolerances. */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly model: Model,
    private readonly viewport: Viewport,
    private readonly renderer: ModelRenderer,
  ) {}

  /** Nearest face under the cursor (front or back side). */
  face(clientX: number, clientY: number): FaceHit | null {
    this.raycaster.setFromCamera(this.viewport.ndc(clientX, clientY), this.viewport.rig.camera);
    const hits = this.raycaster.intersectObjects([this.renderer.front, this.renderer.back], false);
    for (const hit of hits) {
      const id = hit.faceIndex == null ? undefined : this.renderer.faceOfTriangle(hit.faceIndex);
      if (id !== undefined && this.model.hasFace(id)) return { id, point: hit.point.clone(), distance: hit.distance };
    }
    return null;
  }

  /**
   * What the cursor points at, in priority order: vertex, edge midpoint,
   * edge, face, ground plane. Geometry hidden behind a face is ignored.
   */
  pick(clientX: number, clientY: number, options: { vertices?: boolean; edges?: boolean } = {}): Pick {
    const { vertices = true, edges = true } = options;
    const cursor = new THREE.Vector2(clientX, clientY);
    const faceHit = this.face(clientX, clientY);
    const ray = this.viewport.ray(clientX, clientY);
    const tolerance = 1 + this.viewport.rig.distance * 1e-4;
    const visible = (p: THREE.Vector3) => !faceHit || this.depth(p) <= faceHit.distance + tolerance;

    if (vertices) {
      let best: { id: Id; point: THREE.Vector3; px: number } | null = null;
      for (const v of this.model.allVertices()) {
        const screen = this.viewport.toScreen(v.position);
        if (!screen) continue;
        const px = screen.distanceTo(cursor);
        if (px < VERTEX_RADIUS && (!best || px < best.px) && visible(v.position)) {
          best = { id: v.id, point: v.position.clone(), px };
        }
      }
      if (best) return { kind: 'vertex', id: best.id, point: best.point };
    }

    if (edges) {
      let best: { id: Id; point: THREE.Vector3; px: number; mid: THREE.Vector3 } | null = null;
      const far = ray.origin.clone().addScaledVector(ray.direction, 1e8);
      for (const e of this.model.allEdges()) {
        const a = this.model.position(e.a);
        const b = this.model.position(e.b);
        const { s } = closestBetweenSegments(a, b, ray.origin, far);
        const point = a.clone().lerp(b, s);
        const screen = this.viewport.toScreen(point);
        if (!screen) continue;
        const px = screen.distanceTo(cursor);
        if (px < EDGE_RADIUS && (!best || px < best.px) && visible(point)) {
          best = { id: e.id, point, px, mid: a.clone().lerp(b, 0.5) };
        }
      }
      if (best) {
        const midScreen = this.viewport.toScreen(best.mid);
        if (midScreen && midScreen.distanceTo(cursor) < VERTEX_RADIUS) {
          return { kind: 'midpoint', id: best.id, point: best.mid };
        }
        return { kind: 'edge', id: best.id, point: best.point };
      }
    }

    if (faceHit) return { kind: 'face', id: faceHit.id, point: faceHit.point };

    const ground = ray.intersectPlane(GROUND, new THREE.Vector3());
    return ground ? { kind: 'ground', point: ground } : { kind: 'none' };
  }

  /** Distance from the camera along the view ray to a point. */
  private depth(p: THREE.Vector3): number {
    const camera = this.viewport.rig.camera;
    if (this.viewport.rig.isOrtho) {
      // Raycast distances in ortho are measured from the near plane.
      const dir = this.viewport.rig.direction();
      const near = (camera as THREE.OrthographicCamera).near;
      return p.clone().sub(camera.position).dot(dir) - near;
    }
    return p.distanceTo(camera.position);
  }
}
