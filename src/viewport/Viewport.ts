import * as THREE from 'three';
import { CameraRig, WORLD_UP } from './CameraRig';
import { AdaptiveGrid, createAxes, niceSpacing } from './helpers';
import { theme } from './theme';

const GROUND = new THREE.Plane(WORLD_UP.clone(), 0);

/** Where a snapshot's camera stands (the saved form of a scene's camera). */
export interface SnapshotCamera {
  position: [number, number, number];
  target: [number, number, number];
  ortho: boolean;
  orthoHeight: number;
}

/**
 * Owns the WebGL renderer, the scene and the camera rig. Renders on demand:
 * call `requestRender()` after anything visible changes.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Model geometry lives here; helpers (grid, axes) do not. */
  readonly content = new THREE.Group();
  /** Tool feedback (rubber bands, previews), drawn on top. */
  readonly overlay = new THREE.Group();
  readonly rig = new CameraRig();

  /** Things that are not part of the model picture (selection, hover, guides) hide themselves while a snapshot renders. */
  readonly snapshotHooks: ((rendering: boolean) => void)[] = [];

  /** 'auto' picks a 1-2-5 spacing from the zoom; a number fixes the snap and grid spacing (mm). */
  gridMode: 'auto' | number = 'auto';

  private readonly raycaster = new THREE.Raycaster();
  private readonly adaptiveGrid = new AdaptiveGrid();
  private readonly helpers: THREE.Object3D[];
  private dirty = true;
  /** Runs just before a frame is drawn, so things that follow the camera can update. */
  beforeRender: (() => void) | null = null;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.background);
    const axes = createAxes();
    this.helpers = [this.adaptiveGrid.group, axes, this.overlay];
    this.scene.add(this.adaptiveGrid.group, axes, this.content, this.overlay);

    const hemisphere = new THREE.HemisphereLight(0xffffff, theme.ground, 2.4);
    hemisphere.position.copy(WORLD_UP);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, -0.7, 1);
    this.scene.add(hemisphere, sun);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get height(): number {
    return this.container.clientHeight;
  }

  /** The grid and snap spacing (mm) near a point: fixed, or about 36 pixels on screen. */
  gridSpacingAt(point: THREE.Vector3): number {
    if (typeof this.gridMode === 'number') return this.gridMode;
    return niceSpacing(this.rig.worldPerPixel(this.height, point) * 36);
  }

  requestRender(): void {
    this.dirty = true;
  }

  /** Normalised device coordinates for a client-space position. */
  ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /**
   * The 3D point under the cursor: model geometry first, then the ground
   * plane, then the point on the cursor ray closest to the camera target.
   * Used as the orbit pivot and zoom anchor.
   */
  pickPoint(clientX: number, clientY: number): THREE.Vector3 {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.rig.camera);
    const hit = this.raycaster
      .intersectObjects(this.content.children, true)
      .find((h) => (h.object as THREE.Mesh).isMesh);
    if (hit) return hit.point;

    const ray = this.raycaster.ray;
    const ground = ray.intersectPlane(GROUND, new THREE.Vector3());
    if (ground && ground.distanceTo(this.rig.target) < this.rig.distance * 20) return ground;

    return ray.closestPointToPoint(this.rig.target, new THREE.Vector3());
  }

  contentBounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.content);
  }

  /** Client-space position of a world point, or null when behind the camera. */
  toScreen(point: THREE.Vector3): THREE.Vector2 | null {
    const p = point.clone().project(this.rig.camera);
    if (p.z > 1 || p.z < -1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(rect.left + ((p.x + 1) / 2) * rect.width, rect.top + ((1 - p.y) / 2) * rect.height);
  }

  /** World-space ray under a client-space position. */
  ray(clientX: number, clientY: number): THREE.Ray {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.rig.camera);
    return this.raycaster.ray.clone();
  }

  /**
   * Renders the model from `camera` into a picture of `width` x `height` pixels on the paper colour,
   * without the grid, axes, selection or tool feedback, and returns it as a JPEG. The viewport's own
   * camera is put back afterwards. Null when the picture cannot be made (no GPU memory, odd size).
   */
  snapshot(camera: SnapshotCamera, width: number, height: number): { href: string; pixels: [number, number] } | null {
    const max = this.renderer.capabilities.maxTextureSize;
    width = Math.min(Math.round(width), max);
    height = Math.min(Math.round(height), max);
    if (width < 2 || height < 2 || width * height > 16_000_000) return null;

    const rig = this.rig;
    const saved = {
      position: rig.position.clone(),
      target: rig.target.clone(),
      ortho: rig.isOrtho,
      orthoHeight: rig.orthoHeight,
      aspect: this.container.clientWidth / Math.max(1, this.container.clientHeight),
    };
    const background = this.scene.background;
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    try {
      rig.position.set(...camera.position);
      rig.target.set(...camera.target);
      rig.orthoHeight = camera.orthoHeight;
      if (rig.isOrtho !== camera.ortho) rig.toggleProjection();
      rig.setAspect(width / height);
      for (const helper of this.helpers) helper.visible = false;
      for (const hook of this.snapshotHooks) hook(true);
      this.scene.background = new THREE.Color(theme.face);
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, rig.camera);
      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      // Pixels come bottom row first; flip them into a canvas.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      const image = context.createImageData(width, height);
      for (let row = 0; row < height; row++) {
        image.data.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
      }
      context.putImageData(image, 0, 0);
      return { href: canvas.toDataURL('image/jpeg', 0.92), pixels: [width, height] };
    } catch {
      return null;
    } finally {
      this.renderer.setRenderTarget(null);
      target.dispose();
      this.scene.background = background;
      for (const helper of this.helpers) helper.visible = true;
      for (const hook of this.snapshotHooks) hook(false);
      rig.position.copy(saved.position);
      rig.target.copy(saved.target);
      rig.orthoHeight = saved.orthoHeight;
      if (rig.isOrtho !== saved.ortho) rig.toggleProjection();
      rig.orthoHeight = saved.orthoHeight;
      rig.setAspect(saved.aspect);
      this.requestRender();
    }
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.requestRender();
  }

  private frame(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.beforeRender?.();
    this.adaptiveGrid.update(this.gridSpacingAt(this.rig.target), this.rig.target);
    this.renderer.render(this.scene, this.rig.camera);
  }
}
