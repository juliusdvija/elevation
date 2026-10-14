import * as THREE from 'three';
import type { Material } from '../core/materials';
import { levelAreas } from './realisticScene';

/** Up to this many horizontal mirror planes are rendered each frame (the largest reflective areas). */
const MAX_PLANES = 2;

/** Whether a material is glossy enough to mirror its surroundings (water, polished stone, lacquered wood, glass). */
export function isReflective(m: Material): boolean {
  return m.roughness <= 0.4 || (m.clearcoat ?? 0) >= 0.4;
}

/**
 * The heights of the largest horizontal reflective areas: triangles facing up, grouped by height (to the millimetre),
 * ranked by area. `positions` and `normals` are flat triangle lists in world space (Z up).
 */
export function reflectivePlanes(surfaces: { positions: ArrayLike<number>; normals: ArrayLike<number> }[], max = MAX_PLANES): number[] {
  return [...levelAreas(surfaces).entries()]
    .filter(([, sum]) => sum > 1e5) // at least about 0.3 × 0.3 m
    .sort((p, q) => q[1] - p[1])
    .slice(0, max)
    .map(([z]) => z);
}

interface Plane {
  z: number;
  target: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
}

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/**
 * Mirror reflections on flat horizontal glossy surfaces (a pool, a polished floor): the scene is rendered once more
 * per plane from the camera mirrored in that plane, clipped to what lies above it, into a half-size picture with
 * mipmaps. Glossy materials then use that picture instead of the sky map for their reflected light, blurred by
 * their roughness (`patch`), so the reflection goes through the same physically based shading.
 */
export class PlanarReflections {
  private planes: Plane[] = [];
  private readonly dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly uniforms = Array.from({ length: MAX_PLANES }, () => ({
    map: { value: this.dummy as THREE.Texture },
    matrix: { value: new THREE.Matrix4() },
    z: { value: 0 },
    on: { value: 0 },
  }));
  private readonly mirror = new THREE.Matrix4();
  private readonly clip = new THREE.Plane();
  private width = 1;
  private height = 1;

  constructor() {
    this.dummy.needsUpdate = true;
  }

  /** Makes a material use the mirror pictures (for glossy catalogue materials only). */
  patch(material: THREE.MeshPhysicalMaterial): void {
    material.onBeforeCompile = (shader) => {
      this.uniforms.forEach((u, i) => {
        shader.uniforms[`reflMap${i}`] = u.map;
        shader.uniforms[`reflMatrix${i}`] = u.matrix;
        shader.uniforms[`reflZ${i}`] = u.z;
        shader.uniforms[`reflOn${i}`] = u.on;
      });
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vReflWorld;\nvarying vec3 vReflNormal;\nvoid main() {')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vReflWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vReflNormal = normalize(mat3(modelMatrix) * objectNormal);');
      const declarations = this.uniforms.map((_, i) => `uniform sampler2D reflMap${i};\nuniform mat4 reflMatrix${i};\nuniform float reflZ${i};\nuniform float reflOn${i};`).join('\n');
      const sample = this.uniforms
        .map(
          (_, i) => `
  if (reflOn${i} > 0.5 && abs(vReflWorld.z - reflZ${i}) < 3.0 && vReflNormal.z > 0.9) {
    vec4 rc = reflMatrix${i} * vec4(vReflWorld, 1.0);
    // The surface's relief (normal map) ripples the reflection a little.
    vec2 ruv = rc.xy / rc.w + (normal.xy - nonPerturbedNormal.xy) * 0.04;
    vec3 refl = textureLod(reflMap${i}, ruv, material.roughness * 7.0).rgb;
    float edge = smoothstep(0.0, 0.04, ruv.x) * smoothstep(1.0, 0.96, ruv.x) * smoothstep(0.0, 0.04, ruv.y) * smoothstep(1.0, 0.96, ruv.y);
    radiance = mix(radiance, refl, edge);
    #ifdef USE_CLEARCOAT
      clearcoatRadiance = mix(clearcoatRadiance, refl, edge);
    #endif
  }`,
        )
        .join('\n');
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `varying vec3 vReflWorld;\nvarying vec3 vReflNormal;\n${declarations}\nvoid main() {`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular )\n${sample}\n#endif`);
    };
    material.customProgramCacheKey = () => 'planar-reflections';
    material.needsUpdate = true;
  }

  /** The mirror planes (heights in mm); a picture is kept for each. */
  setPlanes(heights: number[]): void {
    for (const plane of this.planes) plane.target.dispose();
    this.planes = heights.slice(0, MAX_PLANES).map((z) => ({ z, target: this.makeTarget(), camera: null }));
    this.uniforms.forEach((u, i) => {
      u.on.value = 0;
      u.z.value = this.planes[i]?.z ?? 0;
      u.map.value = this.dummy;
    });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width / 2));
    this.height = Math.max(1, Math.round(height / 2));
    for (const plane of this.planes) plane.target.setSize(this.width, this.height);
  }

  /** Switches the reflections off (the materials fall back to the sky map). */
  disable(): void {
    for (const u of this.uniforms) u.on.value = 0;
  }

  /** Renders the mirror pictures for `camera`. Call just before the frame itself. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.planes.length === 0) return;
    // While mirrors render, no material may read a mirror picture (a feedback loop) or show reflections in reflections.
    for (const u of this.uniforms) {
      u.on.value = 0;
      u.map.value = this.dummy;
    }
    const previousTarget = renderer.getRenderTarget();
    const previousClipping = renderer.clippingPlanes;
    const previousShadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const shown = this.planes.map(() => false);
    this.planes.forEach((plane, i) => {
      const source = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      // Looking at the plane from below sees nothing to mirror.
      if (source.position.z < plane.z && !(source as THREE.OrthographicCamera).isOrthographicCamera) return;
      if (!plane.camera || plane.camera.type !== source.type) plane.camera = source.clone();
      const mirrored = plane.camera;
      mirrored.copy(source as never);
      this.mirror.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 2 * plane.z, 0, 0, 0, 1);
      mirrored.matrixAutoUpdate = false;
      mirrored.matrixWorld.multiplyMatrices(this.mirror, source.matrixWorld);
      mirrored.matrixWorldInverse.copy(mirrored.matrixWorld).invert();
      mirrored.projectionMatrix.copy(source.projectionMatrix);
      mirrored.projectionMatrixInverse.copy(source.projectionMatrixInverse);
      this.clip.set(new THREE.Vector3(0, 0, 1), -(plane.z + 1));
      renderer.clippingPlanes = [this.clip];
      renderer.setRenderTarget(plane.target);
      renderer.clear();
      renderer.render(scene, mirrored);
      const u = this.uniforms[i];
      u.matrix.value.multiplyMatrices(BIAS, mirrored.projectionMatrix).multiply(mirrored.matrixWorldInverse);
      shown[i] = true;
    });
    renderer.clippingPlanes = previousClipping;
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.autoUpdate = previousShadows;
    this.planes.forEach((plane, i) => {
      const u = this.uniforms[i];
      u.map.value = plane.target.texture;
      u.z.value = plane.z;
      u.on.value = shown[i] ? 1 : 0;
    });
  }

  dispose(): void {
    for (const plane of this.planes) plane.target.dispose();
    this.planes = [];
    this.dummy.dispose();
  }

  private makeTarget(): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    return target;
  }
}
