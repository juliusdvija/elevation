import type * as THREE from 'three';

/** A storey: plans are cut relative to its floor. */
export interface Level {
  id: string;
  name: string;
  /** Floor level above the origin (mm). */
  elevation: number;
}

/**
 * A section cut. Axis 'y' cuts across Y and looks north (+Y); axis 'x' cuts
 * across X and looks west (−X). `position` is the cut's coordinate along the
 * axis (mm); null keeps it in the middle of the model.
 */
export interface SectionDef {
  id: string;
  axis: 'x' | 'y';
  position: number | null;
}

/** A dimension: the distance between two points, drawn on a line `offset` away from them. World mm. */
export interface Dimension {
  id: string;
  a: [number, number, number];
  b: [number, number, number];
  offset: [number, number, number];
}

/** Drawing settings saved with the document. */
export interface DrawingSettings {
  levels: Level[];
  /** Plan cut height above each level's floor (mm). */
  cutHeight: number;
  sections: SectionDef[];
  /** Dimensions in the model; drawn in every view they lie parallel to. */
  dimensions: Dimension[];
}

export const DEFAULT_SETTINGS: DrawingSettings = {
  levels: [{ id: 'level-0', name: 'Ground floor', elevation: 0 }],
  cutHeight: 1200,
  sections: [
    { id: 'A', axis: 'y', position: null },
    { id: 'B', axis: 'x', position: null },
  ],
  dimensions: [],
};

/** Which drawing: a plan of a level, an elevation, or a section. */
export type ViewRef =
  | { kind: 'plan'; level: string }
  | { kind: 'front' | 'right' | 'back' | 'left' }
  | { kind: 'section'; section: string };

/** Levels from lowest to highest. */
export function sortedLevels(settings: DrawingSettings): Level[] {
  return [...settings.levels].sort((a, b) => a.elevation - b.elevation);
}

/** Every drawing of a full set: plans bottom-up, the four elevations, the sections. */
export function allViews(settings: DrawingSettings): ViewRef[] {
  return [
    ...sortedLevels(settings).map((l) => ({ kind: 'plan' as const, level: l.id })),
    { kind: 'front' },
    { kind: 'right' },
    { kind: 'back' },
    { kind: 'left' },
    ...settings.sections.map((s) => ({ kind: 'section' as const, section: s.id })),
  ];
}

/** The section's absolute position, given the model bounds. */
export function sectionCoordinate(section: SectionDef, bounds: THREE.Box3): number {
  if (section.position !== null) return section.position;
  if (bounds.isEmpty()) return 0;
  return section.axis === 'y' ? (bounds.min.y + bounds.max.y) / 2 : (bounds.min.x + bounds.max.x) / 2;
}

/** A new level one storey (3 m) above the highest. */
export function nextLevel(settings: DrawingSettings): Level {
  const top = sortedLevels(settings).at(-1);
  const elevation = top ? top.elevation + 3000 : 0;
  let n = settings.levels.length;
  const ids = new Set(settings.levels.map((l) => l.id));
  while (ids.has(`level-${n}`)) n++;
  return { id: `level-${n}`, name: n === 0 ? 'Ground floor' : `Floor ${n}`, elevation };
}
