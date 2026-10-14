import type { Material } from '../core/materials';
import { mapsFor } from '../viewport/proceduralTextures';

const SIZE = 64;

/**
 * A small preview of a material for the palette: its pattern tinted with its colour, a soft light from the top left,
 * a highlight that is sharp and bright for glossy and metal surfaces, and a checkerboard behind see-through ones.
 * Returns a data URL.
 */
export function materialThumbnail(m: Material): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  if (m.opacity !== undefined && m.opacity < 1) {
    for (let y = 0; y < SIZE; y += 8) for (let x = 0; x < SIZE; x += 8) {
      g.fillStyle = (x + y) % 16 ? '#ffffff' : '#c9c9c9';
      g.fillRect(x, y, 8, 8);
    }
    g.globalAlpha = m.opacity;
  }
  g.fillStyle = m.color;
  g.fillRect(0, 0, SIZE, SIZE);
  if (m.texture) {
    // The pattern multiplies the colour; show about a quarter of a repeat so it is readable at this size.
    const source = mapsFor(m.texture.kind).map.image as HTMLCanvasElement;
    g.globalCompositeOperation = 'multiply';
    g.drawImage(source, 0, 0, source.width / 2, source.height / 2, 0, 0, SIZE, SIZE);
    g.globalCompositeOperation = 'source-over';
  }
  g.globalAlpha = 1;
  // Shading: light from the top left, a darker bottom right; metal reflects more contrast.
  const shade = g.createLinearGradient(0, 0, SIZE, SIZE);
  shade.addColorStop(0, `rgba(255,255,255,${0.1 + 0.15 * m.metalness})`);
  shade.addColorStop(1, `rgba(0,0,0,${0.15 + 0.3 * m.metalness})`);
  g.fillStyle = shade;
  g.fillRect(0, 0, SIZE, SIZE);
  const gloss = Math.max(1 - m.roughness, m.clearcoat ?? 0);
  if (gloss > 0.2) {
    const radius = SIZE * (0.15 + 0.45 * (1 - gloss));
    const highlight = g.createRadialGradient(SIZE * 0.3, SIZE * 0.28, 0, SIZE * 0.3, SIZE * 0.28, radius);
    highlight.addColorStop(0, `rgba(255,255,255,${0.75 * gloss})`);
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = highlight;
    g.fillRect(0, 0, SIZE, SIZE);
  }
  return canvas.toDataURL();
}
