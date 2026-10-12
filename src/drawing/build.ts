import * as THREE from 'three';
import type { Document } from '../document';
import type { Model } from '../kernel/Model';
import { computeDrawing } from './project';
import { sortedLevels, type DrawingSettings, type ViewRef } from './settings';
import { layoutSheet, type Paper, type SectionMarker, type Sheet } from './sheet';
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
  return refs.map((ref) => {
    const setup = viewSetup(ref, settings, bounds);
    const drawing = computeDrawing(flat, setup);
    const sheet = layoutSheet(drawing, setup, { levels, sections: markers }, options);
    return { setup, sheet, empty: drawing.lines.length === 0 && drawing.cutLoops.length === 0 };
  });
}
