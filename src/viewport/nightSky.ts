import * as THREE from 'three';

/**
 * The night over the daytime `Sky`: a deep blue dome, lighter at the horizon, with stars. It is part of the sky scene
 * (drawn Y-up, baked into the environment map) and fades in through twilight (`set(night, stars)`).
 */
export class NightSky {
  static readonly HORIZON = 0x2a3c62;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        night: { value: 0 },
        stars: { value: 0 },
        glow: { value: new THREE.Color(0xe0a080) },
        dusk: { value: new THREE.Color(0x4a5f8c) },
        zenith: { value: new THREE.Color(0x0b1430) },
        horizon: { value: new THREE.Color(NightSky.HORIZON) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float night;
        uniform float stars;
        uniform vec3 glow;
        uniform vec3 dusk;
        uniform vec3 zenith;
        uniform vec3 horizon;
        varying vec3 vDirection;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 d = normalize(vDirection);
          float up = max(d.y, 0.0);
          // Twilight: a warm glow low down under a soft blue, darkening into the night's deep blue.
          vec3 low = mix(glow, horizon, stars);
          vec3 high = mix(dusk, zenith, stars);
          vec3 colour = mix(low, high, pow(up, 0.5));
          // Stars: one chance per cell of a grid on the dome, brighter higher up where there is less haze.
          vec3 cell = floor(d * 140.0);
          float h = hash(cell);
          float star = stars * step(0.985, h) * smoothstep(0.0, 0.25, up) * (0.4 + 0.6 * fract(h * 97.0));
          colour += vec3(0.9, 0.93, 1.0) * star * 1.6;
          // Below the horizon: the dark ground the sky would show.
          colour = mix(colour, low * 0.5, smoothstep(0.0, -0.05, d.y));
          gl_FragColor = vec4(colour, night);
        }`,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(40, 64, 32), material);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  set(night: number, stars: number): void {
    this.mesh.material.uniforms.night.value = night;
    this.mesh.material.uniforms.stars.value = stars;
    this.mesh.visible = night > 0.001;
  }
}
