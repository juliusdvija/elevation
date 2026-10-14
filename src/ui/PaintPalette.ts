import { MATERIAL_CATEGORIES, materialById, type MaterialCategory } from '../core/materials';
import { PALETTE, type PaintState } from '../tools/PaintTool';
import { materialThumbnail } from './materialThumbnail';

const CATEGORY_KEY = 'elevation.paintCategory';

/** Material swatches floating over the viewport while the paint tool is active, one category at a time. */
export class PaintPalette {
  readonly el = document.createElement('div');
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private readonly tabs = new Map<MaterialCategory, HTMLButtonElement>();
  private readonly clear = document.createElement('button');
  private readonly custom = document.createElement('input');
  private category: MaterialCategory = 'Masonry';

  constructor(private readonly state: PaintState) {
    this.el.className = 'paint-palette';
    this.el.hidden = true;
    const tabRow = document.createElement('div');
    tabRow.className = 'palette-tabs';
    const swatchRow = document.createElement('div');
    swatchRow.className = 'palette-swatches';
    const controls = document.createElement('div');
    controls.className = 'palette-controls';
    for (const category of MATERIAL_CATEGORIES) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'text-button';
      tab.textContent = category;
      tab.addEventListener('click', () => this.showCategory(category));
      this.tabs.set(category, tab);
      tabRow.append(tab);
    }
    for (const { name, color, opacity, hatch, material } of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch material';
      b.title = hatch ? `${name} (${hatch} pattern in drawings)` : name;
      b.setAttribute('aria-label', name);
      b.style.background = color;
      b.addEventListener('click', () => state.set(color, opacity, hatch, material));
      this.swatches.set(material, b);
      swatchRow.append(b);
    }
    try {
      const saved = localStorage.getItem(CATEGORY_KEY);
      if (MATERIAL_CATEGORIES.includes(saved as MaterialCategory)) this.category = saved as MaterialCategory;
    } catch {
      /* the first category */
    }
    this.custom.type = 'color';
    this.custom.className = 'swatch custom';
    this.custom.title = 'Any colour';
    this.custom.addEventListener('input', () => (state.color = this.custom.value));
    this.clear.type = 'button';
    this.clear.className = 'text-button';
    this.clear.textContent = 'No paint';
    this.clear.title = 'Remove paint from faces you click';
    this.clear.addEventListener('click', () => (state.color = undefined));
    this.custom.title = 'Any colour';
    const patterns = document.createElement('button');
    patterns.type = 'button';
    patterns.className = 'text-button';
    patterns.textContent = 'Patterns';
    patterns.title = 'Give materials their hatch pattern (brick, boards ...) in drawings';
    patterns.setAttribute('aria-pressed', String(state.patterns));
    patterns.addEventListener('click', () => {
      state.patterns = !state.patterns;
      patterns.setAttribute('aria-pressed', String(state.patterns));
    });
    controls.append(this.custom, patterns, this.clear);
    this.el.append(tabRow, swatchRow, controls);
    state.changed.on(() => this.sync());
    this.showCategory(this.category);
    this.sync();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (visible) this.drawThumbnails();
  }

  private showCategory(category: MaterialCategory): void {
    this.category = category;
    for (const [c, tab] of this.tabs) tab.setAttribute('aria-pressed', String(c === category));
    for (const [id, swatch] of this.swatches) swatch.hidden = materialById(id)?.category !== category;
    if (!this.el.hidden) this.drawThumbnails();
    try {
      localStorage.setItem(CATEGORY_KEY, category);
    } catch {
      /* not remembered */
    }
  }

  /** Small rendered previews of the shown materials, drawn the first time they are seen (they need the textures). */
  private drawThumbnails(): void {
    for (const [id, swatch] of this.swatches) {
      if (swatch.hidden || swatch.dataset.drawn) continue;
      const material = materialById(id);
      if (!material) continue;
      swatch.style.background = `center / cover url(${materialThumbnail(material)})`;
      swatch.dataset.drawn = '1';
    }
  }

  private sync(): void {
    const current = this.state.color;
    // A material picked up from a face (Alt+click) shows its own category.
    const category = materialById(this.state.material)?.category;
    if (category && category !== this.category) this.showCategory(category);
    for (const [key, button] of this.swatches) button.setAttribute('aria-pressed', String(key === this.state.material));
    this.clear.setAttribute('aria-pressed', String(current === undefined));
    if (current) this.custom.value = current;
  }
}
