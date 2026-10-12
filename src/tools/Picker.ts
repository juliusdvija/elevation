import * as THREE from 'three';
import type { Id, Model } from '../kernel/Model';
import { closestBetweenSegments } from '../kernel/math';
import type { ModelRenderer } from '../viewport/ModelRenderer';
import type { Viewport } from '../viewport/Viewport';
import { closestOnLineToRay, intersectLines, type Line3 } from './lines';

export type Pick =
  | { kind: 'vertex'; id: Id; point: THREE.Vector3 }
  | { kind: 'guide-point'; id: Id; point: THREE.Vector3 }
  | { kind: 'origin'; point: THREE.Vector3 }
  | { kind: 'intersection'; point: THREE.Vector3 }
  | { kind: 'midpoint'; id: Id; point: THREE.Vector3 }
  | { kind: 'edge'; id: Id; point: THREE.Vector3 }
  | { kind: 'guide'; id: Id; point: THREE.Vector3 }
  | { kind: 'face'; id: Id; point: THREE.Vector3 }
  | { kind: 'ground'; point: THREE.Vector3 }
  | { kind: 'none' };

export interface FaceHit {
  id: Id;
  point: THREE.Vector3;
  distance: number;
}

export interface PickOptions {
  vertices?: boolean;
  edges?: boolean;
  guides?: boolean;
  /** Only vertices passing this filter can be picked (e.g. to skip preview geometry). */
  vertexFilter?: (id: Id) => boolean;
}

const VERTEX_RADIUS = 10; // px
const EDGE_RADIUS = 6; // px
const LINE_SEARCH_RADIUS = 14; // px, lines considered for intersections
const GROUND = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

interface NearLine {
  line: Line3;
  /** Segment bounds along the line for edges; infinite for guides. */
  t0: number;
  t1: number;
  guide: boolean;
}

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
   * What the cursor points at, in priority order: vertex, origin, guide point,
   * intersection with a guide, edge midpoint, edge, guide line, face, ground.
   * Geometry hidden behind a face is ignored.
   */
  pick(clientX: number, clientY: number, options: PickOptions = {}): Pick {
    const { vertices = true, edges = true, guides = true, vertexFilter } = options;
    const cursor = new THREE.Vector2(clientX, clientY);
    const faceHit = this.face(clientX, clientY);
    const ray = this.viewport.ray(clientX, clientY);
    const tolerance = 1 + this.viewport.rig.distance * 1e-4;
    const visible = (p: THREE.Vector3) => !faceHit || this.depth(p) <= faceHit.distance + tolerance;
    const px = (p: THREE.Vector3) => this.viewport.toScreen(p)?.distanceTo(cursor) ?? Infinity;

    if (vertices) {
      let best: { id: Id; point: THREE.Vector3; d: number } | null = null;
      for (const v of this.model.allVertices()) {
        if (vertexFilter && !vertexFilter(v.id)) continue;
        const d = px(v.position);
        if (d < VERTEX_RADIUS && (!best || d < best.d) && visible(v.position)) best = { id: v.id, point: v.position.clone(), d };
      }
      if (best) return { kind: 'vertex', id: best.id, point: best.point };

      const origin = new THREE.Vector3();
      if (px(origin) < VERTEX_RADIUS && visible(origin)) return { kind: 'origin', point: origin };
    }

    if (guides) {
      for (const g of this.model.allGuides()) {
        if (g.kind === 'point' && px(g.point) < VERTEX_RADIUS && visible(g.point)) {
          return { kind: 'guide-point', id: g.id, point: g.point.clone() };
        }
      }
    }

    // Lines near the cursor, for edges, guides and their intersections.
    const near: (NearLine & { id: Id; point: THREE.Vector3; d: number })[] = [];
    const far = ray.origin.clone().addScaledVector(ray.direction, 1e8);
    if (edges) {
      for (const e of this.model.allEdges()) {
        const a = this.model.position(e.a);
        const b = this.model.position(e.b);
        const { s } = closestBetweenSegments(a, b, ray.origin, far);
        const point = a.clone().lerp(b, s);
        const d = px(point);
        if (d > LINE_SEARCH_RADIUS || !visible(point)) continue;
        const length = a.distanceTo(b);
        near.push({ id: e.id, point, d, line: { point: a, direction: b.clone().sub(a).normalize() }, t0: 0, t1: length, guide: false });
      }
    }
    if (guides) {
      for (const g of this.model.allGuides()) {
        if (g.kind !== 'line') continue;
        const line = { point: g.point, direction: g.direction };
        const point = closestOnLineToRay(line, ray);
        const d = px(point);
        if (d > LINE_SEARCH_RADIUS || !visible(point)) continue;
        near.push({ id: g.id, point, d, line, t0: -Infinity, t1: Infinity, guide: true });
      }
    }

    // Intersections involving a guide (edges already meet at vertices).
    let crossing: { point: THREE.Vector3; d: number } | null = null;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const [p, q] = [near[i], near[j]];
        if (!p.guide && !q.guide) continue;
        const x = intersectLines(p.line, q.line);
        if (!x || !onSpan(p, x) || !onSpan(q, x)) continue;
        const d = px(x);
        if (d < VERTEX_RADIUS && (!crossing || d < crossing.d) && visible(x)) crossing = { point: x, d };
      }
    }
    if (crossing) return { kind: 'intersection', point: crossing.point };

    const nearestEdge = near.filter((n) => !n.guide && n.d < EDGE_RADIUS).sort((a, b) => a.d - b.d)[0];
    if (nearestEdge) {
      const e = this.model.edge(nearestEdge.id);
      const mid = this.model.position(e.a).clone().lerp(this.model.position(e.b), 0.5);
      if (px(mid) < VERTEX_RADIUS) return { kind: 'midpoint', id: e.id, point: mid };
      return { kind: 'edge', id: e.id, point: nearestEdge.point };
    }

    const nearestGuide = near.filter((n) => n.guide && n.d < EDGE_RADIUS).sort((a, b) => a.d - b.d)[0];
    if (nearestGuide) return { kind: 'guide', id: nearestGuide.id, point: nearestGuide.point };

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

function onSpan(n: NearLine, p: THREE.Vector3): boolean {
  const t = p.clone().sub(n.line.point).dot(n.line.direction);
  return t >= n.t0 - 0.5 && t <= n.t1 + 0.5;
}
