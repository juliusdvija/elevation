import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** A finished look for the photorealistic picture: how light is mapped to the screen and graded, like a film stock. */
export interface Look {
  name: string;
  /** How bright light is squeezed into what a screen can show. */
  toneMapping: THREE.ToneMapping;
  /** Multiplies the panel's exposure. */
  exposure: number;
  /** Around 1: below is flatter, above punchier. */
  contrast: number;
  /** 1 keeps colours, 0 is grey. */
  saturation: number;
  /** Warm (positive) or cool (negative) white balance, about −0.2 to 0.2. */
  temperature: number;
  /** Darkening towards the corners, 0 to 1. */
  vignette: number;
  /** Glow around very bright things (sun glints, the sun in the sky), 0 to 1. */
  bloom: number;
}

export const LOOKS = {
  natural: { name: 'Natural', toneMapping: THREE.AgXToneMapping, exposure: 1.15, contrast: 1.06, saturation: 1.08, temperature: 0.01, vignette: 0.18, bloom: 0.18 },
  warm: { name: 'Warm', toneMapping: THREE.AgXToneMapping, exposure: 1.15, contrast: 1.08, saturation: 1.12, temperature: 0.08, vignette: 0.25, bloom: 0.25 },
  crisp: { name: 'Crisp', toneMapping: THREE.NeutralToneMapping, exposure: 0.95, contrast: 1.12, saturation: 1.02, temperature: -0.03, vignette: 0.08, bloom: 0.1 },
  bright: { name: 'Bright', toneMapping: THREE.NeutralToneMapping, exposure: 1.2, contrast: 0.96, saturation: 1, temperature: 0, vignette: 0, bloom: 0.12 },
  moody: { name: 'Moody', toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.85, contrast: 1.2, saturation: 0.82, temperature: -0.02, vignette: 0.45, bloom: 0.3 },
} satisfies Record<string, Look>;

export type LookId = keyof typeof LOOKS;

export function isLook(id: unknown): id is LookId {
  return typeof id === 'string' && id in LOOKS;
}

/**
 * The grade, applied to the finished (tone-mapped, display) picture: contrast around mid grey, saturation,
 * white balance and a soft vignette. Kept to a few cheap operations so it costs nothing per frame.
 */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1 },
    saturation: { value: 1 },
    temperature: { value: 0 },
    vignette: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform float temperature;
    uniform float vignette;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      // White balance: warm lifts red and lowers blue, cool the other way.
      c *= vec3(1.0 + temperature, 1.0 + temperature * 0.15, 1.0 - temperature);
      // Saturation around the luminance.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      // Contrast: an S-curve around mid grey that keeps black and white in place.
      c = clamp(c, 0.0, 1.0);
      vec3 s = c * c * (3.0 - 2.0 * c);
      c = contrast >= 1.0 ? mix(c, s, contrast - 1.0) : mix(c, vec3(0.5), (1.0 - contrast) * 0.5);
      // Vignette: an ellipse that follows the frame.
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.35, 0.95, length(p) * 1.35);
      gl_FragColor = vec4(c, texel.a);
    }`,
};

export function createGradePass(): ShaderPass {
  return new ShaderPass(GradeShader);
}

export function applyLook(pass: ShaderPass, look: Look, aspect: number): void {
  const u = pass.uniforms as Record<string, THREE.IUniform>;
  u.contrast.value = look.contrast;
  u.saturation.value = look.saturation;
  u.temperature.value = look.temperature;
  u.vignette.value = look.vignette;
  u.aspect.value = aspect;
}
