import * as THREE from 'three';
import type { Document } from '../document';
import { dimensionShape } from '../drawing/dimensions';
import type { Viewport } from './Viewport';

const COLOR = 0x1d1d1b;
const MUTED = 0x8a8780;

/** Draws the document's dimensions in 3D: extension lines, dimension line and a length label. */
export class DimensionRenderer {
  private readonly group = new THREE.Group();

  constructor(
    private readonly doc: Document,
    private readonly viewport: Viewport,
  ) {
    this.group.renderOrder = 8;
    viewport.overlay.add(this.group);
    doc.settingsChanged.on(() => this.rebuild());
    this.rebuild();
  }

  private rebuild(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
    const thin: THREE.Vector3[] = [];
    const thick: THREE.Vector3[] = [];
    for (const d of this.doc.drawingSettings.dimensions) {
      const s = dimensionShape(d);
      thin.push(s.a, s.a2, s.b, s.b2);
      thick.push(s.a2, s.b2);
      this.group.add(label(s.text, s.mid));
    }
    this.group.add(lines(thin, MUTED), lines(thick, COLOR));
    this.viewport.requestRender();
  }
}

function lines(points: THREE.Vector3[], color: number): THREE.LineSegments {
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  l.renderOrder = 8;
  l.raycast = () => {};
  return l;
}

function label(text: string, at: THREE.Vector3): THREE.Sprite {
  const scale = 3;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${13 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 10 * scale;
  const h = 20 * scale;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(244,243,239,0.9)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d1d1b';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + scale);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  const height = 0.032; // fraction of the viewport height
  sprite.scale.set((height * w) / h, height, 1);
  sprite.position.copy(at);
  sprite.renderOrder = 9;
  sprite.raycast = () => {};
  return sprite;
}

function disposeObject(o: THREE.Object3D): void {
  const m = o as THREE.Mesh;
  m.geometry?.dispose();
  const mat = m.material as THREE.Material | THREE.SpriteMaterial | undefined;
  if (mat && 'map' in mat) mat.map?.dispose();
  mat?.dispose();
}
