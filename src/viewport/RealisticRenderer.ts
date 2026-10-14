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
import type { ModelRenderer } from './ModelRenderer';
import type { Viewport } from './Viewport';

const HORIZON = 0xc9d6e3;
const GROUND = 0xa9a79e;
const EXPOSURE = 0.9;

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
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLRenderTarget | null = null;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ao: SolidOcclusion | null = null;
  /** Overall brightness of the picture. */
  exposure = EXPOSURE;
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
    this.skyScene.add(this.sky);
    this.sky.scale.setScalar(50);

    viewport.scene.add(this.group, this.ground);
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
        sunChanged: () => this.updateSky(),
      };
    } else {
      this.viewport.mode = null;
    }
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
    scene.environmentIntensity = 0.15;
    scene.backgroundIntensity = 0.4;
    scene.fog = on ? new THREE.Fog(HORIZON, 1, 2) : null;
    renderer.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = this.exposure;
    // The hemisphere light is replaced by the sky.
    this.viewport.hemisphere.visible = !on;
    this.viewport.requestRender();
  }

  /** Redraws the sky for the sun's position and lights the model with it. */
  private updateSky(): void {
    const d = this.viewport.sunDirection;
    const u = this.sky.material.uniforms;
    // The sky is drawn Y-up; the model is Z-up (the scene's environment rotation turns one into the other).
    u.sunPosition.value.set(d.x, d.z, -d.y);
    u.turbidity.value = 4;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
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
    this.ao!.enabled = !rig.isOrtho;
    // The ground follows the target; it and the haze reach out to the horizon.
    const reach = Math.max(rig.perspective.far, 1e5) * 0.45;
    this.ground.position.set(rig.target.x, rig.target.y, -0.5);
    this.ground.scale.set(reach, reach, 1);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = reach * 0.15;
      scene.fog.far = reach;
    }
    renderer.toneMappingExposure = this.exposure;
    composer.render();
  }
}
