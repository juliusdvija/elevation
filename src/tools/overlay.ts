import * as THREE from 'three';
import type { Viewport } from '../viewport/Viewport';
import { theme } from '../viewport/theme';

/** Rubber-band lines drawn on top of the model. */
export class PreviewLines {
  private readonly lines: THREE.LineSegments;

  constructor(private readonly viewport: Viewport) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: theme.preview, depthTest: false, transparent: true }),
    );
    this.lines.renderOrder = 10;
    this.lines.raycast = () => {};
    viewport.overlay.add(this.lines);
  }

  set(segments: [THREE.Vector3, THREE.Vector3][], color: number = theme.preview): void {
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setFromPoints(segments.flat());
    (this.lines.material as THREE.LineBasicMaterial).color.set(color);
    this.viewport.requestRender();
  }

  clear(): void {
    this.set([]);
  }
}

export type SnapKind =
  | 'vertex'
  | 'midpoint'
  | 'edge'
  | 'face'
  | 'ground'
  | 'axis-x'
  | 'axis-y'
  | 'axis-z'
  | 'parallel'
  | 'perpendicular'
  | 'from-point'
  | 'intersection'
  | 'guide'
  | 'guide-point'
  | 'square';

const SNAP_LABELS: Record<SnapKind, string> = {
  vertex: 'Endpoint',
  midpoint: 'Midpoint',
  edge: 'On Edge',
  face: 'On Face',
  ground: '',
  'axis-x': 'On Red Axis',
  'axis-y': 'On Green Axis',
  'axis-z': 'On Blue Axis',
  parallel: 'Parallel to Edge',
  perpendicular: 'Perpendicular to Edge',
  'from-point': 'From Point',
  intersection: 'Intersection',
  guide: 'On Guide',
  'guide-point': 'Guide Point',
  square: 'Square',
};

/** Dotted inference lines (alignment with remembered points, projections). */
export class GuideLines {
  private readonly lines: THREE.LineSegments;

  constructor(private readonly viewport: Viewport) {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.lines.renderOrder = 9;
    this.lines.raycast = () => {};
    viewport.overlay.add(this.lines);
  }

  set(segments: { from: THREE.Vector3; to: THREE.Vector3; color?: number }[]): void {
    this.lines.geometry.dispose();
    const points = segments.flatMap((s) => [s.from, s.to]);
    const colors = segments.flatMap((s) => {
      const c = new THREE.Color(s.color ?? 0x6f6d67);
      return [c.r, c.g, c.b, c.r, c.g, c.b];
    });
    this.lines.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = this.lines.material as THREE.LineDashedMaterial;
    if (segments.length > 0) {
      // Keep dashes about 4 px long whatever the zoom level.
      const mid = segments[0].from.clone().lerp(segments[0].to, 0.5);
      const perPixel = this.viewport.rig.worldPerPixel(this.viewport.height, mid);
      material.dashSize = perPixel * 4;
      material.gapSize = perPixel * 4;
      this.lines.computeLineDistances();
    }
    this.viewport.requestRender();
  }

  clear(): void {
    this.set([]);
  }
}

/** The coloured dot and label that show what the cursor snapped to. */
export class SnapMarker {
  private readonly el: HTMLDivElement;
  private readonly label: HTMLSpanElement;

  constructor(private readonly viewport: Viewport) {
    this.el = document.createElement('div');
    this.el.className = 'snap-marker';
    this.label = document.createElement('span');
    this.el.append(document.createElement('i'), this.label);
    viewport.container.append(this.el);
    this.hide();
  }

  show(point: THREE.Vector3, kind: SnapKind, label?: string): void {
    const screen = this.viewport.toScreen(point);
    if (!screen) return this.hide();
    const rect = this.viewport.container.getBoundingClientRect();
    this.el.style.transform = `translate(${screen.x - rect.left}px, ${screen.y - rect.top}px)`;
    this.el.dataset.kind = kind;
    this.label.textContent = label ?? SNAP_LABELS[kind];
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
