import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import { applyLook, createGradePass, LOOKS, type LookId } from './grading';
import { alignTurn, isHdri, loadHdri, type Hdri, type HdriId } from './hdri';
import { isReflective, PlanarReflections, reflectivePlanes } from './planarReflections';
import type { Document } from '../document';
import type { Material } from '../core/materials';
import { mapsFor } from './proceduralTextures';
import { buildMaterialBuckets, groundGeometry, groundPlan } from './realisticScene';
import { atmosphere, type Atmosphere } from './atmosphere';
import { NightSky } from './nightSky';
import type { ModelRenderer } from './ModelRenderer';
import { SUN_INTENSITY, type Viewport } from './Viewport';
import type { PathTracer } from './PathTracer';

/** What the photorealistic view can be tuned with; a viewer preference, not part of the document. */
export interface RealisticSettings {
  /** Overall brightness. */
  exposure: number;
  /** How much light the sky gives next to the sun (0 is sun only). */
  skyLight: number;
  /** Corner and crease darkening. */
  occlusion: boolean;
  occlusionStrength: number;
  /** Shadow map size in pixels. */
  shadowSize: 1024 | 2048 | 4096;
  /** How soon the distance fades into haze (0 none, 1 thick). */
  haze: number;
  /** Ray tracing: light bounces and real glass, refining while the camera rests (off: real-time only). */
  rayTracing: boolean;
  /** When the ray-traced picture is finished (samples per pixel), and how often light may bounce. */
  raySamples: 64 | 256 | 1024;
  rayBounces: number;
  /** The finished look: tone mapping and grade (see `LOOKS`). */
  look: LookId;
  /** The sky: the time-of-day sky from the document's sun, or a photographed panorama. */
  sky: 'time' | HdriId;
  /** Mirror reflections in water and polished floors. */
  reflections: boolean;
  /** Depth of field in ray-traced pictures, and the lens opening (f-number: small is a shallow focus). */
  depthOfField: boolean;
  fStop: number;
}

export const DEFAULT_REALISTIC: RealisticSettings = {
  exposure: 0.9,
  skyLight: 0.15,
  occlusion: true,
  occlusionStrength: 1,
  shadowSize: 4096,
  haze: 0.5,
  rayTracing: false,
  raySamples: 256,
  rayBounces: 5,
  look: 'natural',
  sky: 'time',
  reflections: true,
  depthOfField: false,
  fStop: 2.8,
};

const HORIZON = 0xc9d6e3;
/** The endless ground: a muted lawn, so a model sits in a landscape rather than on a grey plate. */
const GROUND = 0x8b9670;
/** How far the ground reaches from the model (mm): to where the haze has swallowed it. */
const GROUND_RADIUS = 9e5;

/** Ambient occlusion that ignores see-through things (glass, the cut-plane gizmo, selection tints), which would otherwise count as solid walls. */
class SolidOcclusion extends GTAOPass {
  _overrideVisibility(): void {
    const self = this as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[] };
    self.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      const see = Array.isArray(material) ? material.some((m) => m.transparent) : material?.transparent;
      if (((object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Mesh).isMesh && see) && object.visible) {
        object.visible = false;
        self._visibilityCache.push(object);
      }
    });
  }
}

/**
 * The photorealistic view: the same model drawn with physically-based materials, a procedural sky that lights
 * it, the sun's soft shadows, ambient occlusion and film-like tone mapping. Switching it on hides the plain
 * faces, edges and helpers (they stay in the scene for picking) and renders through a post-processing chain.
 */
export class RealisticRenderer {
  private readonly group = new THREE.Group();
  private readonly materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private readonly ground: THREE.Mesh;
  private readonly sky = new Sky();
  private readonly skyScene = new THREE.Scene();
  private readonly night = new NightSky();
  private air: Atmosphere = atmosphere(45);
  /** Cool, soft light from high up opposite the sun, so the model stays readable at night. */
  private readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  private lastBake = 0;
  private bakeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ao: SolidOcclusion | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private smaa: SMAAPass | null = null;
  /** Finishes a ray-traced picture: the tracer's HDR texture through the same bloom, tone mapping and grade. */
  private stillComposer: EffectComposer | null = null;
  private stillInput: ShaderPass | null = null;
  private stillBloom: UnrealBloomPass | null = null;
  private stillDenoise: ShaderPass | null = null;
  private stillGrade: ShaderPass | null = null;
  /** The distance in focus (mm along the view) for depth of field; null: the point the camera looks at. */
  focusDistance: number | null = null;
  /** While a high-resolution picture is being made (the view stays in the realistic style throughout). */
  private still: { samples: number; done: () => void } | null = null;
  private readonly reflections = new PlanarReflections();
  /** The photographed sky in use (null: the time-of-day sky), once loaded. */
  private hdri: { id: HdriId; data: Hdri; environment: THREE.WebGLRenderTarget } | null = null;
  private groundTextured: boolean;
  private readonly skyRotation = new THREE.Euler(-Math.PI / 2, 0, 0, 'XZY');
  private settings: RealisticSettings = { ...DEFAULT_REALISTIC };
  private enabled = false;
  private dirty = true;
  /** The ray tracer, loaded the first time ray tracing is switched on (it is a large module). */
  private tracer: PathTracer | null = null;
  private tracerLoading = false;
  private tracerScene = true;
  private tracerSky = true;
  /** Can this GPU ray trace at all (null: not checked yet). */
  private rayTracingSupported: boolean | null = null;
  /** Called after each frame while ray tracing, with the samples so far (for the panel's progress). */
  onProgress: ((samples: number, of: number) => void) | null = null;
  private capture: ((url: string) => void) | null = null;

  constructor(
    private readonly doc: Document,
    private readonly viewport: Viewport,
    private readonly plain: ModelRenderer,
  ) {
    this.group.name = 'realistic';
    this.group.visible = false;
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 }));
    this.groundTextured = false;
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    this.ground.raycast = () => {};
    this.ground.visible = false;
    this.pmrem = new THREE.PMREMGenerator(viewport.renderer);
    this.skyScene.add(this.sky, this.night.mesh);
    this.sky.scale.setScalar(50);

    this.moon.visible = false;
    viewport.scene.add(this.group, this.ground, this.moon, this.moon.target);
    doc.geometryChanged.on(() => {
      if (this.enabled) this.rebuild();
      else this.dirty = true;
    });
    // A picture of the model (drawings, scenes) is the plain style: put it back for the duration.
    viewport.snapshotHooks.push((rendering) => {
      if (!this.enabled || this.still) return;
      this.applyStyle(!rendering);
    });
  }

  get current(): RealisticSettings {
    return { ...this.settings };
  }

  /** Applies new settings (only the view changes, nothing in the model). */
  setSettings(settings: RealisticSettings): void {
    const before = this.settings;
    this.settings = { ...settings };
    if (this.enabled) {
      this.viewport.setShadowResolution(settings.shadowSize);
      this.viewport.scene.environmentIntensity = this.environmentIntensity();
    }
    if (this.tracer) {
      this.tracer.maxSamples = settings.raySamples;
      this.tracer.bounces = settings.rayBounces;
      if (before.skyLight !== settings.skyLight) this.tracerSky = true;
    }
    if (before.sky !== settings.sky) this.chooseSky();
    if (before.look !== settings.look && this.enabled) this.applyStyle(true);
    this.viewport.requestRender();
  }

  /** Loads the chosen photographed sky (or drops it for the time-of-day sky), then relights. */
  private chooseSky(): void {
    const id = this.settings.sky;
    if (!isHdri(id)) {
      this.hdri?.environment.dispose();
      this.hdri = null;
      this.tracerSky = true;
      if (this.enabled) this.applyStyle(true);
      return;
    }
    void loadHdri(id).then((data) => {
      if (this.settings.sky !== id) return;
      this.hdri?.environment.dispose();
      this.hdri = { id, data, environment: this.pmrem.fromEquirectangular(data.texture) };
      this.tracerSky = true;
      if (this.enabled) this.applyStyle(true);
    });
  }

  /** Whether ray tracing can work on this GPU. */
  get canRayTrace(): boolean {
    if (this.rayTracingSupported === null) {
      const { renderer } = this.viewport;
      this.rayTracingSupported = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    }
    return this.rayTracingSupported;
  }

  private get tracing(): boolean {
    return this.enabled && (this.settings.rayTracing || this.still !== null) && this.canRayTrace;
  }

  /**
   * Makes a finished picture `width` pixels wide (the view's proportions): ray traced to `samples` when the GPU can,
   * else the real-time picture, without selection or tool feedback. The canvas is drawn at that size for the
   * duration (its on-screen size stays). Resolves to a PNG data URL; `progress` reports samples done.
   */
  async renderStill(width: number, samples: number, progress?: (done: number, of: number) => void, signal?: AbortSignal): Promise<string | null> {
    if (!this.enabled) this.setEnabled(true);
    const { renderer, container } = this.viewport;
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    const max = renderer.capabilities.maxTextureSize;
    const w = Math.min(max, Math.round(width));
    const h = Math.min(max, Math.round(w / aspect));
    const size = renderer.getSize(new THREE.Vector2());
    const ratio = renderer.getPixelRatio();
    const resizeTo = (x: number, y: number, pixelRatio: number) => {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(x, y, false);
      this.composer?.setSize(x, y);
      this.stillComposer?.setSize(x, y);
      this.reflections.setSize(x * pixelRatio, y * pixelRatio);
    };
    const savedProgress = this.onProgress;
    this.viewport.cleanFrame(true);
    resizeTo(w, h, 1);
    try {
      if (this.canRayTrace) {
        await new Promise<void>((resolve) => {
          this.still = { samples, done: resolve };
          this.onProgress = (done) => {
            progress?.(Math.min(done, samples), samples);
            if (done >= samples || signal?.aborted) resolve();
          };
          this.tracer?.restart();
          signal?.addEventListener('abort', () => resolve());
          this.viewport.requestRender();
        });
      }
      if (signal?.aborted) return null;
      return await this.saveImage();
    } finally {
      this.still = null;
      this.onProgress = savedProgress;
      resizeTo(size.x, size.y, ratio);
      this.viewport.cleanFrame(false);
      this.tracer?.restart();
      this.viewport.requestRender();
    }
  }

  /** The picture as it is now (ray traced or real-time), as a PNG data URL. */
  saveImage(): Promise<string> {
    return new Promise((resolve) => {
      this.capture = resolve;
      this.viewport.requestRender();
    });
  }

  get isOn(): boolean {
    return this.enabled;
  }

  /** Rebuilds the model's meshes (after a setting such as smoothing changed). */
  refresh(): void {
    if (this.enabled) this.rebuild();
    else this.dirty = true;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      if (this.dirty) this.rebuild();
      this.updateSky();
      this.viewport.mode = {
        render: () => this.render(),
        resize: (width, height) => {
          this.composer?.setSize(width, height);
          this.stillComposer?.setSize(width, height);
          this.reflections.setSize(width, height);
        },
        sunChanged: () => this.scheduleSky(),
        continuous: () => (this.tracing || this.still !== null) && (this.tracer?.refining ?? true),
      };
    } else {
      this.viewport.mode = null;
    }
    this.viewport.setShadowResolution(on ? this.settings.shadowSize : 4096);
    // The horizon is a couple of kilometres off, not a hundred metres (faces never overlap here, so depth precision holds).
    this.viewport.rig.minFar = on ? 2e6 : 1e5;
    this.viewport.rig.update();
    this.applyStyle(on);
    this.viewport.requestRender();
  }

  /** Turns the realistic look on or off in the scene (not the render mode). */
  private applyStyle(on: boolean): void {
    const { renderer, scene } = this.viewport;
    this.group.visible = on;
    this.ground.visible = on;
    this.plain.setRealistic(on);
    const hdri = on ? this.hdri : null;
    this.tracerSky = true;
    this.skyRotation.z = hdri?.data.sun ? alignTurn(hdri.data.sun, this.viewport.sunDirection) : 0;
    scene.environment = on ? (hdri?.environment.texture ?? this.environment?.texture ?? null) : null;
    scene.environmentRotation.copy(this.skyRotation);
    scene.backgroundRotation.copy(this.skyRotation);
    scene.background = on && hdri ? hdri.data.texture : on && this.environment ? this.environment.texture : new THREE.Color(this.viewport.plainBackground);
    // A 512-pixel panorama is soft up close: a touch of blur makes it read as a photographed backdrop.
    scene.backgroundBlurriness = hdri ? 0.02 : 0;
    scene.environmentIntensity = this.environmentIntensity();
    scene.backgroundIntensity = hdri ? 1 : 0.4 + 0.6 * this.air.night;
    scene.fog = on ? new THREE.Fog(this.horizon(), 1, 2) : null;
    renderer.toneMapping = on ? LOOKS[this.settings.look].toneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = this.exposure();
    // Soft shadows: the shadow map's filter widens as the sun gets lower (longer shadows blur more).
    this.viewport.sun.shadow.radius = on ? 3 + 5 * (1 - Math.min(1, Math.max(0, this.viewport.sunAltitude) / 60)) : 1;
    this.viewport.sun.shadow.blurSamples = on ? 16 : 8;
    // The hemisphere light is replaced by the sky; sunlight takes the colour and strength of the hour.
    this.viewport.hemisphere.visible = !on;
    this.moon.visible = on;
    if (on) this.applySunLight();
    else this.viewport.restoreSunLight();
    this.viewport.requestRender();
  }

  private exposure(): number {
    return this.settings.exposure * LOOKS[this.settings.look].exposure;
  }

  /** The sky's light on the model: the panel's setting, scaled for twilight; the dark night sky is turned up so the model stays readable. */
  private environmentIntensity(): number {
    // Photographed skies are measured light: bright enough as they are, relative to the panel's default.
    if (this.hdri) return this.settings.skyLight / DEFAULT_REALISTIC.skyLight;
    return this.settings.skyLight * (this.air.skyIntensity * (1 - this.air.night) + this.air.night * (1.5 + 4.5 * this.air.stars));
  }

  /** The haze colour: the daytime horizon, warmed at sunrise and sunset, deep blue at night. */
  private horizon(): THREE.Color {
    const [r, g, b] = this.air.sunColor;
    const day = new THREE.Color(HORIZON).multiply(new THREE.Color(0.75 + 0.25 * r, 0.8 + 0.2 * g, 0.7 + 0.3 * b));
    return day.lerp(new THREE.Color(NightSky.HORIZON), this.air.stars);
  }

  private applySunLight(): void {
    const sun = this.viewport.sun;
    const d = this.viewport.sunDirection;
    this.moon.position.set(-d.x, -d.y, Math.hypot(d.x, d.y) * 1.2).normalize();
    this.moon.intensity = 0.5 * this.air.night;
    sun.color.setRGB(...this.air.sunColor);
    sun.intensity = SUN_INTENSITY * 1.1 * this.air.sunIntensity;
    sun.castShadow = this.viewport.sunShadows && this.air.sunIntensity > 0;
  }

  /** Redraws the sky soon: at most about twelve times a second while the sun is being dragged or played through the day. */
  private scheduleSky(): void {
    // The light follows at once; only the sky picture waits.
    this.air = atmosphere(this.viewport.sunAltitude);
    this.applySunLight();
    this.tracerSky = true;
    const wait = 80 - (performance.now() - this.lastBake);
    if (wait <= 0) return this.updateSky();
    this.bakeTimer ??= setTimeout(() => {
      this.bakeTimer = null;
      if (this.enabled) this.updateSky();
    }, wait);
  }

  /** Redraws the sky for the sun's position and time of day and lights the model with it. */
  private updateSky(): void {
    this.lastBake = performance.now();
    const viewport = this.viewport;
    this.air = atmosphere(viewport.sunAltitude);
    // The sky sees the sun where it truly is, also below the horizon (the light's direction is held above it).
    const d = viewport.sunDirection;
    const flat = Math.hypot(d.x, d.y) || 1;
    const h = (viewport.sunAltitude * Math.PI) / 180;
    const sky = new THREE.Vector3((d.x / flat) * Math.cos(h), (d.y / flat) * Math.cos(h), Math.sin(h));
    const u = this.sky.material.uniforms;
    // The sky is drawn Y-up; the model is Z-up (the scene's environment rotation turns one into the other).
    u.sunPosition.value.set(sky.x, sky.z, -sky.y);
    u.turbidity.value = this.air.turbidity;
    u.rayleigh.value = this.air.rayleigh;
    u.mieCoefficient.value = this.air.mieCoefficient;
    u.mieDirectionalG.value = 0.8;
    this.night.set(this.air.night, this.air.stars);
    const previous = this.environment;
    this.environment = this.pmrem.fromScene(this.skyScene, 0, 0.1, 100);
    previous?.dispose();
    this.tracerSky = true;
    if (this.enabled) this.applyStyle(true);
  }

  private material(m: Material): THREE.MeshPhysicalMaterial {
    const key = `${m.id}|${m.color}|${m.opacity ?? 1}`;
    let material = this.materials.get(key);
    if (material) return material;
    const glass = m.opacity !== undefined && m.opacity < 1;
    material = new THREE.MeshPhysicalMaterial({
      color: m.color,
      roughness: m.roughness,
      metalness: m.metalness,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
      transparent: glass,
      opacity: glass ? m.opacity : 1,
      depthWrite: !glass,
      envMapIntensity: glass ? 1.5 : 1,
      clearcoat: m.clearcoat ?? 0,
      clearcoatRoughness: m.clearcoatRoughness ?? 0.1,
      sheen: m.sheen ?? 0,
      sheenColor: new THREE.Color(m.color).lerp(new THREE.Color(0xffffff), 0.3),
      sheenRoughness: 0.6,
      anisotropy: m.anisotropy ?? 0,
    });
    if (m.texture) {
      const maps = mapsFor(m.texture.kind);
      material.map = maps.map;
      material.normalMap = maps.normal;
      const relief = m.bump ?? 0.3;
      material.normalScale.set(relief, relief);
      material.roughnessMap = maps.roughness;
    }
    if (isReflective(m)) this.reflections.patch(material);
    this.materials.set(key, material);
    return material;
  }

  private rebuild(): void {
    this.dirty = false;
    for (const child of [...this.group.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.group.remove(child);
    }
    const buckets = [...buildMaterialBuckets(this.doc.placements(), this.plain.smoothAngle).values()];
    this.reflections.setPlanes(reflectivePlanes(buckets.filter((b) => isReflective(b.material))));
    // The ground: a disc out to the horizon around the model, at the height of its site (see `groundPlan`).
    const plan = groundPlan(buckets);
    const box = new THREE.Box3();
    for (const b of buckets) for (let i = 0; i < b.positions.length; i += 3) box.expandByPoint(new THREE.Vector3(b.positions[i], b.positions[i + 1], b.positions[i + 2]));
    const centre = box.isEmpty() ? new THREE.Vector2() : new THREE.Vector2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2);
    this.ground.geometry.dispose();
    this.ground.geometry = groundGeometry(plan, centre, GROUND_RADIUS);
    if (!this.groundTextured) {
      // The lawn pattern, its UVs in millimetres: one repeat every 600 mm (its own textures, so the repeat stays its own).
      const maps = mapsFor('grass');
      const ground = this.ground.material as THREE.MeshStandardMaterial;
      ground.map = maps.map.clone();
      ground.normalMap = maps.normal.clone();
      ground.normalScale.set(0.5, 0.5);
      for (const t of [ground.map, ground.normalMap]) t.repeat.set(1 / 600, 1 / 600);
      ground.needsUpdate = true;
      this.groundTextured = true;
    }
    for (const bucket of buckets) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material(bucket.material));
      const glass = bucket.material.opacity !== undefined && bucket.material.opacity < 1;
      mesh.castShadow = !glass;
      mesh.receiveShadow = true;
      mesh.renderOrder = glass ? 1 : 0;
      mesh.raycast = () => {};
      mesh.userData.material = bucket.material;
      this.group.add(mesh);
    }
    this.tracerScene = true;
    this.viewport.requestRender();
  }

  private ensureComposer(): EffectComposer {
    if (this.composer) return this.composer;
    const { renderer, scene, rig } = this.viewport;
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(scene, rig.camera);
    // Ambient occlusion works in a perspective view; world units are millimetres.
    this.ao = new SolidOcclusion(scene, rig.perspective, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 600, distanceExponent: 1, thickness: 1, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, rings: 2, samples: 16 });
    // Glow only around light far brighter than white (sun glints, the sun itself).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.35, 4);
    this.grade = createGradePass();
    this.smaa = new SMAAPass();
    composer.addPass(this.renderPass);
    composer.addPass(this.ao);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.addPass(this.grade);
    composer.addPass(this.smaa);
    this.reflections.setSize(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    return (this.composer = composer);
  }

  private render(): void {
    if (this.tracing) this.renderTraced();
    else this.renderRealTime();
    if (this.capture) {
      // Read the canvas now, in the same task as the drawing (the buffer is not kept for later).
      this.capture(this.viewport.canvas.toDataURL('image/png'));
      this.capture = null;
    }
  }

  private renderRealTime(): void {
    const { rig, scene, renderer } = this.viewport;
    const composer = this.ensureComposer();
    this.renderPass!.camera = rig.camera;
    this.ao!.enabled = this.settings.occlusion && !rig.isOrtho;
    this.ao!.blendIntensity = this.settings.occlusionStrength;
    // The haze swallows the ground before its edge.
    const reach = Math.min(GROUND_RADIUS, rig.perspective.far * 0.45);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = reach * (0.6 - 0.55 * this.settings.haze);
      scene.fog.far = reach;
    }
    const look = LOOKS[this.settings.look];
    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = this.exposure();
    this.bloom!.strength = look.bloom;
    this.bloom!.enabled = look.bloom > 0;
    const size = renderer.getSize(new THREE.Vector2());
    applyLook(this.grade!, look, size.x / Math.max(1, size.y));
    if (this.settings.reflections) this.reflections.render(renderer, scene, rig.camera);
    else this.reflections.disable();
    composer.render();
  }

  /** One more ray-traced sample, finished with the look; the real-time picture while the tracer loads or has too few samples. */
  private renderTraced(): void {
    const tracer = this.tracer;
    if (!tracer) {
      this.loadTracer();
      this.renderRealTime();
      return;
    }
    const { rig, renderer, sun, sunDirection, scene } = this.viewport;
    if (this.tracerScene) {
      this.group.updateMatrixWorld(true);
      tracer.setScene({ meshes: this.group.children as THREE.Mesh[], ground: this.ground });
      this.tracerScene = false;
    }
    if (this.tracerSky) {
      const centre = new THREE.Box3().setFromObject(this.group).getCenter(new THREE.Vector3());
      tracer.setSky(this.hdri ? this.hdri.data.texture : this.skyScene, this.skyRotation, this.environmentIntensity(), scene.backgroundIntensity);
      tracer.setLights({ sun, sunDirection, moon: this.moon, centre });
      this.tracerSky = false;
    }
    const camera = rig.camera;
    if (this.settings.depthOfField && !rig.isOrtho) {
      const focus = this.focusDistance ?? camera.position.distanceTo(rig.target);
      tracer.setDepthOfField({ fStop: this.settings.fStop, focus });
    } else {
      tracer.setDepthOfField(null);
    }
    if (this.still) tracer.maxSamples = this.still.samples;
    else tracer.maxSamples = this.settings.raySamples;
    tracer.render(camera);
    if (tracer.ready) this.finishTraced(tracer.texture);
    else this.renderRealTime();
    renderer.toneMappingExposure = this.exposure();
    this.onProgress?.(Math.min(tracer.samples, tracer.maxSamples), tracer.maxSamples);
  }

  /** The traced HDR picture through bloom, tone mapping, the grade (no anti-aliasing needed: the samples did that). */
  private finishTraced(texture: THREE.Texture): void {
    const { renderer } = this.viewport;
    if (!this.stillComposer) {
      const size = renderer.getSize(new THREE.Vector2());
      const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      this.stillInput = new ShaderPass(CopyShader);
      this.stillDenoise = this.tracer!.denoisePass();
      this.stillBloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.35, 4);
      this.stillGrade = createGradePass();
      composer.addPass(this.stillInput);
      composer.addPass(this.stillDenoise);
      composer.addPass(this.stillBloom);
      composer.addPass(new OutputPass());
      composer.addPass(this.stillGrade);
      this.stillComposer = composer;
    }
    const look = LOOKS[this.settings.look];
    renderer.toneMapping = look.toneMapping;
    renderer.toneMappingExposure = this.exposure();
    this.stillInput!.uniforms.tDiffuse.value = texture;
    // The copy reads the traced texture itself, not the composer's (empty) input.
    this.stillInput!.needsSwap = true;
    (this.stillInput as unknown as { textureID: string | null }).textureID = null;
    // Smooth the remaining grain while there are few samples; a long render needs no help.
    const samples = this.tracer?.samples ?? 0;
    this.stillDenoise!.enabled = samples < 512;
    (this.stillDenoise!.uniforms as Record<string, THREE.IUniform>).sigma.value = samples < 64 ? 5 : 3;
    this.stillBloom!.strength = look.bloom;
    this.stillBloom!.enabled = look.bloom > 0;
    const size = renderer.getSize(new THREE.Vector2());
    applyLook(this.stillGrade!, look, size.x / Math.max(1, size.y));
    this.stillComposer.render();
  }

  private loadTracer(): void {
    if (this.tracerLoading) return;
    this.tracerLoading = true;
    void import('./PathTracer').then(({ PathTracer }) => {
      const tracer = new PathTracer(this.viewport.renderer, () => this.renderRealTime());
      tracer.maxSamples = this.settings.raySamples;
      tracer.bounces = this.settings.rayBounces;
      this.tracer = tracer;
      this.tracerScene = this.tracerSky = true;
      this.viewport.requestRender();
    });
  }
}
