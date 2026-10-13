import type { Document } from '../document';
import { DEFAULT_SUN, type SunSettings } from '../drawing/settings';
import { sunPosition } from '../drawing/sun';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

/** Places to start from: latitude, longitude, the usual (winter) hours ahead of UTC, and where summer time applies. */
const PLACES: { name: string; latitude: number; longitude: number; utc: number; dst: 'north' | 'south' | 'none' }[] = [
  { name: 'Amsterdam', latitude: 52.37, longitude: 4.9, utc: 1, dst: 'north' },
  { name: 'London', latitude: 51.51, longitude: -0.13, utc: 0, dst: 'north' },
  { name: 'Paris', latitude: 48.86, longitude: 2.35, utc: 1, dst: 'north' },
  { name: 'Madrid', latitude: 40.42, longitude: -3.7, utc: 1, dst: 'north' },
  { name: 'New York', latitude: 40.71, longitude: -74.0, utc: -5, dst: 'north' },
  { name: 'Los Angeles', latitude: 34.05, longitude: -118.24, utc: -8, dst: 'north' },
  { name: 'Dubai', latitude: 25.2, longitude: 55.27, utc: 4, dst: 'none' },
  { name: 'Tokyo', latitude: 35.68, longitude: 139.69, utc: 9, dst: 'none' },
  { name: 'Sydney', latitude: -33.87, longitude: 151.21, utc: 10, dst: 'south' },
];

function input(type: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const node = el('input');
  node.type = type;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/**
 * A small panel over the viewport for the 3D view's sun. Shadows can be switched off. The sun is set either by hand
 * (compass direction and height), or from a place, a date and a time of day, with the true north of the model set by
 * an angle. A view state: no undo steps.
 */
export class SunPanel {
  readonly el = el('div', 'tags-panel sun-panel');
  private readonly shadows = input('checkbox');
  private readonly manualButton = el('button', 'pill-button', 'By hand');
  private readonly placeButton = el('button', 'pill-button', 'Place and time');
  private readonly direction = input('range', { min: '0', max: '359', step: '1' });
  private readonly height = input('range', { min: '5', max: '90', step: '1' });
  private readonly north = input('range', { min: '0', max: '359', step: '1' });
  private readonly place = el('select', 'tag-select');
  private readonly latitude = input('number', { step: '0.01', min: '-90', max: '90' });
  private readonly longitude = input('number', { step: '0.01', min: '-180', max: '180' });
  private readonly utc = input('number', { step: '0.5', min: '-12', max: '14' });
  private readonly date = input('date');
  private readonly time = input('range', { min: '0', max: '1435', step: '5' });
  private readonly directionLabel = el('span', 'sun-value');
  private readonly heightLabel = el('span', 'sun-value');
  private readonly northLabel = el('span', 'sun-value');
  private readonly timeLabel = el('span', 'sun-value');
  private readonly readout = el('p', 'tags-empty');
  private readonly manualRows: HTMLElement[] = [];
  private readonly placeRows: HTMLElement[] = [];

  constructor(private readonly doc: Document) {
    this.el.hidden = true;
    const row = (label: string, control: HTMLElement, value?: HTMLElement) => {
      const r = el('label', 'sun-row');
      r.append(el('span', undefined, label), control);
      if (value) r.append(value);
      return r;
    };
    this.place.append(Object.assign(el('option'), { value: '', textContent: 'Choose a place…' }), ...PLACES.map((p, i) => Object.assign(el('option'), { value: String(i), textContent: p.name })));
    const coordinates = el('div', 'sun-coordinates');
    coordinates.append(this.latitude, this.longitude, this.utc);
    this.latitude.title = 'Latitude (north positive)';
    this.longitude.title = 'Longitude (east positive)';
    this.utc.title = 'Hours ahead of UTC, including daylight saving';
    const mode = el('div', 'sun-mode');
    mode.append(this.manualButton, this.placeButton);
    const reset = el('button', 'pill-button', 'Reset sun');

    this.manualRows.push(row('Direction', this.direction, this.directionLabel), row('Height', this.height, this.heightLabel));
    this.placeRows.push(
      row('North', this.north, this.northLabel),
      row('Place', this.place),
      row('Lat, lon, UTC', coordinates),
      row('Date', this.date),
      row('Time', this.time, this.timeLabel),
      this.readout,
    );
    this.el.append(el('h3', undefined, 'Sun'), row('Shadows', this.shadows), mode, ...this.manualRows, ...this.placeRows, reset);

    this.manualButton.addEventListener('click', () => this.apply({ ...this.current(), mode: 'manual' }));
    this.placeButton.addEventListener('click', () => this.apply({ ...this.current(), mode: 'place' }));
    reset.addEventListener('click', () => this.apply({ ...DEFAULT_SUN }));
    this.place.addEventListener('change', () => {
      const p = PLACES[Number(this.place.value)];
      if (p) this.apply({ ...this.current(), latitude: p.latitude, longitude: p.longitude, utcOffset: this.offsetOn(p) });
    });
    for (const control of [this.shadows, this.direction, this.height, this.north, this.latitude, this.longitude, this.utc, this.date, this.time]) {
      control.addEventListener('input', () => this.apply(this.read()));
    }
    doc.settingsChanged.on(() => this.show());
    this.show();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  private current(): Required<SunSettings> {
    return { ...DEFAULT_SUN, ...this.doc.drawingSettings.sun } as Required<SunSettings>;
  }

  /** A place's offset on the chosen date: its usual one, plus an hour in its summer-time months (roughly). */
  private offsetOn(place: (typeof PLACES)[number]): number {
    const month = Number((this.current().date ?? '2026-06-21').split('-')[1]);
    const summer = place.dst === 'north' ? month >= 4 && month <= 10 : place.dst === 'south' ? month >= 10 || month <= 3 : false;
    return place.utc + (summer ? 1 : 0);
  }

  private read(): SunSettings {
    const num = (e: HTMLInputElement, fallback: number) => (Number.isFinite(e.valueAsNumber) ? e.valueAsNumber : fallback);
    const now = this.current();
    return {
      ...now,
      shadows: this.shadows.checked,
      azimuth: num(this.direction, now.azimuth),
      altitude: num(this.height, now.altitude),
      northAngle: num(this.north, now.northAngle),
      latitude: num(this.latitude, now.latitude),
      longitude: num(this.longitude, now.longitude),
      utcOffset: num(this.utc, now.utcOffset),
      date: this.date.value || now.date,
      minutes: num(this.time, now.minutes),
    };
  }

  private apply(sun: SunSettings): void {
    this.doc.setSun(sun);
  }

  private show(): void {
    const sun = this.current();
    const byPlace = sun.mode === 'place';
    for (const r of this.manualRows) r.hidden = byPlace;
    for (const r of this.placeRows) r.hidden = !byPlace;
    this.manualButton.setAttribute('aria-pressed', String(!byPlace));
    this.placeButton.setAttribute('aria-pressed', String(byPlace));
    this.shadows.checked = sun.shadows;
    this.direction.value = String(Math.round(sun.azimuth));
    this.height.value = String(Math.round(sun.altitude));
    this.directionLabel.textContent = `${Math.round(sun.azimuth)}° ${compass(sun.azimuth)}`;
    this.heightLabel.textContent = `${Math.round(sun.altitude)}°`;
    this.north.value = String(Math.round(sun.northAngle));
    this.northLabel.textContent = `${Math.round(sun.northAngle)}°`;
    if (document.activeElement !== this.latitude) this.latitude.value = String(sun.latitude);
    if (document.activeElement !== this.longitude) this.longitude.value = String(sun.longitude);
    if (document.activeElement !== this.utc) this.utc.value = String(sun.utcOffset);
    this.date.value = sun.date;
    this.time.value = String(sun.minutes);
    this.timeLabel.textContent = clock(sun.minutes);
    const { azimuth, altitude } = sunPosition(sun.date, sun.minutes, sun.latitude, sun.longitude, sun.utcOffset);
    this.readout.textContent = altitude > 0 ? `Sun ${Math.round(altitude)}° high, ${Math.round(azimuth)}° ${compass(azimuth)} (from true north).` : 'The sun is below the horizon: no light, no shadows.';
  }
}
