import { describe, expect, it } from 'vitest';
import { MATERIAL_CATEGORIES, MATERIALS, materialById, materialOf } from './materials';

describe('material catalogue', () => {
  it('has unique ids and valid physical values', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    for (const m of MATERIALS) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.roughness).toBeGreaterThanOrEqual(0);
      expect(m.roughness).toBeLessThanOrEqual(1);
      expect(m.metalness).toBeGreaterThanOrEqual(0);
      expect(m.metalness).toBeLessThanOrEqual(1);
      if (m.texture) expect(m.texture.tileMm).toBeGreaterThan(0);
      expect(MATERIAL_CATEGORIES).toContain(m.category);
      for (const v of [m.clearcoat, m.clearcoatRoughness, m.sheen, m.anisotropy, m.transmission, m.opacity, m.bump]) {
        if (v === undefined) continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (m.ior !== undefined) expect(m.ior).toBeGreaterThan(1);
    }
  });

  it('has ready-made materials in every category', () => {
    expect(MATERIALS.length).toBeGreaterThanOrEqual(40);
    for (const category of MATERIAL_CATEGORIES) expect(MATERIALS.filter((m) => m.category === category).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the original materials as they were, so saved files look the same', () => {
    const originals = MATERIALS.slice(0, 12).map(({ id, color, opacity, hatch, roughness, metalness, texture, bump }) => ({ id, color, opacity, hatch, roughness, metalness, texture, bump }));
    expect(originals.map((m) => m.id)).toEqual(['plaster', 'brick', 'terracotta', 'timber', 'sand', 'concrete', 'slate', 'black-metal', 'glass', 'moss', 'forest', 'water']);
    expect(originals[1]).toEqual({ id: 'brick', color: '#b5654a', opacity: undefined, hatch: 'brick', roughness: 0.85, metalness: 0, texture: { kind: 'brick', tileMm: 1000 }, bump: 0.8 });
    expect(originals[8]).toMatchObject({ color: '#9fc3d6', opacity: 0.4, roughness: 0.02 });
  });

  it('looks a material up by id', () => {
    expect(materialById('brick')?.hatch).toBe('brick');
    expect(materialById('nope')).toBeUndefined();
    expect(materialById(undefined)).toBeUndefined();
  });

  it('resolves what a face looks like', () => {
    expect(materialOf({ material: 'glass' }).opacity).toBe(0.4);
    // The face's own paint wins over the catalogue colour, keeping the material's behaviour.
    const custom = materialOf({ material: 'timber', color: '#112233' });
    expect(custom.color).toBe('#112233');
    expect(custom.texture?.kind).toBe('boards');
    // Plain paint is matte; see-through paint is glossy glass.
    expect(materialOf({ color: '#ff0000' })).toMatchObject({ color: '#ff0000', roughness: 0.9, metalness: 0 });
    expect(materialOf({ color: '#ff0000', opacity: 0.3 }).roughness).toBeLessThan(0.1);
    expect(materialOf({}).color).toBe('#ffffff');
  });
});
