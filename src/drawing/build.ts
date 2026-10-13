import * as THREE from 'three';
import type { Document } from '../document';
import type { Model } from '../kernel/Model';
import { computeDrawing } from './project';
import { sortedLevels, type DrawingSettings, type ViewRef } from './settings';
import { layoutSheet, type DimensionMarker, type Paper, type SectionMarker, type Sheet } from './sheet';
import { dimensionShape, parallelToView } from './dimensions';
import { viewSetup, type ViewSetup } from './views';

export interface BuildOptions {
  scale: number;
  paper?: Paper;
}

/** Section symbols for plans: each section's cut line and viewing direction in plan coordinates. */
function sectionMarkers(settings: DrawingSettings, bounds: THREE.Box3): SectionMarker[] {
  return settings.sections.map((section) => {
    const setup = viewSetup({ kind: 'section', section: section.id }, settings, bounds);
    const point3 = setup.origin.clone().addScaledVector(setup.w, setup.cut ?? 0);
    const look = new THREE.Vector2(setup.w.x, setup.w.y).normalize();
    return { id: section.id, point: new THREE.Vector2(point3.x, point3.y), direction: new THREE.Vector2(-look.y, look.x), look };
  });
}

/** Dimensions that lie parallel to a view, in its drawing coordinates. */
function dimensionMarkers(settings: DrawingSettings, setup: ViewSetup): DimensionMarker[] {
  const uv = (p: THREE.Vector3) => new THREE.Vector2(p.dot(setup.u), p.dot(setup.v));
  let floor = -Infinity;
  let ceiling = Infinity;
  if (setup.ref.kind === 'plan') {
    // A plan shows the dimensions of its own storey.
    const levels = sortedLevels(settings);
    const i = levels.findIndex((l) => l.id === (setup.ref as { level: string }).level);
    if (i >= 0) {
      floor = levels[i].elevation;
      ceiling = levels[i + 1]?.elevation ?? Infinity;
    }
  }
  return settings.dimensions
    .filter((d) => parallelToView(d, setup.w) && d.a[2] >= floor - 1 && d.a[2] < ceiling - 1)
    .map((d) => {
      const s = dimensionShape(d);
      return { a: uv(s.a), b: uv(s.b), a2: uv(s.a2), b2: uv(s.b2), text: String(Math.round(s.length)) };
    });
}

/** Builds finished sheets for several views, flattening the model only once. */
export function buildSheets(
  doc: Document,
  refs: ViewRef[],
  options: BuildOptions,
  flat: Model = doc.flatten(),
  settings: DrawingSettings = doc.drawingSettings,
): { setup: ViewSetup; sheet: Sheet; empty: boolean }[] {
  const bounds = flat.bounds();
  const markers = sectionMarkers(settings, bounds);
  const levels = sortedLevels(settings);
  const faceMe = doc.hasFaceMe;
  return refs.map((ref) => {
    const setup = viewSetup(ref, settings, bounds);
    // Scale figures face the viewer of each elevation and section; in plans they stay as stored.
    const viewer = faceMe && setup.kind !== 'plan' ? setup.w.clone().multiplyScalar(-1e6) : null;
    const drawing = computeDrawing(faceMe ? doc.flatten(viewer) : flat, setup, { shading: settings.shading });
    const sheet = layoutSheet(drawing, setup, { levels, sections: markers, dimensions: dimensionMarkers(settings, setup), autoDimensions: settings.autoDimensions }, options);
    return { setup, sheet, empty: drawing.lines.length === 0 && drawing.cutLoops.length === 0 };
  });
}
