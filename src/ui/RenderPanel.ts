import { DEFAULT_REALISTIC, type RealisticRenderer, type RealisticSettings } from '../viewport/RealisticRenderer';
import { isLook, LOOKS } from '../viewport/grading';
import { HDRIS, isHdri } from '../viewport/hdri';
import { isHaze } from '../viewport/atmosphere';
import type { Document } from '../document';
import { DEFAULT_SUN, type SunSettings } from '../drawing/settings';
import { RenderImageDialog } from './RenderImageDialog';

const KEY = 'elevation.realistic';
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];

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

function checkbox(): HTMLInputElement {
  const node = el('input');
  node.type = 'checkbox';
  return node;
}

function select(options: [string, string][]): HTMLSelectElement {
  const node = el('select', 'tag-select');
  for (const [value, label] of options) node.append(Object.assign(el('option', undefined, label), { value }));
  return node;
}

/** Saves a data URL as a file. */
export function download(url: string, name: string): void {
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
}

/** Settings read back from the browser, ignoring anything that is not a plausible value. */
export function loadRealisticSettings(): RealisticSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return { ...DEFAULT_REALISTIC };
    const number = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && value >= min && value <= max ? value : fallback);
    const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
    return {
      exposure: number(saved.exposure, DEFAULT_REALISTIC.exposure, 0.2, 2.5),
      skyLight: number(saved.skyLight, DEFAULT_REALISTIC.skyLight, 0, 1),
      occlusion: flag(saved.occlusion, DEFAULT_REALISTIC.occlusion),
      occlusionStrength: number(saved.occlusionStrength, DEFAULT_REALISTIC.occlusionStrength, 0, 1),
      shadowSize: [1024, 2048, 4096].includes(saved.shadowSize) ? saved.shadowSize : DEFAULT_REALISTIC.shadowSize,
      haze: number(saved.haze, DEFAULT_REALISTIC.haze, 0, 1),
      rayTracing: flag(saved.rayTracing, DEFAULT_REALISTIC.rayTracing),
      raySamples: [64, 256, 1024].includes(saved.raySamples) ? saved.raySamples : DEFAULT_REALISTIC.raySamples,
      rayBounces: Math.round(number(saved.rayBounces, DEFAULT_REALISTIC.rayBounces, 1, 12)),
      look: isLook(saved.look) ? saved.look : DEFAULT_REALISTIC.look,
      atmosphere: isHaze(saved.atmosphere) ? saved.atmosphere : DEFAULT_REALISTIC.atmosphere,
      sky: saved.sky === 'time' || isHdri(saved.sky) ? saved.sky : DEFAULT_REALISTIC.sky,
      reflections: flag(saved.reflections, DEFAULT_REALISTIC.reflections),
      depthOfField: flag(saved.depthOfField, DEFAULT_REALISTIC.depthOfField),
      fStop: F_STOPS.includes(saved.fStop) ? saved.fStop : DEFAULT_REALISTIC.fStop,
    };
  } catch {
    return { ...DEFAULT_REALISTIC };
  }
}

/**
 * The panel of the photorealistic view, in sections: the look (finish, sky, time of day), light and detail, and ray
 * tracing with depth of field; plus saving the picture and rendering a large one. A viewer preference, remembered in
 * the browser; no undo steps (the time of day moves the document's sun, like the Sun panel).
 */
export class RenderPanel {
  readonly el = el('div', 'tags-panel render-panel');
  private readonly look = select(Object.entries(LOOKS).map(([id, look]) => [id, look.name]));
  private readonly skyChoice = select([['time', 'Time of day'], ...Object.entries(HDRIS).map(([id, h]) => [id, h.name] as [string, string])]);
  private readonly atmosphere = select([['clear', 'Clear'], ['normal', 'Normal'], ['hazy', 'Hazy']]);
  private readonly atmosphereRow = el('label', 'sun-row');
  private readonly time = range(0, 1435, 5);
  private readonly timeLabel = el('span');
  private readonly timeRow = el('label', 'sun-row');
  private readonly byTime = el('button', 'pill-button', 'Sun by time of day');
  private readonly exposure = range(0.2, 2.5, 0.05);
  private readonly sky = range(0, 1, 0.01);
  private readonly haze = range(0, 1, 0.05);
  private readonly reflections = checkbox();
  private readonly occlusion = checkbox();
  private readonly occlusionStrength = range(0, 1, 0.05);
  private readonly shadows = select([['1024', 'Fast'], ['2048', 'Normal'], ['4096', 'Sharp']]);
  private readonly rayTracing = checkbox();
  private readonly raySamples = select([['64', 'Draft'], ['256', 'Good'], ['1024', 'Best']]);
  private readonly rayBounces = range(1, 12, 1);
  private readonly depthOfField = checkbox();
  private readonly fStop = select(F_STOPS.map((f) => [String(f), `f/${f}`]));
  private readonly pickFocus = el('button', 'pill-button', 'Pick focus');
  private readonly rayRows: HTMLElement[] = [];
  private readonly lensRows: HTMLElement[] = [];
  private readonly progress = el('div', 'render-progress');
  private readonly progressBar = el('i');
  private readonly progressLabel = el('span');
  /** Called when "Pick focus" is pressed: the next click in the view chooses the distance in focus. */
  onPickFocus: (() => void) | null = null;

  constructor(
    private readonly realistic: RealisticRenderer,
    private readonly doc: Document,
  ) {
    this.el.hidden = true;
    const row = (label: string, control: HTMLElement, title?: string) => {
      const r = el('label', 'sun-row');
      r.append(el('span', undefined, label), control);
      if (title) r.title = title;
      return r;
    };
    const section = (title: string, open: boolean, ...children: HTMLElement[]) => {
      const d = el('details', 'render-section');
      d.open = open;
      d.append(el('summary', undefined, title), ...children);
      return d;
    };

    // Time of day: moves the document's sun (as the Sun panel does); dragging is live, letting go saves it.
    this.timeRow.append(this.timeLabel, this.time);
    this.byTime.title = 'Place the sun by date and time (set the location in the Sun panel)';
    this.byTime.addEventListener('click', () => this.doc.setSun({ ...this.sun(), mode: 'place' }));
    this.time.addEventListener('input', () => this.doc.setSun({ ...this.sun(), minutes: Number(this.time.value) }, true));
    this.time.addEventListener('change', () => this.doc.setSun({ ...this.sun(), minutes: Number(this.time.value) }));
    doc.settingsChanged.on(() => this.showSun());
    doc.sunMoved.on(() => this.showSun());
    this.showSun();

    this.atmosphereRow.append(el('span', undefined, 'Air'), this.atmosphere);
    this.atmosphereRow.title = 'How hazy the air is: a crisp blue sky, an ordinary day, or a hazy summer afternoon with a white sky and red sunsets';
    const rayRow = row(
      'Ray tracing',
      this.rayTracing,
      realistic.canRayTrace
        ? 'Light bounces between surfaces and glass refracts; the picture refines while the camera rests'
        : 'Ray tracing needs a graphics card with floating-point render targets (WebGL 2)',
    );
    this.rayTracing.disabled = !realistic.canRayTrace;
    const bar = el('div', 'render-progress-bar');
    bar.append(this.progressBar);
    this.progress.append(bar, this.progressLabel);
    this.pickFocus.title = 'Then click the point that should be sharp';
    this.pickFocus.addEventListener('click', () => this.onPickFocus?.());
    const lensRow = row('Aperture', this.fStop, 'A small f-number blurs more in front of and behind the focus');
    const focusRow = el('div', 'render-actions');
    focusRow.append(this.pickFocus);
    this.lensRows.push(lensRow, focusRow);
    const dofRow = row('Depth of field', this.depthOfField, 'Blur in front of and behind the point in focus (in the ray-traced picture)');
    this.rayRows.push(row('Quality', this.raySamples), row('Bounces', this.rayBounces), dofRow, ...this.lensRows, this.progress);

    realistic.onProgress = (samples, of) => {
      this.progressBar.style.width = `${Math.round((100 * samples) / of)}%`;
      this.progressLabel.textContent = samples >= of ? `Done · ${of} samples` : `${samples} / ${of} samples`;
    };

    const save = el('button', 'pill-button', 'Save view');
    save.title = 'Download the picture as it is now (PNG)';
    save.addEventListener('click', () => {
      void realistic.saveImage().then((url) => download(url, `${doc.name || 'render'}.png`));
    });
    const big = el('button', 'pill-button primary', 'Render image…');
    big.title = 'A large finished picture (up to 4K), ray traced, without selection or guides';
    big.addEventListener('click', () => new RenderImageDialog(realistic, doc.name || 'render'));
    const reset = el('button', 'pill-button', 'Reset');
    reset.addEventListener('click', () => this.apply({ ...DEFAULT_REALISTIC }));
    const actions = el('div', 'render-actions');
    actions.append(big, save, reset);

    this.el.append(
      el('h3', undefined, 'Render'),
      section('Look', true, row('Finish', this.look, 'Tone, contrast, colour and vignette, like a film stock'), row('Sky', this.skyChoice), this.atmosphereRow, this.timeRow, this.byTime),
      section(
        'Light & detail',
        false,
        row('Exposure', this.exposure),
        row('Sky light', this.sky),
        row('Haze', this.haze),
        row('Reflections', this.reflections, 'Water and polished floors mirror their surroundings'),
        row('Corner shade', this.occlusion),
        row('Strength', this.occlusionStrength),
        row('Shadows', this.shadows),
      ),
      section('Ray tracing', true, rayRow, ...this.rayRows),
      actions,
    );
    const controls = [
      this.exposure, this.sky, this.occlusion, this.occlusionStrength, this.shadows, this.haze, this.rayTracing, this.raySamples,
      this.rayBounces, this.look, this.atmosphere, this.skyChoice, this.reflections, this.depthOfField, this.fStop,
    ];
    for (const control of controls) control.addEventListener('input', () => this.apply(this.read()));
    this.apply(loadRealisticSettings());
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  /** Shows whether the next click picks the focus. */
  setPickingFocus(picking: boolean): void {
    this.pickFocus.setAttribute('aria-pressed', String(picking));
    this.pickFocus.textContent = picking ? 'Click the view…' : 'Pick focus';
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
      atmosphere: isHaze(this.atmosphere.value) ? this.atmosphere.value : DEFAULT_REALISTIC.atmosphere,
      sky: isHdri(this.skyChoice.value) ? this.skyChoice.value : 'time',
      reflections: this.reflections.checked,
      depthOfField: this.depthOfField.checked,
      fStop: Number(this.fStop.value),
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
    this.atmosphere.value = settings.atmosphere;
    this.atmosphereRow.hidden = settings.sky !== 'time';
    this.reflections.checked = settings.reflections;
    this.depthOfField.checked = settings.depthOfField;
    this.fStop.value = String(settings.fStop);
    for (const r of this.rayRows) r.hidden = !this.rayTracing.checked;
    for (const r of this.lensRows) r.hidden = !this.rayTracing.checked || !settings.depthOfField;
    this.realistic.setSettings(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* not remembered */
    }
  }
}
