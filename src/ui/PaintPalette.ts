import { PALETTE, type PaintState } from '../tools/PaintTool';

/** Swatches floating over the viewport while the paint tool is active. */
export class PaintPalette {
  readonly el = document.createElement('div');
  private readonly swatches = new Map<string, HTMLButtonElement>();
  private readonly clear = document.createElement('button');
  private readonly custom = document.createElement('input');

  constructor(private readonly state: PaintState) {
    this.el.className = 'paint-palette';
    this.el.hidden = true;
    for (const { name, color } of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = name;
      b.setAttribute('aria-label', name);
      b.style.background = color;
      b.addEventListener('click', () => (state.color = color));
      this.swatches.set(color, b);
      this.el.append(b);
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
    this.el.append(this.custom, this.clear);
    state.changed.on(() => this.sync());
    this.sync();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  private sync(): void {
    const current = this.state.color;
    for (const [color, button] of this.swatches) button.setAttribute('aria-pressed', String(color === current));
    this.clear.setAttribute('aria-pressed', String(current === undefined));
    if (current) this.custom.value = current;
  }
}
