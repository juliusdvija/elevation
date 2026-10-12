import * as THREE from 'three';

export type ViewKind = 'plan' | 'front' | 'right' | 'back' | 'left' | 'section';

export interface ViewOptions {
  /** Height of the plan cut above the ground (mm). */
  cutHeight: number;
  /** Section A–A cuts across Y (looking north), B–B across X (looking west). */
  sectionAxis: 'x' | 'y';
  /** Position of the section within the model bounds, 0..1. */
  sectionPosition: number;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { cutHeight: 1200, sectionAxis: 'y', sectionPosition: 0.5 };

/**
 * An orthographic view: drawing coordinates are (u, v) on paper, `w` is depth
 * away from the viewer. With `cut` set, only geometry at depth >= cut is drawn
 * and the cut plane itself (w = cut) produces section poché.
 */
export interface ViewSetup {
  kind: ViewKind;
  title: string;
  subtitle: string;
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  w: THREE.Vector3;
  cut: number | null;
  /** Draw a ground line at z = 0 (elevations and sections). */
  ground: boolean;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function frame(w: THREE.Vector3, up: THREE.Vector3) {
  return { w: w.clone(), u: new THREE.Vector3().crossVectors(w, up), v: up.clone() };
}

const ELEVATIONS: Record<'front' | 'right' | 'back' | 'left', { w: THREE.Vector3; title: string }> = {
  front: { w: Y, title: 'Front elevation' },
  right: { w: X.clone().negate(), title: 'Right elevation' },
  back: { w: Y.clone().negate(), title: 'Back elevation' },
  left: { w: X, title: 'Left elevation' },
};

export function viewSetup(kind: ViewKind, options: ViewOptions, bounds: THREE.Box3): ViewSetup {
  const origin = new THREE.Vector3();

  if (kind === 'plan') {
    return {
      kind,
      title: 'Plan',
      subtitle: `Cut at +${Math.round(options.cutHeight)}`,
      origin,
      ...frame(Z.clone().negate(), Y),
      cut: -options.cutHeight,
      ground: false,
    };
  }

  if (kind === 'section') {
    const t = THREE.MathUtils.clamp(options.sectionPosition, 0, 1);
    const empty = bounds.isEmpty();
    if (options.sectionAxis === 'y') {
      const y = empty ? 0 : THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, t);
      return { kind, title: 'Section A–A', subtitle: `Looking north at y = ${Math.round(y)}`, origin, ...frame(Y, Z), cut: y, ground: true };
    }
    const x = empty ? 0 : THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, t);
    return {
      kind,
      title: 'Section B–B',
      subtitle: `Looking west at x = ${Math.round(x)}`,
      origin,
      ...frame(X.clone().negate(), Z),
      cut: -x,
      ground: true,
    };
  }

  const { w, title } = ELEVATIONS[kind];
  return { kind, title, subtitle: '', origin, ...frame(w, Z), cut: null, ground: true };
}

/** World-space plane of a view's cut (normal points away from the viewer), if any. */
export function cutPlane(setup: ViewSetup): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (setup.cut === null) return null;
  return { point: setup.origin.clone().addScaledVector(setup.w, setup.cut), normal: setup.w.clone() };
}
