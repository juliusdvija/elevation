import type * as THREE from 'three';
import type { CameraData } from '../io/format';
import type { Layout } from './layout';

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

/** A tag (layer): groups and components on it hide and show together. */
export interface Tag {
  id: string;
  name: string;
  visible: boolean;
}

/** A saved 3D view: a name, where the camera stands, and which tags are hidden in it. Placed on sheets as a picture. */
export interface Scene {
  id: string;
  name: string;
  camera: CameraData;
  /** Tags switched off in this view (absent: none). */
  hidden?: string[];
}

/** The sun of the 3D view: shadows on or off, its compass direction (degrees clockwise from north, +Y) and its height above the horizon (degrees). */
export interface SunSettings {
  shadows: boolean;
  azimuth: number;
  altitude: number;
}

export const DEFAULT_SUN: SunSettings = { shadows: true, azimuth: 248, altitude: 51 };

/** Drawing settings saved with the document. */
export interface DrawingSettings {
  levels: Level[];
  /** Plan cut height above each level's floor (mm). */
  cutHeight: number;
  sections: SectionDef[];
  /** Dimensions in the model; drawn in every view they lie parallel to. */
  dimensions: Dimension[];
  /** Add overall dimensions (and a chain along cut walls) to every drawing. */
  autoDimensions: boolean;
  /** Tint faces by orientation to a fixed light, and cast ground shadows in plans. */
  shading: boolean;
  /** Faces meeting at less than this angle (degrees) shade smoothly and show no edge line between them, in 3D and in drawings (except as a silhouette); 0 is off (format 6). */
  smoothAngle: number;
  /** Tags for groups and components (format 6). */
  tags: Tag[];
  /** Saved 3D views (format 5). */
  scenes: Scene[];
  /** Pages with several drawings each (format 4). */
  layouts: Layout[];
  /** The 3D view's sun (absent in older files: the default). */
  sun?: SunSettings;
}

export const DEFAULT_SETTINGS: DrawingSettings = {
  levels: [{ id: 'level-0', name: 'Ground floor', elevation: 0 }],
  cutHeight: 1200,
  sections: [
    { id: 'A', axis: 'y', position: null },
    { id: 'B', axis: 'x', position: null },
  ],
  dimensions: [],
  autoDimensions: false,
  shading: false,
  smoothAngle: 20,
  tags: [],
  scenes: [],
  layouts: [],
  sun: { ...DEFAULT_SUN },
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
