import * as THREE from 'three';
import { sectionCoordinate, type DrawingSettings, type ViewRef } from './settings';

export type ViewKind = ViewRef['kind'];

/**
 * An orthographic view: drawing coordinates are (u, v) on paper, `w` is depth
 * away from the viewer. With `cut` set, only geometry at depth >= cut is drawn
 * and the cut plane itself (w = cut) produces section poché. With
 * `depthLimit` set, nothing deeper than that is drawn (a plan stops at its
 * floor).
 */
export interface ViewSetup {
  ref: ViewRef;
  kind: ViewKind;
  title: string;
  subtitle: string;
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  w: THREE.Vector3;
  cut: number | null;
  depthLimit: number | null;
  /** Draw a ground line at z = 0 and level markers (elevations and sections). */
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

export function viewSetup(ref: ViewRef, settings: DrawingSettings, bounds: THREE.Box3): ViewSetup {
  const origin = new THREE.Vector3();

  if (ref.kind === 'plan') {
    const level = settings.levels.find((l) => l.id === ref.level) ?? settings.levels[0];
    const elevation = level?.elevation ?? 0;
    const cutAt = elevation + settings.cutHeight;
    return {
      ref,
      kind: 'plan',
      title: level?.name ?? 'Plan',
      subtitle: `Plan · cut at +${Math.round(cutAt)}`,
      origin,
      ...frame(Z.clone().negate(), Y),
      cut: -cutAt,
      // Looking down: depth w = -z, so the floor is at w = -elevation.
      depthLimit: -elevation + 1,
      ground: false,
    };
  }

  if (ref.kind === 'section') {
    const section = settings.sections.find((s) => s.id === ref.section) ?? settings.sections[0];
    const at = sectionCoordinate(section, bounds);
    const title = `Section ${section.id}–${section.id}`;
    if (section.axis === 'y') {
      return { ref, kind: 'section', title, subtitle: `Looking north at y = ${Math.round(at)}`, origin, ...frame(Y, Z), cut: at, depthLimit: null, ground: true };
    }
    return { ref, kind: 'section', title, subtitle: `Looking west at x = ${Math.round(at)}`, origin, ...frame(X.clone().negate(), Z), cut: -at, depthLimit: null, ground: true };
  }

  const { w, title } = ELEVATIONS[ref.kind];
  return { ref, kind: ref.kind, title, subtitle: '', origin, ...frame(w, Z), cut: null, depthLimit: null, ground: true };
}

/** World-space plane of a view's cut (normal points away from the viewer), if any. */
export function cutPlane(setup: ViewSetup): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
  if (setup.cut === null) return null;
  return { point: setup.origin.clone().addScaledVector(setup.w, setup.cut), normal: setup.w.clone() };
}
