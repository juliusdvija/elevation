import * as THREE from 'three';
import { theme } from './theme';
import { ThickLines } from './thickLines';

const AXIS_LENGTH = 1_000_000; // 1 km

/** Red/green/blue model axes: solid on the positive side, dashed on the negative. */
export function createAxes(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'axes';
  const axes: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), theme.axisX],
    [new THREE.Vector3(0, 1, 0), theme.axisY],
    [new THREE.Vector3(0, 0, 1), theme.axisZ],
  ];

  for (const [dir, color] of axes) {
    const positive = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(AXIS_LENGTH)]),
      new THREE.LineBasicMaterial({ color }),
    );
    const negative = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-AXIS_LENGTH)]),
      new THREE.LineDashedMaterial({ color, dashSize: 250, gapSize: 250, transparent: true, opacity: 0.7 }),
    );
    negative.computeLineDistances();
    group.add(positive, negative);
  }
  group.renderOrder = 1;
  return group;
}

/** The smallest 1-2-5 step (…, 0.5, 1, 2, 5, 10, 20, 50 …) that is at least `raw`, within [min, max]. */
export function niceSpacing(raw: number, min = 0.1, max = 100_000): number {
  if (!(raw > 0)) return min;
  const decade = 10 ** Math.floor(Math.log10(raw));
  const m = raw / decade;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * decade;
  return Math.min(max, Math.max(min, Math.round(step * 1e6) / 1e6));
}

const GRID_CELLS = 300; // cells each way: enough to fill the view at the default zoom, few enough to rebuild at any scale

/**
 * Subtle ground grid on the XY plane that follows the snap spacing: cells of `spacing` with a heavier
 * line every ten, centred on the camera target. Rebuilt only when the spacing changes, so a grid of 1 mm
 * cells is as cheap as one of 1 m.
 */
export class AdaptiveGrid {
  readonly group = new THREE.Group();
  private spacing = 0;

  constructor() {
    this.group.name = 'grid';
  }

  update(spacing: number, center: THREE.Vector3): void {
    if (spacing !== this.spacing) {
      this.spacing = spacing;
      for (const child of [...this.group.children]) {
        this.group.remove(child);
        (child as THREE.GridHelper).geometry.dispose();
      }
      const size = spacing * GRID_CELLS;
      const minor = new THREE.GridHelper(size, GRID_CELLS, theme.gridMinor, theme.gridMinor);
      const major = new THREE.GridHelper(size, GRID_CELLS / 10, theme.gridMajor, theme.gridMajor);
      for (const grid of [minor, major]) {
        grid.rotation.x = Math.PI / 2;
        const material = grid.material as THREE.Material;
        material.depthWrite = false;
        grid.renderOrder = -1;
        this.group.add(grid);
      }
    }
    // Follow the target in whole major cells, so lines stay on the same coordinates.
    const step = this.spacing * 10;
    this.group.position.set(Math.round(center.x / step) * step, Math.round(center.y / step) * step, 0);
  }
}

/**
 * The sky as a dome around the camera: `theme.background` at the horizon, bluer towards the zenith, and
 * the ground colour below the horizon. Ground and sky meet at the same colour, so the horizon is soft.
 */
export class SkyGradient {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          horizon: { value: new THREE.Color(theme.background) },
          zenith: { value: new THREE.Color(theme.zenith) },
          below: { value: new THREE.Color(theme.ground) },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        vertexShader: `varying float vHeight;
          void main() { vHeight = normalize(position).z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 below; varying float vHeight;
          void main() {
            vec3 up = mix(horizon, zenith, smoothstep(0.0, 0.75, vHeight));
            vec3 down = mix(horizon, below, smoothstep(0.0, 0.25, -vHeight));
            gl_FragColor = vec4(vHeight >= 0.0 ? up : down, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
  }

  /** Centres the dome on the camera and sizes it to sit inside the far plane. */
  update(camera: THREE.Camera): void {
    const far = camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera ? camera.far : 1e5;
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(far * 0.8);
  }
}

/**
 * An endless flat ground, like SketchUp's: a plane that follows the camera target and blends into the sky colour
 * towards its edge, so there is no visible end. It writes no depth, so anything below z = 0 still shows through
 * it; a second, transparent plane catches the sun's shadows.
 */
export class Ground {
  readonly group = new THREE.Group();
  private readonly plane: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly uniforms = {
    ground: { value: new THREE.Color(theme.ground) },
    sky: { value: new THREE.Color(theme.background) },
    center: { value: new THREE.Vector2() },
    radius: { value: 1 },
  };

  constructor() {
    this.group.name = 'ground';
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.plane = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        depthWrite: false,
        vertexShader: `varying vec3 vWorld;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform vec3 ground; uniform vec3 sky; uniform vec2 center; uniform float radius; varying vec3 vWorld;
          void main() {
            float t = smoothstep(0.3, 1.0, distance(vWorld.xy, center) / radius);
            gl_FragColor = vec4(mix(ground, sky, t), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.plane.renderOrder = -10;
    this.plane.frustumCulled = false;
    this.shadow = new THREE.Mesh(
      geometry,
      new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
    );
    this.shadow.receiveShadow = true;
    this.shadow.frustumCulled = false;
    for (const mesh of [this.plane, this.shadow]) mesh.raycast = () => {};
    this.group.add(this.plane, this.shadow);
  }

  /** Centres the ground under `center` with the given reach (mm). */
  update(center: THREE.Vector3, radius: number): void {
    this.uniforms.center.value.set(center.x, center.y);
    this.uniforms.radius.value = radius;
    this.group.position.set(center.x, center.y, 0);
    this.group.scale.set(radius, radius, 1);
  }
}

/** An arrow with an N on the ground beside the model, pointing to true north (clockwise `angle` degrees from +Y). */
export class NorthArrow {
  readonly group = new THREE.Group();
  private readonly lines = new ThickLines(theme.axisX, 2.5);

  constructor() {
    this.group.name = 'north';
    (this.lines.material as THREE.Material).depthTest = false;
    this.lines.renderOrder = 5;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  /** Draws the arrow south of `bounds` (in model axes); null hides it. */
  update(angle: number | null, bounds: THREE.Box3): void {
    this.group.visible = angle !== null && !bounds.isEmpty();
    if (angle === null || bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y) * 0.18 || 1000;
    const a = (angle * Math.PI) / 180;
    const north = new THREE.Vector2(Math.sin(a), Math.cos(a));
    const side = new THREE.Vector2(north.y, -north.x);
    const centre = bounds.getCenter(new THREE.Vector3());
    const base = new THREE.Vector2(centre.x, bounds.min.y - length * 0.9);
    const at = (along: number, across: number) => base.clone().addScaledVector(north, along).addScaledVector(side, across);
    const segments: [THREE.Vector2, THREE.Vector2][] = [
      [at(0, 0), at(length, 0)],
      [at(length, 0), at(length * 0.8, length * 0.09)],
      [at(length, 0), at(length * 0.8, -length * 0.09)],
      // The letter N, above the tip.
      [at(length * 1.12, -length * 0.07), at(length * 1.3, -length * 0.07)],
      [at(length * 1.3, -length * 0.07), at(length * 1.12, length * 0.07)],
      [at(length * 1.12, length * 0.07), at(length * 1.3, length * 0.07)],
    ];
    this.lines.setSegments(segments.flatMap(([p, q]) => [p.x, p.y, 0, q.x, q.y, 0]));
  }
}
