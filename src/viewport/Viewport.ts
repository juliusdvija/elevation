import * as THREE from 'three';
import { CameraRig, WORLD_UP } from './CameraRig';
import { createAxes, createGrid } from './helpers';
import { theme } from './theme';

const GROUND = new THREE.Plane(WORLD_UP.clone(), 0);

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

  private readonly raycaster = new THREE.Raycaster();
  private dirty = true;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.background);
    this.scene.add(createGrid(), createAxes(), this.content, this.overlay);

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
    this.renderer.render(this.scene, this.rig.camera);
  }
}
