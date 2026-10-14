import * as THREE from 'three';
import { Emitter } from '../core/emitter';
import { CameraRig, WORLD_UP } from './CameraRig';
import { AdaptiveGrid, Ground, NorthArrow, SkyGradient, createAxes, niceSpacing } from './helpers';
import { theme } from './theme';
import { DEFAULT_SUN, type SunSettings } from '../drawing/settings';

const GROUND = new THREE.Plane(WORLD_UP.clone(), 0);

/** Where a snapshot's camera stands (the saved form of a scene's camera). */
export interface SnapshotCamera {
  position: [number, number, number];
  target: [number, number, number];
  ortho: boolean;
  orthoHeight: number;
}

/** An alternative way to draw the scene (the photorealistic view): it takes over rendering while set. */
export interface RenderMode {
  render(): void;
  resize(width: number, height: number): void;
  /** The sun moved. */
  sunChanged(): void;
  /** Whether to keep drawing frames although nothing changed (a picture that refines over time). */
  continuous?(): boolean;
}

/**
 * Owns the WebGL renderer, the scene and the camera rig. Renders on demand:
 * call `requestRender()` after anything visible changes.
 */
export const SUN_INTENSITY = 2.4;

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Model geometry lives here; helpers (grid, axes) do not. */
  readonly content = new THREE.Group();
  /** Tool feedback (rubber bands, previews), drawn on top. */
  readonly overlay = new THREE.Group();
  readonly rig = new CameraRig();
  /** The colour behind the model in the plain style. */
  readonly plainBackground = theme.background;
  /** Set while a different render style (photorealistic) is on. */
  mode: RenderMode | null = null;
  readonly hemisphere = new THREE.HemisphereLight(0xffffff, theme.ground, 1.5);

  /** Things that are not part of the model picture (selection, hover, guides) hide themselves while a snapshot renders. */
  readonly snapshotHooks: ((rendering: boolean) => void)[] = [];

  /** 'auto' picks a 1-2-5 spacing from the zoom; a number fixes the snap and grid spacing (mm). */
  gridMode: 'auto' | number = 'auto';

  private readonly raycaster = new THREE.Raycaster();
  private readonly adaptiveGrid = new AdaptiveGrid();
  private readonly ground = new Ground();
  private readonly skyGradient = new SkyGradient();
  private readonly north = new NorthArrow();
  private northAngle: number | null = null;
  /** The sun's light; the photorealistic view tints and dims it for the time of day (`restoreSunLight` puts it back). */
  readonly sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  /** Dimensions drawn highlighted: the selected ones and the one under the cursor. */
  readonly dimensionHighlight = { selected: new Set<string>(), hover: null as string | null };
  readonly dimensionHighlightChanged = new Emitter<void>();
  setDimensionHighlight(selected: Iterable<string>, hover: string | null): void {
    const next = new Set(selected);
    const same = hover === this.dimensionHighlight.hover && next.size === this.dimensionHighlight.selected.size && [...next].every((id) => this.dimensionHighlight.selected.has(id));
    if (same) return;
    this.dimensionHighlight.selected = next;
    this.dimensionHighlight.hover = hover;
    this.dimensionHighlightChanged.emit();
    this.requestRender();
  }
  /** Whether the snap grid is drawn on the ground. */
  gridVisible = false;
  /** Where the sun's light comes from (a unit vector; held at least 2° above the horizon). */
  readonly sunDirection = new THREE.Vector3();
  /** The sun's true height above the horizon in degrees (negative at night), and whether it should cast shadows. */
  sunAltitude = 0;
  sunShadows = true;
  private plainSunIntensity = SUN_INTENSITY;

  /** Sets the sun: its compass direction and height decide where it stands, and shadows can be switched off. */
  setSun(sun: SunSettings): void {
    const azimuth = (sun.azimuth * Math.PI) / 180;
    const altitude = (Math.min(90, Math.max(2, sun.altitude)) * Math.PI) / 180;
    this.sunDirection.set(Math.sin(azimuth) * Math.cos(altitude), Math.cos(azimuth) * Math.cos(altitude), Math.sin(altitude));
    // Below the horizon there is no sunlight and no shadow; near it the light fades in.
    const light = Math.min(1, Math.max(0, sun.altitude / 8));
    this.sunAltitude = sun.altitude;
    this.sunShadows = sun.shadows;
    this.plainSunIntensity = SUN_INTENSITY * light;
    this.restoreSunLight();
    this.mode?.sunChanged();
    this.requestRender();
  }

  /** The plain view's sunlight: white, fading in over the first 8° above the horizon. */
  restoreSunLight(): void {
    this.sun.color.set(0xffffff);
    this.sun.intensity = this.plainSunIntensity;
    this.sun.castShadow = this.sunShadows && this.plainSunIntensity > 0;
  }

  /** Shows an arrow pointing to true north on the ground beside the model (null hides it). */
  setNorth(angle: number | null): void {
    this.northAngle = angle;
    this.requestRender();
  }
  private readonly helpers: THREE.Object3D[];
  private readonly axes: THREE.Object3D;
  private dirty = true;
  /** Runs just before a frame is drawn, so things that follow the camera can update. */
  beforeRender: (() => void) | null = null;
  /** More things to do just before a frame, or a snapshot, is drawn (they read the camera). */
  readonly beforeFrame: (() => void)[] = [];

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.background);
    const axes = (this.axes = createAxes());
    this.helpers = [this.skyGradient.mesh, this.ground.group, this.adaptiveGrid.group, axes, this.north.group, this.overlay];
    this.scene.add(this.skyGradient.mesh, this.ground.group, this.adaptiveGrid.group, axes, this.north.group, this.content, this.overlay);

    const hemisphere = this.hemisphere;
    hemisphere.position.copy(WORLD_UP);
    this.setSun(DEFAULT_SUN);
    this.sun.position.copy(this.sunDirection);
    this.sun.shadow.mapSize.set(4096, 4096);
    this.scene.add(hemisphere, this.sun, this.sun.target);

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
      for (const hook of this.beforeFrame) hook();
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

  /** Sets the sharpness of the sun's shadows: the shadow map is `size` pixels square. */
  setShadowResolution(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.requestRender();
  }

  /** Aims the sun at the model and sizes its shadow map to just cover it, so shadows stay sharp at any scale. */
  private fitSun(): void {
    if (!this.sun.castShadow) return;
    const bounds = this.contentBounds();
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);
    this.sun.target.position.copy(sphere.center);
    this.sun.position.copy(sphere.center).addScaledVector(this.sunDirection, radius * 2);
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = radius * 0.2;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = ((radius * 2) / this.sun.shadow.mapSize.x) * 1.5;
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.mode?.resize(width, height);
    this.requestRender();
  }

  private frame(): void {
    if (!this.dirty && !this.mode?.continuous?.()) return;
    this.dirty = false;
    this.beforeRender?.();
    for (const hook of this.beforeFrame) hook();
    if (this.mode) {
      // The photorealistic view has no grid, axes or ground helper of its own kind.
      for (const helper of [this.skyGradient.mesh, this.ground.group, this.adaptiveGrid.group, this.axes, this.north.group]) helper.visible = false;
    } else {
      this.skyGradient.mesh.visible = true;
      this.skyGradient.update(this.rig.camera);
      this.ground.group.visible = true;
      this.axes.visible = true;
      this.adaptiveGrid.group.visible = this.gridVisible;
      if (this.gridVisible) this.adaptiveGrid.update(this.gridSpacingAt(this.rig.target), this.rig.target);
      this.ground.update(this.rig.target, Math.max(this.rig.perspective.far, 1e5) * 0.45);
      this.north.update(this.northAngle, this.contentBounds());
    }
    this.fitSun();
    if (this.mode) this.mode.render();
    else this.renderer.render(this.scene, this.rig.camera);
  }
}
