import { DEFAULT_REALISTIC, type RealisticRenderer, type RealisticSettings } from '../viewport/RealisticRenderer';
import { isLook, LOOKS } from '../viewport/grading';
import { HDRIS, isHdri } from '../viewport/hdri';
import type { Document } from '../document';
import { DEFAULT_SUN, type SunSettings } from '../drawing/settings';

const KEY = 'elevation.realistic';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function range(min: number, max: number, step: number): HTMLInputElement {
  const node = el('input');
  node.type = 'range';
  node.min = String(min);
  node.max = String(max);
  node.step = String(step);
  return node;
}

/** Settings read back from the browser, ignoring anything that is not a plausible value. */
export function loadRealisticSettings(): RealisticSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return { ...DEFAULT_REALISTIC };
    const number = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && value >= min && value <= max ? value : fallback);
    return {
      exposure: number(saved.exposure, DEFAULT_REALISTIC.exposure, 0.2, 2.5),
      skyLight: number(saved.skyLight, DEFAULT_REALISTIC.skyLight, 0, 1),
      occlusion: typeof saved.occlusion === 'boolean' ? saved.occlusion : DEFAULT_REALISTIC.occlusion,
      occlusionStrength: number(saved.occlusionStrength, DEFAULT_REALISTIC.occlusionStrength, 0, 1),
      shadowSize: [1024, 2048, 4096].includes(saved.shadowSize) ? saved.shadowSize : DEFAULT_REALISTIC.shadowSize,
      haze: number(saved.haze, DEFAULT_REALISTIC.haze, 0, 1),
      rayTracing: typeof saved.rayTracing === 'boolean' ? saved.rayTracing : DEFAULT_REALISTIC.rayTracing,
      raySamples: [64, 256, 1024].includes(saved.raySamples) ? saved.raySamples : DEFAULT_REALISTIC.raySamples,
      rayBounces: Math.round(number(saved.rayBounces, DEFAULT_REALISTIC.rayBounces, 1, 12)),
      look: isLook(saved.look) ? saved.look : DEFAULT_REALISTIC.look,
      sky: saved.sky === 'time' || isHdri(saved.sky) ? saved.sky : DEFAULT_REALISTIC.sky,
      reflections: typeof saved.reflections === 'boolean' ? saved.reflections : DEFAULT_REALISTIC.reflections,
    };
  } catch {
    return { ...DEFAULT_REALISTIC };
  }
}

/**
 * A small panel over the viewport for the photorealistic view: brightness, how much light the sky gives,
 * corner shading, shadow sharpness and haze. A viewer preference, remembered in the browser; no undo steps.
 */
export class RenderPanel {
  readonly el = el('div', 'tags-panel render-panel');
  private readonly exposure = range(0.2, 2.5, 0.05);
  private readonly sky = range(0, 1, 0.01);
  private readonly occlusion = el('input');
  private readonly occlusionStrength = range(0, 1, 0.05);
  private readonly shadows = el('select', 'tag-select');
  private readonly haze = range(0, 1, 0.05);
  private readonly look = el('select', 'tag-select');
  private readonly skyChoice = el('select', 'tag-select');
  private readonly reflections = el('input');
  private readonly rayTracing = el('input');
  private readonly raySamples = el('select', 'tag-select');
  private readonly rayBounces = range(1, 12, 1);
  private readonly rayRows: HTMLElement[] = [];
  private readonly progress = el('div', 'render-progress');
  private readonly progressBar = el('i');
  private readonly progressLabel = el('span');
  private readonly save = el('button', 'pill-button', 'Save image');
  private readonly time = range(0, 1435, 5);
  private readonly timeLabel = el('span');
  private readonly timeRow = el('label', 'sun-row');
  private readonly byTime = el('button', 'pill-button', 'Sun by time of day');

  constructor(
    private readonly realistic: RealisticRenderer,
    private readonly doc: Document,
  ) {
    this.el.hidden = true;
    this.occlusion.type = 'checkbox';
    this.reflections.type = 'checkbox';
    for (const [value, look] of Object.entries(LOOKS)) this.look.append(Object.assign(el('option', undefined, look.name), { value }));
    this.skyChoice.append(Object.assign(el('option', undefined, 'Time of day'), { value: 'time' }));
    for (const [value, hdri] of Object.entries(HDRIS)) this.skyChoice.append(Object.assign(el('option', undefined, hdri.name), { value }));
    this.rayTracing.type = 'checkbox';
    for (const [value, label] of [['64', 'Draft'], ['256', 'Good'], ['1024', 'Best']]) this.raySamples.append(Object.assign(el('option', undefined, label), { value }));
    const bar = el('div', 'render-progress-bar');
    bar.append(this.progressBar);
    this.progress.append(bar, this.progressLabel);
    for (const [value, label] of [['1024', 'Fast'], ['2048', 'Normal'], ['4096', 'Sharp']]) this.shadows.append(Object.assign(el('option', undefined, label), { value }));
    const row = (label: string, control: HTMLElement) => {
      const r = el('label', 'sun-row');
      r.append(el('span', undefined, label), control);
      return r;
    };
    const reset = el('button', 'pill-button', 'Reset');
    const rayRow = row('Ray tracing', this.rayTracing);
    rayRow.title = realistic.canRayTrace
      ? 'Light bounces between surfaces and glass refracts; the picture refines while the camera rests'
      : 'Ray tracing needs a graphics card with floating-point render targets (WebGL 2)';
    this.rayTracing.disabled = !realistic.canRayTrace;
    this.rayRows.push(row('Quality', this.raySamples), row('Bounces', this.rayBounces), this.progress);
    this.save.title = 'Download the picture as it is now (PNG)';
    this.save.addEventListener('click', () => {
      void realistic.saveImage().then((url) => {
        const link = Object.assign(el('a'), { href: url, download: `${doc.name || 'render'}.png` });
        link.click();
      });
    });
    realistic.onProgress = (samples, of) => {
      this.progressBar.style.width = `${Math.round((100 * samples) / of)}%`;
      this.progressLabel.textContent = samples >= of ? `Done · ${of} samples` : `${samples} / ${of} samples`;
    };
    // The time of day moves the document's sun (the same as the Sun panel); dragging is live, letting go saves it.
    this.timeRow.append(this.timeLabel, this.time);
    this.byTime.title = 'Place the sun by date and time (set the location in the Sun panel)';
    this.byTime.addEventListener('click', () => this.doc.setSun({ ...this.sun(), mode: 'place' }));
    this.time.addEventListener('input', () => this.doc.setSun({ ...this.sun(), minutes: Number(this.time.value) }, true));
    this.time.addEventListener('change', () => this.doc.setSun({ ...this.sun(), minutes: Number(this.time.value) }));
    doc.settingsChanged.on(() => this.showSun());
    doc.sunMoved.on(() => this.showSun());
    this.showSun();
    this.el.append(
      el('h3', undefined, 'Render'),
      row('Look', this.look),
      row('Sky', this.skyChoice),
      this.timeRow,
      this.byTime,
      row('Exposure', this.exposure),
      row('Sky light', this.sky),
      row('Corner shade', this.occlusion),
      row('Strength', this.occlusionStrength),
      row('Shadows', this.shadows),
      row('Haze', this.haze),
      row('Reflections', this.reflections),
      rayRow,
      ...this.rayRows,
      el('div', 'render-actions'),
    );
    this.el.lastElementChild!.append(this.save, reset);
    reset.addEventListener('click', () => this.apply({ ...DEFAULT_REALISTIC }));
    for (const control of [this.exposure, this.sky, this.occlusion, this.occlusionStrength, this.shadows, this.haze, this.rayTracing, this.raySamples, this.rayBounces, this.look, this.skyChoice, this.reflections]) {
      control.addEventListener('input', () => this.apply(this.read()));
    }
    this.apply(loadRealisticSettings());
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  private sun(): SunSettings {
    return { ...DEFAULT_SUN, ...this.doc.drawingSettings.sun };
  }

  private showSun(): void {
    const sun = this.sun();
    const byPlace = sun.mode === 'place';
    this.timeRow.hidden = !byPlace;
    this.byTime.hidden = byPlace;
    const minutes = sun.minutes ?? DEFAULT_SUN.minutes!;
    if (document.activeElement !== this.time) this.time.value = String(minutes);
    this.timeLabel.textContent = `Time ${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
  }

  private read(): RealisticSettings {
    return {
      exposure: Number(this.exposure.value),
      skyLight: Number(this.sky.value),
      occlusion: this.occlusion.checked,
      occlusionStrength: Number(this.occlusionStrength.value),
      shadowSize: Number(this.shadows.value) as RealisticSettings['shadowSize'],
      haze: Number(this.haze.value),
      rayTracing: this.rayTracing.checked,
      raySamples: Number(this.raySamples.value) as RealisticSettings['raySamples'],
      rayBounces: Number(this.rayBounces.value),
      look: isLook(this.look.value) ? this.look.value : DEFAULT_REALISTIC.look,
      sky: isHdri(this.skyChoice.value) ? this.skyChoice.value : 'time',
      reflections: this.reflections.checked,
    };
  }

  private apply(settings: RealisticSettings): void {
    this.exposure.value = String(settings.exposure);
    this.sky.value = String(settings.skyLight);
    this.occlusion.checked = settings.occlusion;
    this.occlusionStrength.value = String(settings.occlusionStrength);
    this.occlusionStrength.disabled = !settings.occlusion;
    this.shadows.value = String(settings.shadowSize);
    this.haze.value = String(settings.haze);
    this.rayTracing.checked = settings.rayTracing && this.realistic.canRayTrace;
    this.raySamples.value = String(settings.raySamples);
    this.rayBounces.value = String(settings.rayBounces);
    this.look.value = settings.look;
    this.skyChoice.value = settings.sky;
    this.reflections.checked = settings.reflections;
    for (const r of this.rayRows) r.hidden = !this.rayTracing.checked;
    this.realistic.setSettings(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* not remembered */
    }
  }
}
