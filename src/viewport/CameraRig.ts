import * as THREE from 'three';

/** World is Z-up and measured in millimetres, like SketchUp. */
export const WORLD_UP = new THREE.Vector3(0, 0, 1);

const MIN_POLAR = 1e-3;
const VERTICAL_DOT = 1 - 1e-9;
const FOV = 35;

export type StandardView = 'top' | 'front' | 'back' | 'left' | 'right' | 'iso';

const STANDARD_VIEWS: Record<StandardView, { dir: THREE.Vector3; topUp?: THREE.Vector3 }> = {
  top: { dir: new THREE.Vector3(0, 0, -1), topUp: new THREE.Vector3(0, 1, 0) },
  front: { dir: new THREE.Vector3(0, 1, 0) },
  back: { dir: new THREE.Vector3(0, -1, 0) },
  left: { dir: new THREE.Vector3(1, 0, 0) },
  right: { dir: new THREE.Vector3(-1, 0, 0) },
  iso: { dir: new THREE.Vector3(-1, 1, -0.8).normalize() },
};

/**
 * Camera state plus the navigation maths (orbit, pan, zoom, fit), kept free of
 * DOM code so it can be unit tested. Holds a perspective and an orthographic
 * camera and keeps both in sync; `camera` is whichever is active.
 */
export class CameraRig {
  readonly perspective = new THREE.PerspectiveCamera(FOV, 1, 1, 1e8);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e7, 1e7);

  readonly position = new THREE.Vector3(9000, -14000, 8000);
  readonly target = new THREE.Vector3(0, 0, 1000);

  isOrtho = false;
  /** Visible world height in ortho mode. */
  orthoHeight = 10000;

  /** Screen-up direction used when looking straight down or up. */
  private readonly topUp = new THREE.Vector3(0, 1, 0);
  private aspect = 1;

  constructor() {
    this.update();
  }

  get camera(): THREE.Camera {
    return this.isOrtho ? this.orthographic : this.perspective;
  }

  get distance(): number {
    return this.position.distanceTo(this.target);
  }

  direction(out = new THREE.Vector3()): THREE.Vector3 {
    return out.subVectors(this.target, this.position).normalize();
  }

  /** Screen-up vector currently used for `lookAt`. */
  up(out = new THREE.Vector3()): THREE.Vector3 {
    const dir = this.direction();
    return Math.abs(dir.dot(WORLD_UP)) > VERTICAL_DOT ? out.copy(this.topUp) : out.copy(WORLD_UP);
  }

  /** Screen-right vector in world space. */
  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.crossVectors(this.direction(), this.up()).normalize();
  }

  /** Screen-up vector in world space (perpendicular to the view direction). */
  screenUp(out = new THREE.Vector3()): THREE.Vector3 {
    return out.crossVectors(this.right(), this.direction()).normalize();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.update();
  }

  /**
   * Turntable orbit around `pivot`: `azimuth` around world Z, `elevation`
   * tilts the view (positive looks more from above). Tilt stops just short of
   * straight up/down so the horizon never flips.
   */
  orbit(pivot: THREE.Vector3, azimuth: number, elevation: number): void {
    if (azimuth !== 0) {
      this.rotateAround(pivot, WORLD_UP, azimuth);
      this.topUp.applyAxisAngle(WORLD_UP, azimuth);
    }

    if (elevation !== 0) {
      const dir = this.direction();
      const polar = Math.acos(THREE.MathUtils.clamp(dir.dot(WORLD_UP), -1, 1));
      const nextPolar = THREE.MathUtils.clamp(polar + elevation, MIN_POLAR, Math.PI - MIN_POLAR);
      const applied = nextPolar - polar;
      if (applied !== 0) {
        // Leaving a vertical view: remember the heading so it stays continuous.
        const right = this.right();
        this.rotateAround(pivot, right, -applied);
      }
    }

    this.syncTopUp();
    this.update();
  }

  /** Moves the camera so the scene follows the cursor by (dx, dy) CSS pixels. */
  pan(dx: number, dy: number, viewportHeight: number, depthPoint: THREE.Vector3): void {
    const perPixel = this.worldPerPixel(viewportHeight, depthPoint);
    const offset = this.right()
      .multiplyScalar(-dx * perPixel)
      .addScaledVector(this.screenUp(), dy * perPixel);
    this.position.add(offset);
    this.target.add(offset);
    this.update();
  }

  /**
   * Zooms towards `point` (which stays under the cursor). `factor` < 1 zooms in.
   */
  zoomAt(point: THREE.Vector3, factor: number): void {
    if (this.isOrtho) {
      const dir = this.direction();
      const toPoint = new THREE.Vector3().subVectors(point, this.position);
      toPoint.addScaledVector(dir, -toPoint.dot(dir));
      const shift = toPoint.multiplyScalar(1 - factor);
      this.position.add(shift);
      this.target.add(shift);
      this.orthoHeight = THREE.MathUtils.clamp(this.orthoHeight * factor, 1, 1e8);
    } else {
      const distanceToPoint = this.position.distanceTo(point);
      // Do not fly through the point or out to infinity.
      if (factor < 1 && distanceToPoint * factor < 10) return;
      if (factor > 1 && distanceToPoint * factor > 5e7) return;
      this.position.sub(point).multiplyScalar(factor).add(point);
      this.target.sub(point).multiplyScalar(factor).add(point);
    }
    this.update();
  }

  /** Looks along a standard direction, keeping the current target and distance. */
  setView(view: StandardView): void {
    const { dir, topUp } = STANDARD_VIEWS[view];
    const distance = this.distance;
    this.position.copy(this.target).addScaledVector(dir, -distance);
    if (topUp) this.topUp.copy(topUp);
    this.syncTopUp();
    this.update();
  }

  /** Frames `box` while keeping the current view direction ("Zoom Extents"). */
  fit(box: THREE.Box3, margin = 1.15): void {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 100) * margin;
    const dir = this.direction();
    const halfV = THREE.MathUtils.degToRad(FOV / 2);
    const halfH = Math.atan(Math.tan(halfV) * this.aspect);
    const distance = radius / Math.sin(Math.min(halfV, halfH));

    this.target.copy(sphere.center);
    this.position.copy(sphere.center).addScaledVector(dir, -distance);
    this.orthoHeight = (2 * radius) / Math.min(1, this.aspect);
    this.update();
  }

  /** Switches projection while keeping the target at the same apparent size. */
  toggleProjection(): void {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    if (this.isOrtho) {
      const distance = this.orthoHeight / (2 * tanHalf);
      const dir = this.direction();
      this.position.copy(this.target).addScaledVector(dir, -distance);
    } else {
      this.orthoHeight = 2 * this.distance * tanHalf;
    }
    this.isOrtho = !this.isOrtho;
    this.update();
  }

  /** World units per CSS pixel at the depth of `point`. */
  worldPerPixel(viewportHeight: number, point: THREE.Vector3): number {
    if (this.isOrtho) return this.orthoHeight / viewportHeight;
    const depth = Math.max(new THREE.Vector3().subVectors(point, this.position).dot(this.direction()), 1);
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / viewportHeight;
  }

  /** Pushes rig state into both three.js cameras. */
  update(): void {
    const up = this.up();
    for (const camera of [this.perspective, this.orthographic]) {
      camera.position.copy(this.position);
      camera.up.copy(up);
      camera.lookAt(this.target);
    }

    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();

    const halfH = this.orthoHeight / 2;
    const halfW = halfH * this.aspect;
    this.orthographic.left = -halfW;
    this.orthographic.right = halfW;
    this.orthographic.top = halfH;
    this.orthographic.bottom = -halfH;
    this.orthographic.updateProjectionMatrix();

    this.perspective.updateMatrixWorld();
    this.orthographic.updateMatrixWorld();
  }

  private rotateAround(pivot: THREE.Vector3, axis: THREE.Vector3, angle: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    this.position.sub(pivot).applyQuaternion(q).add(pivot);
    this.target.sub(pivot).applyQuaternion(q).add(pivot);
  }

  /**
   * While not looking straight down, keep `topUp` pointing along the
   * horizontal view heading, so dropping into a top view keeps the scene
   * oriented the way it was.
   */
  private syncTopUp(): void {
    const dir = this.direction();
    if (Math.abs(dir.dot(WORLD_UP)) > VERTICAL_DOT) return;
    const heading = new THREE.Vector3(dir.x, dir.y, 0);
    if (heading.lengthSq() < 1e-12) return;
    // Looking down, screen-up points forward; looking up, it points backward.
    this.topUp.copy(heading.normalize().multiplyScalar(dir.z <= 0 ? 1 : -1));
  }
}
