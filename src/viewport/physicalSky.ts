import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMOSPHERE } from './atmosphere';

/**
 * The sky as a physical atmosphere (Hillaire 2020, the method behind V-Ray's and Unreal's sun & sky), rendered on the
 * GPU into three small look-up textures and sampled per pixel:
 *
 * - transmittance (256 × 64): how much light survives from any height and angle to the top of the atmosphere;
 * - multiple scattering (32 × 32): light scattered more than once (the deep blue overhead, the bright horizon, the
 *   blue hour after sunset), in Hillaire's isotropic approximation;
 * - sky view (200 × 120): the light reaching the viewer from every direction for the current sun.
 *
 * The first two depend only on the haze; the third is redrawn whenever the sun moves (about a millisecond).
 * The sky is Y-up here (like the scene it is baked from); radiance is per unit of sunlight above the atmosphere,
 * multiplied by `sunIlluminance` so it sits with the scene's sun light.
 */

const A = ATMOSPHERE;
const vec3 = (v: readonly number[]) => `vec3(${v.map((x) => x.toExponential(6)).join(', ')})`;

const COMMON = /* glsl */ `
  #define PI 3.141592653589793
  const float Rg = ${A.groundRadius.toFixed(1)};
  const float Rt = ${A.topRadius.toFixed(1)};
  const vec3 rayleighScattering = ${vec3(A.rayleighScattering)};
  const float rayleighHeight = ${A.rayleighHeight.toFixed(3)};
  const float mieScatteringBase = ${A.mieScattering.toExponential(6)};
  const float mieExtinctionBase = ${A.mieExtinction.toExponential(6)};
  const float mieHeight = ${A.mieHeight.toFixed(3)};
  const float mieG = ${A.mieG.toFixed(3)};
  const vec3 ozoneAbsorption = ${vec3(A.ozoneAbsorption)};
  const float ozoneCentre = ${A.ozoneCentre.toFixed(1)};
  const float ozoneWidth = ${A.ozoneWidth.toFixed(1)};
  const vec3 groundAlbedo = vec3(${A.groundAlbedo.toFixed(3)});
  uniform float haze;

  struct Medium { vec3 scattering; vec3 extinction; vec3 rayleigh; float mie; };

  Medium medium(float height) {
    float r = exp(-height / rayleighHeight);
    float m = exp(-height / mieHeight) * haze;
    float o = max(0.0, 1.0 - abs(height - ozoneCentre) / ozoneWidth);
    Medium s;
    s.rayleigh = rayleighScattering * r;
    s.mie = mieScatteringBase * m;
    s.scattering = s.rayleigh + vec3(s.mie);
    s.extinction = s.rayleigh + vec3(mieExtinctionBase * m) + ozoneAbsorption * o;
    return s;
  }

  // Distance along a ray from radius r with cosine mu (to the zenith) to a sphere of radius R; -1 if it misses.
  float sphereDistance(float r, float mu, float R) {
    float d = r * r * (mu * mu - 1.0) + R * R;
    if (d < 0.0) return -1.0;
    float s = sqrt(d);
    float t1 = -r * mu - s;
    float t2 = -r * mu + s;
    if (t2 < 0.0) return -1.0;
    return t1 > 0.0 ? t1 : t2;
  }

  bool hitsGround(float r, float mu) {
    return mu < 0.0 && r * r * (mu * mu - 1.0) + Rg * Rg >= 0.0;
  }

  // Bruneton's mapping of (height, angle) to the transmittance texture, precise near the horizon.
  vec2 transmittanceUv(float r, float mu) {
    float H = sqrt(Rt * Rt - Rg * Rg);
    float rho = sqrt(max(0.0, r * r - Rg * Rg));
    float d = max(0.0, -r * mu + sqrt(max(0.0, r * r * (mu * mu - 1.0) + Rt * Rt)));
    float dMin = Rt - r;
    float dMax = rho + H;
    return vec2((d - dMin) / (dMax - dMin), rho / H);
  }

  uniform sampler2D transmittanceLut;
  vec3 transmittanceTo(float r, float mu) {
    if (hitsGround(r, mu)) return vec3(0.0);
    return texture2D(transmittanceLut, transmittanceUv(r, mu)).rgb;
  }

  float rayleighPhase(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
  float miePhase(float c) {
    float g2 = mieG * mieG;
    return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * mieG * c, 1.5));
  }
`;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const TRANSMITTANCE = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  void main() {
    float H = sqrt(Rt * Rt - Rg * Rg);
    float rho = H * vUv.y;
    float r = sqrt(rho * rho + Rg * Rg);
    float dMin = Rt - r;
    float dMax = rho + H;
    float d = dMin + vUv.x * (dMax - dMin);
    float mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
    vec3 depth = vec3(0.0);
    const int N = 40;
    for (int i = 0; i < N; i++) {
      float t = (float(i) + 0.5) / float(N) * d;
      float h = sqrt(r * r + t * t + 2.0 * r * t * mu) - Rg;
      depth += medium(h).extinction * (d / float(N));
    }
    gl_FragColor = vec4(exp(-depth), 1.0);
  }
`;

const MULTIPLE = /* glsl */ `
  ${COMMON}
  varying vec2 vUv;
  void main() {
    float sunMu = vUv.x * 2.0 - 1.0;
    float r = Rg + max(vUv.y, 0.001) * (Rt - Rg);
    vec3 sun = vec3(sqrt(max(0.0, 1.0 - sunMu * sunMu)), sunMu, 0.0);
    vec3 origin = vec3(0.0, r, 0.0);
    vec3 secondOrder = vec3(0.0);
    vec3 transfer = vec3(0.0);
    const int SQRT = 8;
    const int STEPS = 20;
    for (int a = 0; a < SQRT; a++) {
      for (int b = 0; b < SQRT; b++) {
        // Directions spread evenly over the sphere.
        float u = (float(a) + 0.5) / float(SQRT);
        float v = (float(b) + 0.5) / float(SQRT);
        float theta = 2.0 * PI * u;
        float phi = acos(1.0 - 2.0 * v);
        vec3 dir = vec3(cos(theta) * sin(phi), cos(phi), sin(theta) * sin(phi));
        float mu = dir.y;
        float ground = hitsGround(r, mu) ? sphereDistance(r, mu, Rg) : -1.0;
        float tMax = ground > 0.0 ? ground : sphereDistance(r, mu, Rt);
        float dt = tMax / float(STEPS);
        vec3 throughput = vec3(1.0);
        vec3 L = vec3(0.0);
        vec3 f = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = origin + dir * (float(i) + 0.5) * dt;
          float pr = length(p);
          Medium m = medium(pr - Rg);
          vec3 sunT = transmittanceTo(pr, dot(p / pr, sun));
          vec3 stepT = exp(-m.extinction * dt);
          vec3 integral = (vec3(1.0) - stepT) / max(m.extinction, vec3(1e-9));
          L += throughput * m.scattering * sunT / (4.0 * PI) * integral;
          f += throughput * m.scattering * integral;
          throughput *= stepT;
        }
        if (ground > 0.0) {
          vec3 p = origin + dir * ground;
          vec3 n = normalize(p);
          L += throughput * transmittanceTo(Rg, dot(n, sun)) * max(dot(n, sun), 0.0) * groundAlbedo / PI;
        }
        secondOrder += L / float(SQRT * SQRT);
        transfer += f / float(SQRT * SQRT);
      }
    }
    // The geometric series of ever higher orders of scattering.
    gl_FragColor = vec4(secondOrder / (vec3(1.0) - transfer), 1.0);
  }
`;

const VIEW_FUNCTIONS = /* glsl */ `
  uniform sampler2D multipleLut;
  vec3 multipleScattering(float r, float sunMu) {
    return texture2D(multipleLut, vec2(sunMu * 0.5 + 0.5, (r - Rg) / (Rt - Rg))).rgb;
  }

  // The light reaching the viewer along dir (Y-up, viewer just above the ground), for the sun along sun.
  vec3 integrateSky(vec3 dir, vec3 sun) {
    float r = Rg + ${A.viewHeight.toFixed(4)};
    vec3 origin = vec3(0.0, r, 0.0);
    float mu = dir.y;
    float ground = hitsGround(r, mu) ? sphereDistance(r, mu, Rg) : -1.0;
    float tMax = ground > 0.0 ? ground : sphereDistance(r, mu, Rt);
    float c = dot(dir, sun);
    float pr = rayleighPhase(c);
    float pm = miePhase(c);
    vec3 throughput = vec3(1.0);
    vec3 L = vec3(0.0);
    const int STEPS = 40;
    float previous = 0.0;
    for (int i = 0; i < STEPS; i++) {
      // Steps bunched near the viewer, where the air is dense.
      float t = tMax * pow((float(i) + 0.6) / float(STEPS), 2.0);
      float dt = t - previous;
      previous = t;
      vec3 p = origin + dir * t;
      float h = length(p);
      vec3 up = p / h;
      float sunMu = dot(up, sun);
      Medium m = medium(h - Rg);
      vec3 sunT = transmittanceTo(h, sunMu);
      vec3 S = (m.rayleigh * pr + vec3(m.mie * pm)) * sunT + m.scattering * multipleScattering(h, sunMu);
      vec3 stepT = exp(-m.extinction * dt);
      L += throughput * S * (vec3(1.0) - stepT) / max(m.extinction, vec3(1e-9));
      throughput *= stepT;
    }
    if (ground > 0.0) {
      vec3 n = normalize(origin + dir * ground);
      float sunMu = dot(n, sun);
      L += throughput * transmittanceTo(Rg, sunMu) * max(sunMu, 0.0) * groundAlbedo / PI;
    }
    return L;
  }

  // Sky-view texture layout: u is the compass direction, v the elevation, bunched towards the horizon.
  vec2 skyViewUv(vec3 dir) {
    float elevation = asin(clamp(dir.y, -1.0, 1.0));
    float v = 0.5 + 0.5 * sign(elevation) * sqrt(abs(elevation) / (0.5 * PI));
    float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
    return vec2(u, v);
  }
`;

const SKY_VIEW = /* glsl */ `
  ${COMMON}
  ${VIEW_FUNCTIONS}
  uniform vec3 sunDirection;
  varying vec2 vUv;
  void main() {
    float s = vUv.y * 2.0 - 1.0;
    float elevation = sign(s) * s * s * 0.5 * PI;
    float azimuth = (vUv.x - 0.5) * 2.0 * PI;
    vec3 dir = vec3(cos(elevation) * cos(azimuth), sin(elevation), cos(elevation) * sin(azimuth));
    gl_FragColor = vec4(integrateSky(dir, sunDirection), 1.0);
  }
`;

/** The sky seen in a direction: the sky-view texture, the sun disc, and stars at night. */
const SKY_FRAGMENT = /* glsl */ `
  ${COMMON}
  uniform sampler2D skyViewLut;
  uniform vec3 sunDirection;
  uniform float sunIlluminance;
  uniform float sunDisc;
  uniform float night;
  uniform float intensity;
  varying vec3 vDirection;

  vec2 skyViewUv(vec3 dir) {
    float elevation = asin(clamp(dir.y, -1.0, 1.0));
    float v = 0.5 + 0.5 * sign(elevation) * sqrt(abs(elevation) / (0.5 * PI));
    float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
    return vec2(u, v);
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 dir = normalize(vDirection);
    vec3 colour = texture2D(skyViewLut, skyViewUv(dir)).rgb * sunIlluminance;
    // The sun's disc: its light through the atmosphere, darker towards the rim like the real sun.
    float sunRadius = ${A.sunRadius.toExponential(6)};
    float c = dot(dir, sunDirection);
    float angle = acos(clamp(c, -1.0, 1.0));
    if (sunDisc > 0.5 && angle < sunRadius * 1.6) {
      float r = Rg + ${A.viewHeight.toFixed(4)};
      vec3 sunT = transmittanceTo(r, sunDirection.y);
      float x = clamp(angle / sunRadius, 0.0, 1.0);
      float limb = 1.0 - 0.6 * (1.0 - sqrt(max(0.0, 1.0 - x * x)));
      float edge = 1.0 - smoothstep(0.9, 1.1, angle / sunRadius);
      float solidAngle = PI * sunRadius * sunRadius;
      // Far brighter than anything else, so it blooms; held to a level that gives a tight glow, not a white-out.
      vec3 disc = sunT * sunIlluminance / solidAngle * limb * edge;
      colour += disc * min(1.0, 400.0 / max(max(disc.r, disc.g), disc.b));
    }
    // Night: a faint airglow and the stars, brighter higher up where there is less haze.
    if (night > 0.0) {
      float up = max(dir.y, 0.0);
      colour += mix(vec3(1.2e-4, 1.8e-4, 4.0e-4), vec3(0.4e-4, 0.6e-4, 1.6e-4), sqrt(up)) * night;
      // A star is a small round point somewhere in some cells of a fine grid over the dome.
      vec3 grid = dir * 400.0;
      vec3 cell = floor(grid);
      float h = hash(cell);
      vec3 centre = cell + 0.5 + 0.35 * (vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) - 0.5);
      float point = smoothstep(0.35, 0.0, length(grid - centre));
      float star = step(0.97, h) * point * smoothstep(0.0, 0.25, up) * (0.3 + 0.7 * pow(fract(h * 97.0), 3.0));
      colour += vec3(0.9, 0.93, 1.0) * star * 0.002 * night;
    }
    gl_FragColor = vec4(colour * intensity, 1.0);
  }
`;

function lut(width: number, height: number, wrapAround = false): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: wrapAround ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

/** Maps the model's Z-up directions to the sky's Y-up ones: (x, y, z) → (x, z, −y). */
export function toSkyFrame(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

export class PhysicalSky {
  private readonly transmittance = lut(256, 64);
  private readonly multiple = lut(32, 32);
  private readonly skyView = lut(200, 120, true);
  /** A row of the sky just above the horizon, read back for the colour of the haze. */
  private readonly horizonRow = new THREE.WebGLRenderTarget(16, 1, { type: THREE.FloatType, depthBuffer: false });
  private readonly horizonMaterial = new THREE.ShaderMaterial({
    uniforms: { skyViewLut: { value: this.skyView.texture } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D skyViewLut;
      varying vec2 vUv;
      // 3° above the horizon, all the way round.
      void main() { gl_FragColor = vec4(texture2D(skyViewLut, vec2(vUv.x, ${(0.5 + 0.5 * Math.sqrt(3 / 90)).toFixed(5)})).rgb, 1.0); }`,
    depthTest: false,
    depthWrite: false,
  });
  private readonly horizonPixels = new Float32Array(16 * 4);
  private readonly quad = new FullScreenQuad();
  private readonly shared = {
    haze: { value: 1 },
    transmittanceLut: { value: this.transmittance.texture as THREE.Texture },
    multipleLut: { value: this.multiple.texture as THREE.Texture },
    skyViewLut: { value: this.skyView.texture as THREE.Texture },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    sunIlluminance: { value: 1 },
    night: { value: 0 },
  };
  private readonly transmittanceMaterial = this.lutMaterial(TRANSMITTANCE);
  private readonly multipleMaterial = this.lutMaterial(MULTIPLE);
  private readonly skyViewMaterial = this.lutMaterial(SKY_VIEW);
  private hazeDrawn = -1;
  /** A dome for the sky scene (environment and ray tracing): no sun disc, the sun is a light of its own there. */
  readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /**
   * The sky behind the model in the main scene, sun disc included: a full-screen triangle drawn first, its
   * directions taken from the camera that draws it (so mirrors and every view see the right sky). `toSkyFrame`.
   */
  readonly background: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      this.skyMaterial(
        /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
        false,
      ),
    );
    this.dome.material.side = THREE.BackSide;

    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = this.skyMaterial(
      /* glsl */ `
      uniform mat4 cameraWorld;
      uniform mat4 inverseProjection;
      uniform float orthographic;
      varying vec3 vDirection;
      void main() {
        vec4 view = inverseProjection * vec4(position.xy, 1.0, 1.0);
        vec3 local = orthographic > 0.5 ? vec3(0.0, 0.0, -1.0) : view.xyz / view.w;
        vec3 world = (cameraWorld * vec4(local, 0.0)).xyz;
        vDirection = vec3(world.x, world.z, -world.y);
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }`,
      true,
    );
    material.uniforms.cameraWorld = { value: new THREE.Matrix4() };
    material.uniforms.inverseProjection = { value: new THREE.Matrix4() };
    material.uniforms.orthographic = { value: 0 };
    this.background = new THREE.Mesh(triangle, material);
    this.background.frustumCulled = false;
    this.background.renderOrder = -1e6;
    this.background.userData.sky = true;
    this.background.raycast = () => {};
    this.background.onBeforeRender = (_r, _s, camera) => {
      material.uniforms.cameraWorld.value.copy(camera.matrixWorld);
      material.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      material.uniforms.orthographic.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    };
  }

  /**
   * Sets the sun (a Y-up direction, which may be below the horizon), the light of the sun above the atmosphere, the
   * haze and how far night has fallen; redraws the textures that changed.
   */
  update(sun: THREE.Vector3, sunIlluminance: number, haze: number, night: number): void {
    const u = this.shared;
    u.sunDirection.value.copy(sun).normalize();
    u.sunIlluminance.value = sunIlluminance;
    u.haze.value = haze;
    u.night.value = night;
    const previous = this.renderer.getRenderTarget();
    if (haze !== this.hazeDrawn) {
      this.draw(this.transmittanceMaterial, this.transmittance);
      this.draw(this.multipleMaterial, this.multiple);
      this.hazeDrawn = haze;
    }
    this.draw(this.skyViewMaterial, this.skyView);
    this.renderer.setRenderTarget(previous);
  }

  /**
   * The sky's colour just above the horizon, averaged all the way round (linear, in the units of `sunIlluminance`):
   * the colour distant things fade into. Null when this GPU cannot read back floating-point pixels.
   */
  horizonColour(): THREE.Color | null {
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) return null;
    const previous = this.renderer.getRenderTarget();
    this.draw(this.horizonMaterial, this.horizonRow);
    this.renderer.readRenderTargetPixels(this.horizonRow, 0, 0, 16, 1, this.horizonPixels);
    this.renderer.setRenderTarget(previous);
    const sum = [0, 0, 0];
    for (let i = 0; i < 16; i++) for (let c = 0; c < 3; c++) sum[c] += this.horizonPixels[i * 4 + c] / 16;
    const k = this.shared.sunIlluminance.value;
    return new THREE.Color().setRGB(sum[0] * k, sum[1] * k, sum[2] * k, THREE.LinearSRGBColorSpace);
  }

  /** How bright the background behind the model is drawn (1: physical; the dome for lighting stays physical). */
  setIntensity(intensity: number): void {
    this.background.material.uniforms.intensity.value = intensity;
  }

  dispose(): void {
    for (const target of [this.transmittance, this.multiple, this.skyView, this.horizonRow]) target.dispose();
    this.quad.dispose();
  }

  private draw(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  private lutMaterial(fragmentShader: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({ uniforms: this.shared, vertexShader: QUAD_VERTEX, fragmentShader, depthTest: false, depthWrite: false });
  }

  private skyMaterial(vertexShader: string, disc: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.shared, sunDisc: { value: disc ? 1 : 0 }, intensity: { value: 1 } },
      vertexShader,
      fragmentShader: SKY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
  }
}
