import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { Document } from '../document';
import type { Material } from '../core/materials';
import { mapsFor } from './proceduralTextures';
import { buildMaterialBuckets } from './realisticScene';
import { atmosphere, type Atmosphere } from './atmosphere';
import { NightSky } from './nightSky';
import type { ModelRenderer } from './ModelRenderer';
import { SUN_INTENSITY, type Viewport } from './Viewport';

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
}

export const DEFAULT_REALISTIC: RealisticSettings = { exposure: 0.9, skyLight: 0.15, occlusion: true, occlusionStrength: 1, shadowSize: 4096, haze: 0.5 };

const HORIZON = 0xc9d6e3;
const GROUND = 0xa9a79e;

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
  private settings: RealisticSettings = { ...DEFAULT_REALISTIC };
  private enabled = false;
  private dirty = true;

  constructor(
    private readonly doc: Document,
    private readonly viewport: Viewport,
    private readonly plain: ModelRenderer,
  ) {
    this.group.name = 'realistic';
    this.group.visible = false;
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 }),
    );
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
      if (!this.enabled) return;
      this.applyStyle(!rendering);
    });
  }

  get current(): RealisticSettings {
    return { ...this.settings };
  }

  /** Applies new settings (only the view changes, nothing in the model). */
  setSettings(settings: RealisticSettings): void {
    this.settings = { ...settings };
    if (this.enabled) {
      this.viewport.setShadowResolution(settings.shadowSize);
      this.viewport.scene.environmentIntensity = this.environmentIntensity();
    }
    this.viewport.requestRender();
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
        resize: (width, height) => this.composer?.setSize(width, height),
        sunChanged: () => this.scheduleSky(),
      };
    } else {
      this.viewport.mode = null;
    }
    this.viewport.setShadowResolution(on ? this.settings.shadowSize : 4096);
    this.applyStyle(on);
    this.viewport.requestRender();
  }

  /** Turns the realistic look on or off in the scene (not the render mode). */
  private applyStyle(on: boolean): void {
    const { renderer, scene } = this.viewport;
    this.group.visible = on;
    this.ground.visible = on;
    this.plain.setRealistic(on);
    scene.environment = on ? (this.environment?.texture ?? null) : null;
    scene.environmentRotation.set(-Math.PI / 2, 0, 0);
    scene.backgroundRotation.set(-Math.PI / 2, 0, 0);
    scene.background = on && this.environment ? this.environment.texture : new THREE.Color(this.viewport.plainBackground);
    scene.environmentIntensity = this.environmentIntensity();
    scene.backgroundIntensity = 0.4 + 0.6 * this.air.night;
    scene.fog = on ? new THREE.Fog(this.horizon(), 1, 2) : null;
    renderer.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = this.settings.exposure;
    // The hemisphere light is replaced by the sky; sunlight takes the colour and strength of the hour.
    this.viewport.hemisphere.visible = !on;
    this.moon.visible = on;
    if (on) this.applySunLight();
    else this.viewport.restoreSunLight();
    this.viewport.requestRender();
  }

  /** The sky's light on the model: the panel's setting, scaled for twilight; the dark night sky is turned up so the model stays readable. */
  private environmentIntensity(): number {
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
    });
    if (m.texture) {
      const maps = mapsFor(m.texture.kind);
      material.map = maps.map;
      material.bumpMap = maps.bump;
      material.bumpScale = (m.bump ?? 0.3) * 2;
    }
    this.materials.set(key, material);
    return material;
  }

  private rebuild(): void {
    this.dirty = false;
    for (const child of [...this.group.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.group.remove(child);
    }
    for (const bucket of buildMaterialBuckets(this.doc.placements(), this.plain.smoothAngle).values()) {
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
      this.group.add(mesh);
    }
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
    composer.addPass(this.renderPass);
    composer.addPass(this.ao);
    composer.addPass(new OutputPass());
    return (this.composer = composer);
  }

  private render(): void {
    const { rig, scene, renderer } = this.viewport;
    const composer = this.ensureComposer();
    this.renderPass!.camera = rig.camera;
    this.ao!.enabled = this.settings.occlusion && !rig.isOrtho;
    this.ao!.blendIntensity = this.settings.occlusionStrength;
    // The ground follows the target; it and the haze reach out to the horizon.
    const reach = Math.max(rig.perspective.far, 1e5) * 0.45;
    this.ground.position.set(rig.target.x, rig.target.y, -0.5);
    this.ground.scale.set(reach, reach, 1);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = reach * (0.6 - 0.55 * this.settings.haze);
      scene.fog.far = reach;
    }
    renderer.toneMappingExposure = this.settings.exposure;
    composer.render();
  }
}
