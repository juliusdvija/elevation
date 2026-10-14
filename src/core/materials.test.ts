import { describe, expect, it } from 'vitest';
import { MATERIALS, materialById, materialOf } from './materials';

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
    }
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
