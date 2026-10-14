/** How a material's surface pattern is drawn in the photorealistic view (procedural, no image files). */
export type TextureKind = 'brick' | 'boards' | 'tiles' | 'concrete' | 'plaster' | 'grass' | 'water';

/**
 * A material of the catalogue: the paint (colour, hatch for drawings) plus how it reacts to light in the
 * photorealistic view. Faces refer to one by `id`.
 */
export interface Material {
  id: string;
  name: string;
  color: string;
  opacity?: number;
  /** Hatch pattern in drawings. */
  hatch?: string;
  /** 0 is a mirror, 1 is fully matte. */
  roughness: number;
  metalness: number;
  /** A surface pattern and how large one repeat is in the real world (mm). */
  texture?: { kind: TextureKind; tileMm: number };
  /** How strongly the pattern shows as relief (0 to 1). */
  bump?: number;
}

export const MATERIALS: readonly Material[] = [
  { id: 'plaster', name: 'Plaster', color: '#ece8e1', roughness: 0.95, metalness: 0, texture: { kind: 'plaster', tileMm: 1000 }, bump: 0.2 },
  { id: 'brick', name: 'Brick', color: '#b5654a', hatch: 'brick', roughness: 0.85, metalness: 0, texture: { kind: 'brick', tileMm: 1000 }, bump: 0.8 },
  { id: 'terracotta', name: 'Terracotta', color: '#cf7b5a', hatch: 'tiles', roughness: 0.75, metalness: 0, texture: { kind: 'tiles', tileMm: 1000 }, bump: 0.6 },
  { id: 'timber', name: 'Timber', color: '#c19a6b', hatch: 'boards', roughness: 0.65, metalness: 0, texture: { kind: 'boards', tileMm: 1000 }, bump: 0.4 },
  { id: 'sand', name: 'Sand', color: '#d9c7a3', roughness: 1, metalness: 0, texture: { kind: 'plaster', tileMm: 600 }, bump: 0.3 },
  { id: 'concrete', name: 'Concrete', color: '#a9a9a4', hatch: 'concrete', roughness: 0.9, metalness: 0, texture: { kind: 'concrete', tileMm: 2000 }, bump: 0.4 },
  { id: 'slate', name: 'Slate', color: '#5f6b73', hatch: 'tiles', roughness: 0.6, metalness: 0, texture: { kind: 'tiles', tileMm: 1000 }, bump: 0.5 },
  { id: 'black-metal', name: 'Black metal', color: '#2b2b2b', roughness: 0.35, metalness: 0.9 },
  { id: 'glass', name: 'Glass', color: '#9fc3d6', opacity: 0.4, roughness: 0.02, metalness: 0 },
  { id: 'moss', name: 'Moss', color: '#8fae6e', hatch: 'grass', roughness: 1, metalness: 0, texture: { kind: 'grass', tileMm: 500 }, bump: 0.6 },
  { id: 'forest', name: 'Forest', color: '#4f6b52', hatch: 'grass', roughness: 1, metalness: 0, texture: { kind: 'grass', tileMm: 500 }, bump: 0.6 },
  { id: 'water', name: 'Water', color: '#6f9bb5', roughness: 0.05, metalness: 0, texture: { kind: 'water', tileMm: 3000 }, bump: 0.15 },
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
