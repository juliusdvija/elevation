import * as THREE from 'three';
import { DenoiseMaterial, PhysicalCamera, ShapedAreaLight, WebGLPathTracer } from 'three-gpu-pathtracer';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Material } from '../core/materials';

/** What the ray tracer is given each time something changes: the meshes of the photorealistic view and its lighting. */
export interface TracedScene {
  /** The realistic view's meshes, each with its catalogue material in `userData.material`. */
  meshes: THREE.Mesh[];
  /** The realistic view's ground (a disc around the model, maybe with a hole for a sunken site). */
  ground: THREE.Mesh;
}

/** Depth of field: the lens opening (f-number) and the distance in focus (mm, along the view). */
export interface DepthOfField {
  fStop: number;
  focus: number;
}

/** How far away the sun disc is placed (mm) and its apparent radius: a little larger than the real 0.27° for softer, pleasing shadow edges. */
const SUN_DISTANCE = 1e7;
const SUN_RADIUS = (0.6 * Math.PI) / 180;

/**
 * Progressive path tracing of the photorealistic view (three-gpu-pathtracer): light bounces between surfaces,
 * glass refracts, and the picture refines while the camera rests. It traces a scene of its own that shares the
 * realistic view's geometry, with materials adjusted for ray tracing (glass transmits instead of fading out), the
 * same sky as environment and background, and the sun as a small bright disc far away (soft shadow edges, unlike a
 * directional light). The result is a linear HDR texture (`texture`) that the realistic view finishes with its look.
 * An optional physical camera gives depth of field.
 */
export class PathTracer {
  private readonly tracer: WebGLPathTracer;
  private readonly scene = new THREE.Scene();
  private readonly content = new THREE.Group();
  private readonly sun = new ShapedAreaLight(0xffffff, 1, 1, 1);
  private readonly lens = new PhysicalCamera();
  private depthOfField: DepthOfField | null = null;
  private readonly lastLens = { fStop: 0, focus: 0 };
  private readonly moon = new THREE.DirectionalLight();
  private readonly materials = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  private sky: THREE.WebGLCubeRenderTarget | null = null;
  private readonly lastView = new THREE.Matrix4();
  private readonly lastProjection = new THREE.Matrix4();
  private camera: THREE.Camera | null = null;
  private sceneDirty = true;
  private environmentDirty = true;
  private lightsDirty = true;
  /** Stop after this many samples per pixel. */
  maxSamples = 256;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    fallback: () => void,
  ) {
    this.tracer = new WebGLPathTracer(renderer);
    this.tracer.tiles.set(2, 2);
    this.tracer.minSamples = 3;
    this.tracer.renderDelay = 120;
    this.tracer.fadeDuration = 300;
    this.tracer.filterGlossyFactor = 0.5;
    this.tracer.rasterizeSceneCallback = () => fallback();
    // The realistic view finishes the picture itself (look, bloom, grade), so nothing is drawn to the canvas here.
    this.tracer.renderToCanvas = false;
    this.sun.isCircular = true;
    this.lens.apertureBlades = 6;
    this.scene.add(this.content, this.sun, this.moon);
    // The sky is drawn Y-up; the model is Z-up.
    this.scene.environmentRotation.set(-Math.PI / 2, 0, 0);
    this.scene.backgroundRotation.set(-Math.PI / 2, 0, 0);
  }

  get samples(): number {
    return Math.floor(this.tracer.samples);
  }

  /** The accumulated picture (linear light, before tone mapping). */
  get texture(): THREE.Texture {
    return this.tracer.target.texture;
  }

  /** Whether there are enough samples to show the traced picture rather than the real-time one. */
  get ready(): boolean {
    return !this.sceneDirty && this.tracer.samples >= 2;
  }

  /** An edge-preserving blur that smooths the grain of a picture with few samples (a pass for the finishing chain). */
  denoisePass(): ShaderPass {
    return new ShaderPass(new DenoiseMaterial() as unknown as THREE.ShaderMaterial, 'map');
  }

  /** Depth of field for perspective views (null: everything sharp). */
  setDepthOfField(dof: DepthOfField | null): void {
    this.depthOfField = dof;
  }

  /** Whether more samples are still to come (the viewport keeps drawing frames until then). */
  get refining(): boolean {
    return this.sceneDirty || this.environmentDirty || this.lightsDirty || this.tracer.samples < this.maxSamples;
  }

  set bounces(n: number) {
    if (this.tracer.bounces === n) return;
    this.tracer.bounces = n;
    this.tracer.transmissiveBounces = Math.max(n, 6);
    this.tracer.reset();
  }

  /** New geometry or materials: the scene is rebuilt (and its ray-tracing structure) before the next frame. */
  setScene({ meshes, ground }: TracedScene): void {
    for (const child of [...this.content.children]) this.content.remove(child);
    for (const mesh of meshes) {
      const copy = new THREE.Mesh(mesh.geometry, this.tracedMaterial(mesh.material as THREE.MeshPhysicalMaterial, mesh.userData.material as Material | undefined));
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(mesh.matrixWorld);
      this.content.add(copy);
    }
    this.content.add(new THREE.Mesh(ground.geometry, ground.material));
    this.sceneDirty = true;
  }

  /**
   * The sky and how strongly it lights the model and shows behind it: the time-of-day sky scene (Y-up, rendered to a
   * cube map) or a photographed panorama, turned by `rotation` (Y-up to Z-up and about the vertical).
   */
  setSky(source: THREE.Scene | THREE.Texture, rotation: THREE.Euler, environmentIntensity: number, backgroundIntensity: number): void {
    let texture: THREE.Texture;
    if (source instanceof THREE.Scene) {
      // A fresh target each time: the tracer notices a new environment by its identity.
      const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      new THREE.CubeCamera(0.1, 100, target).update(this.renderer, source);
      this.sky?.dispose();
      this.sky = target;
      texture = target.texture;
    } else {
      texture = source;
    }
    this.scene.environment = texture;
    this.scene.background = texture;
    this.scene.environmentRotation.copy(rotation);
    this.scene.backgroundRotation.copy(rotation);
    this.setSkyIntensity(environmentIntensity, backgroundIntensity);
  }

  setSkyIntensity(environmentIntensity: number, backgroundIntensity: number): void {
    this.scene.environmentIntensity = environmentIntensity;
    this.scene.backgroundIntensity = backgroundIntensity;
    this.environmentDirty = true;
  }

  /**
   * The sun (as the real-time view's directional light: colour, strength, direction) and the moon. The sun becomes a
   * disc far off in its direction, as bright as needed to give the same light: radiance = irradiance / solid angle.
   */
  setLights(lights: { sun: THREE.DirectionalLight; sunDirection: THREE.Vector3; moon: THREE.DirectionalLight; centre: THREE.Vector3 }): void {
    const radius = Math.tan(SUN_RADIUS) * SUN_DISTANCE;
    const solidAngle = Math.PI * Math.tan(SUN_RADIUS) ** 2;
    this.sun.color.copy(lights.sun.color);
    this.sun.intensity = lights.sun.intensity / solidAngle;
    this.sun.width = this.sun.height = 2 * radius;
    this.sun.position.copy(lights.centre).addScaledVector(lights.sunDirection, SUN_DISTANCE);
    this.sun.lookAt(lights.centre);
    this.sun.updateMatrixWorld();
    this.sun.visible = lights.sun.intensity > 0;
    this.moon.color.copy(lights.moon.color);
    this.moon.intensity = lights.moon.intensity;
    this.moon.position.copy(lights.moon.position);
    this.moon.visible = lights.moon.intensity > 0;
    this.lightsDirty = true;
  }

  /** Starts the picture over (after something visible changed that the tracer cannot see itself). */
  restart(): void {
    this.tracer.reset();
  }

  /** Draws one more sample for `camera` (or the finished picture again), showing the fallback while it is too noisy. */
  render(camera: THREE.Camera): void {
    if (this.sceneDirty) {
      this.tracer.setScene(this.scene, camera);
      this.sceneDirty = this.environmentDirty = this.lightsDirty = false;
      this.camera = camera;
      this.remember(camera);
    }
    if (this.environmentDirty) {
      this.tracer.updateEnvironment();
      this.environmentDirty = false;
    }
    if (this.lightsDirty) {
      this.tracer.updateLights();
      this.lightsDirty = false;
    }
    const dof = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? this.depthOfField : null;
    const lensChanged = (dof?.fStop ?? 0) !== this.lastLens.fStop || (dof?.focus ?? 0) !== this.lastLens.focus;
    if (camera !== this.camera || lensChanged || !camera.matrixWorld.equals(this.lastView) || !camera.projectionMatrix.equals(this.lastProjection)) {
      this.camera = camera;
      this.remember(camera);
      this.lastLens.fStop = dof?.fStop ?? 0;
      this.lastLens.focus = dof?.focus ?? 0;
      if (dof) {
        // A physical camera with the same view, a lens opening and a focus distance.
        const source = camera as THREE.PerspectiveCamera;
        this.lens.copy(source as PhysicalCamera);
        // The tracer takes the lens opening in millimetres for a world in metres; ours is in millimetres.
        this.lens.fStop = dof.fStop / 1000;
        this.lens.focusDistance = dof.focus;
        this.lens.apertureBlades = 6;
        this.lens.matrixWorld.copy(source.matrixWorld);
        this.lens.updateProjectionMatrix();
        this.tracer.setCamera(this.lens);
      } else {
        this.tracer.setCamera(camera);
      }
    }
    this.tracer.pausePathTracing = this.tracer.samples >= this.maxSamples;
    this.tracer.renderSample();
  }

  dispose(): void {
    this.tracer.dispose();
    this.sky?.dispose();
    for (const material of this.materials.values()) material.dispose();
  }

  private remember(camera: THREE.Camera): void {
    this.lastView.copy(camera.matrixWorld);
    this.lastProjection.copy(camera.projectionMatrix);
  }

  /** The realistic material as the ray tracer needs it: see-through things transmit and refract instead of fading. */
  private tracedMaterial(source: THREE.MeshPhysicalMaterial, m: Material | undefined): THREE.MeshPhysicalMaterial {
    let traced = this.materials.get(source);
    if (traced) return traced;
    traced = source.clone();
    const glass = source.transparent;
    const transmission = m?.transmission ?? (glass ? 1 : 0);
    if (glass || transmission > 0) {
      traced.transparent = false;
      traced.opacity = 1;
      traced.depthWrite = true;
      traced.transmission = transmission;
      traced.ior = m?.ior ?? 1.5;
      traced.thickness = 0; // panes are single faces: thin glass
      // A pane's catalogue colour is how it looks against the room behind; as a filter it is much paler.
      if (glass) traced.color.lerp(new THREE.Color(0xffffff), 0.7);
    }
    this.materials.set(source, traced);
    return traced;
  }
}
