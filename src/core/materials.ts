/** How a material's surface pattern is drawn in the photorealistic view (procedural, no image files). */
export type TextureKind =
  | 'brick'
  | 'boards'
  | 'planks'
  | 'tiles'
  | 'concrete'
  | 'plaster'
  | 'marble'
  | 'terrazzo'
  | 'brushed'
  | 'fabric'
  | 'gravel'
  | 'grass'
  | 'water';

/** The groups the paint palette shows materials in. */
export const MATERIAL_CATEGORIES = ['Masonry', 'Wood', 'Stone', 'Metal', 'Glass', 'Finishes', 'Fabric', 'Landscape'] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/**
 * A material of the catalogue: the paint (colour, hatch for drawings) plus how it reacts to light in the
 * photorealistic view (physically based: the metal/roughness model with clear coat, sheen and transmission).
 * Faces refer to one by `id`.
 */
export interface Material {
  id: string;
  name: string;
  category?: MaterialCategory;
  color: string;
  opacity?: number;
  /** Hatch pattern in drawings. */
  hatch?: string;
  /** 0 is a mirror, 1 is fully matte. */
  roughness: number;
  metalness: number;
  /** A glossy varnish or lacquer layer over the surface (0 to 1), and how rough that layer is. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Soft velvety rim light of cloth (0 to 1). */
  sheen?: number;
  /** Highlights stretched along the pattern, as on brushed metal (0 to 1). */
  anisotropy?: number;
  /** How much light passes through (glass, 0 to 1) and how strongly it bends (index of refraction); used by ray tracing. */
  transmission?: number;
  ior?: number;
  /** A surface pattern and how large one repeat is in the real world (mm). */
  texture?: { kind: TextureKind; tileMm: number };
  /** How strongly the pattern shows as relief (0 to 1). */
  bump?: number;
}

const tex = (kind: TextureKind, tileMm: number) => ({ texture: { kind, tileMm } });

export const MATERIALS: readonly Material[] = [
  // The first twelve are the original catalogue; their ids and looks stay as they were so saved files do not change.
  { id: 'plaster', name: 'Plaster', category: 'Masonry', color: '#ece8e1', roughness: 0.95, metalness: 0, ...tex('plaster', 1000), bump: 0.2 },
  { id: 'brick', name: 'Brick', category: 'Masonry', color: '#b5654a', hatch: 'brick', roughness: 0.85, metalness: 0, ...tex('brick', 1000), bump: 0.8 },
  { id: 'terracotta', name: 'Terracotta', category: 'Masonry', color: '#cf7b5a', hatch: 'tiles', roughness: 0.75, metalness: 0, ...tex('tiles', 1000), bump: 0.6 },
  { id: 'timber', name: 'Timber', category: 'Wood', color: '#c19a6b', hatch: 'boards', roughness: 0.65, metalness: 0, ...tex('boards', 1000), bump: 0.4 },
  { id: 'sand', name: 'Sand', category: 'Landscape', color: '#d9c7a3', roughness: 1, metalness: 0, ...tex('plaster', 600), bump: 0.3 },
  { id: 'concrete', name: 'Concrete', category: 'Stone', color: '#a9a9a4', hatch: 'concrete', roughness: 0.9, metalness: 0, ...tex('concrete', 2000), bump: 0.4 },
  { id: 'slate', name: 'Slate', category: 'Stone', color: '#5f6b73', hatch: 'tiles', roughness: 0.6, metalness: 0, ...tex('tiles', 1000), bump: 0.5 },
  { id: 'black-metal', name: 'Black metal', category: 'Metal', color: '#2b2b2b', roughness: 0.35, metalness: 0.9 },
  { id: 'glass', name: 'Glass', category: 'Glass', color: '#9fc3d6', opacity: 0.4, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5 },
  { id: 'moss', name: 'Moss', category: 'Landscape', color: '#8fae6e', hatch: 'grass', roughness: 1, metalness: 0, ...tex('grass', 500), bump: 0.6 },
  { id: 'forest', name: 'Forest', category: 'Landscape', color: '#4f6b52', hatch: 'grass', roughness: 1, metalness: 0, ...tex('grass', 500), bump: 0.6 },
  { id: 'water', name: 'Water', category: 'Landscape', color: '#6f9bb5', roughness: 0.05, metalness: 0, ...tex('water', 3000), bump: 0.15, transmission: 0.6, ior: 1.33 },

  // Masonry
  { id: 'white-brick', name: 'White brick', category: 'Masonry', color: '#e4dfd6', hatch: 'brick', roughness: 0.85, metalness: 0, ...tex('brick', 1000), bump: 0.7 },
  { id: 'dark-brick', name: 'Dark brick', category: 'Masonry', color: '#5a4038', hatch: 'brick', roughness: 0.85, metalness: 0, ...tex('brick', 1000), bump: 0.8 },
  { id: 'render', name: 'Render', category: 'Masonry', color: '#d6cdbf', roughness: 1, metalness: 0, ...tex('plaster', 400), bump: 0.5 },
  // Wood
  { id: 'oak-floor', name: 'Oak floor', category: 'Wood', color: '#c08e5c', hatch: 'boards', roughness: 0.45, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.25, ...tex('planks', 1500), bump: 0.3 },
  { id: 'walnut', name: 'Walnut', category: 'Wood', color: '#6e4b33', hatch: 'boards', roughness: 0.4, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15, ...tex('planks', 1500), bump: 0.25 },
  { id: 'ash', name: 'Ash', category: 'Wood', color: '#dcc6a2', hatch: 'boards', roughness: 0.55, metalness: 0, ...tex('planks', 1500), bump: 0.25 },
  { id: 'charred-timber', name: 'Charred timber', category: 'Wood', color: '#2b2725', hatch: 'boards', roughness: 0.85, metalness: 0, ...tex('boards', 1000), bump: 0.7 },
  // Stone
  { id: 'polished-concrete', name: 'Polished concrete', category: 'Stone', color: '#b3b0aa', hatch: 'concrete', roughness: 0.35, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, ...tex('concrete', 2500), bump: 0.05 },
  { id: 'marble', name: 'White marble', category: 'Stone', color: '#eeebe6', roughness: 0.15, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.05, ...tex('marble', 1500), bump: 0.02 },
  { id: 'dark-marble', name: 'Dark marble', category: 'Stone', color: '#3b3a3c', roughness: 0.15, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.05, ...tex('marble', 1500), bump: 0.02 },
  { id: 'terrazzo', name: 'Terrazzo', category: 'Stone', color: '#ddd8cf', hatch: 'concrete', roughness: 0.3, metalness: 0, clearcoat: 0.4, ...tex('terrazzo', 800), bump: 0.05 },
  { id: 'limestone', name: 'Limestone', category: 'Stone', color: '#d8ceb8', hatch: 'tiles', roughness: 0.8, metalness: 0, ...tex('tiles', 2400), bump: 0.3 },
  // Metal
  { id: 'brushed-steel', name: 'Brushed steel', category: 'Metal', color: '#b8bbbe', roughness: 0.35, metalness: 1, anisotropy: 0.7, ...tex('brushed', 400), bump: 0.05 },
  { id: 'chrome', name: 'Chrome', category: 'Metal', color: '#eaeaec', roughness: 0.04, metalness: 1 },
  { id: 'aluminium', name: 'Aluminium', category: 'Metal', color: '#d2d5d8', roughness: 0.45, metalness: 0.95 },
  { id: 'copper', name: 'Copper', category: 'Metal', color: '#c27a50', roughness: 0.3, metalness: 1 },
  { id: 'brass', name: 'Brass', category: 'Metal', color: '#cba45a', roughness: 0.25, metalness: 1 },
  { id: 'corten', name: 'Weathering steel', category: 'Metal', color: '#87482a', roughness: 0.9, metalness: 0.3, ...tex('concrete', 1200), bump: 0.4 },
  // Glass
  { id: 'frosted-glass', name: 'Frosted glass', category: 'Glass', color: '#e3ecf0', opacity: 0.65, roughness: 0.45, metalness: 0, transmission: 1, ior: 1.5 },
  { id: 'tinted-glass', name: 'Tinted glass', category: 'Glass', color: '#5b6f78', opacity: 0.5, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5 },
  { id: 'mirror', name: 'Mirror', category: 'Glass', color: '#f2f2f2', roughness: 0, metalness: 1 },
  // Finishes
  { id: 'matte-white', name: 'Matte white', category: 'Finishes', color: '#f1f0ec', roughness: 0.9, metalness: 0 },
  { id: 'gloss-white', name: 'Gloss white', category: 'Finishes', color: '#f5f5f3', roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 },
  { id: 'white-tile', name: 'White tile', category: 'Finishes', color: '#f2f1ed', hatch: 'tiles', roughness: 0.2, metalness: 0, clearcoat: 0.6, ...tex('tiles', 300), bump: 0.3 },
  { id: 'red-lacquer', name: 'Red lacquer', category: 'Finishes', color: '#a4282a', roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 },
  { id: 'black-rubber', name: 'Black rubber', category: 'Finishes', color: '#2c2c2c', roughness: 0.95, metalness: 0 },
  // Fabric
  { id: 'linen', name: 'Linen', category: 'Fabric', color: '#d8cfbf', roughness: 1, metalness: 0, sheen: 0.6, ...tex('fabric', 60), bump: 0.3 },
  { id: 'wool', name: 'Grey wool', category: 'Fabric', color: '#7e8083', roughness: 1, metalness: 0, sheen: 0.8, ...tex('fabric', 120), bump: 0.5 },
  { id: 'velvet', name: 'Blue velvet', category: 'Fabric', color: '#2f3f6c', roughness: 0.9, metalness: 0, sheen: 1, ...tex('fabric', 40), bump: 0.1 },
  { id: 'leather', name: 'Leather', category: 'Fabric', color: '#7b4a2d', roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.4, sheen: 0.3, ...tex('plaster', 150), bump: 0.5 },
  // Landscape
  { id: 'gravel', name: 'Gravel', category: 'Landscape', color: '#a39e93', roughness: 0.95, metalness: 0, ...tex('gravel', 500), bump: 0.9 },
  { id: 'asphalt', name: 'Asphalt', category: 'Landscape', color: '#4b4b4d', hatch: 'concrete', roughness: 0.9, metalness: 0, ...tex('gravel', 150), bump: 0.4 },
  { id: 'paving', name: 'Paving', category: 'Landscape', color: '#bcb5a8', hatch: 'tiles', roughness: 0.8, metalness: 0, ...tex('tiles', 1200), bump: 0.5 },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export function materialById(id: string | undefined): Material | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

/** What a face looks like in the photorealistic view: its catalogue material, else matte paint, else plain white-ish; glass when see-through. */
export function materialOf(face: { color?: string; opacity?: number; material?: string }): Material {
  const own = materialById(face.material);
  const color = face.color ?? own?.color ?? '#ffffff';
  const opacity = face.opacity ?? own?.opacity;
  if (own) return color === own.color && opacity === own.opacity ? own : { ...own, color, opacity };
  const glass = opacity !== undefined && opacity < 1;
  return { id: `paint:${color}:${opacity ?? 1}`, name: 'Paint', color, opacity, roughness: glass ? 0.02 : 0.9, metalness: 0 };
}
