import type { Document } from '../document';
import { DEFAULT_SUN, type SunSettings } from '../drawing/settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

/** A small panel over the viewport for the 3D view's sun: shadows on or off, and where the sun stands. A view state: no undo steps. */
export class SunPanel {
  readonly el = el('div', 'tags-panel sun-panel');
  private readonly shadows = el('input');
  private readonly direction = el('input');
  private readonly height = el('input');
  private readonly directionLabel = el('span', 'sun-value');
  private readonly heightLabel = el('span', 'sun-value');

  constructor(private readonly doc: Document) {
    this.el.hidden = true;
    this.shadows.type = 'checkbox';
    for (const [input, min, max] of [[this.direction, 0, 359], [this.height, 5, 90]] as const) {
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
    }
    const row = (label: string, control: HTMLElement, value?: HTMLElement) => {
      const r = el('label', 'sun-row');
      r.append(el('span', undefined, label), control);
      if (value) r.append(value);
      return r;
    };
    const reset = el('button', 'pill-button', 'Reset sun');
    reset.addEventListener('click', () => this.apply(DEFAULT_SUN));
    this.el.append(el('h3', undefined, 'Sun'), row('Shadows', this.shadows), row('Direction', this.direction, this.directionLabel), row('Height', this.height, this.heightLabel), reset);
    for (const input of [this.shadows, this.direction, this.height]) input.addEventListener('input', () => this.apply(this.read()));
    doc.settingsChanged.on(() => this.show(this.current()));
    this.show(this.current());
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  private current(): SunSettings {
    return this.doc.drawingSettings.sun ?? DEFAULT_SUN;
  }

  private read(): SunSettings {
    return { shadows: this.shadows.checked, azimuth: Number(this.direction.value), altitude: Number(this.height.value) };
  }

  private apply(sun: SunSettings): void {
    this.doc.setSun(sun);
  }

  private show(sun: SunSettings): void {
    this.shadows.checked = sun.shadows;
    this.direction.value = String(Math.round(sun.azimuth));
    this.height.value = String(Math.round(sun.altitude));
    this.directionLabel.textContent = `${Math.round(sun.azimuth)}° ${compass(sun.azimuth)}`;
    this.heightLabel.textContent = `${Math.round(sun.altitude)}°`;
    for (const input of [this.direction, this.height]) input.disabled = false;
  }
}
