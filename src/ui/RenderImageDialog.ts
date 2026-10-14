import type { RealisticRenderer } from '../viewport/RealisticRenderer';
import { download } from './RenderPanel';

const SIZES: [number, string][] = [
  [1920, 'Full HD (1920 wide)'],
  [2560, 'QHD (2560 wide)'],
  [3840, '4K (3840 wide)'],
];
const QUALITY: [number, string][] = [
  [256, 'Good (256 samples)'],
  [1024, 'Best (1024 samples)'],
  [2048, 'Final (2048 samples)'],
];

/**
 * Makes a large finished picture of the current view: choose a size and a quality, watch the progress, and the PNG
 * downloads when it is done. Without ray tracing support the real-time picture is used at that size.
 */
export class RenderImageDialog {
  private readonly backdrop = document.createElement('div');

  constructor(realistic: RealisticRenderer, name: string) {
    this.backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Render image');
    const heading = document.createElement('h2');
    heading.textContent = 'Render image';
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = realistic.canRayTrace
      ? 'The current view, ray traced in its look, without selection or guides. Larger and finer takes longer.'
      : 'This graphics card cannot ray trace: the real-time picture is saved at this size.';
    const pick = (label: string, options: [number, string][], value: number) => {
      const row = document.createElement('label');
      row.className = 'dialog-row';
      const select = document.createElement('select');
      for (const [v, text] of options) select.append(Object.assign(document.createElement('option'), { value: String(v), textContent: text }));
      select.value = String(value);
      row.append(Object.assign(document.createElement('span'), { textContent: label }), select);
      return { row, select };
    };
    const size = pick('Size', SIZES, 1920);
    const quality = pick('Quality', QUALITY, 1024);
    quality.row.hidden = !realistic.canRayTrace;
    const status = document.createElement('p');
    status.className = 'dialog-summary';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('i');
    bar.append(fill);
    bar.hidden = true;
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'pill-button', textContent: 'Cancel' });
    const render = Object.assign(document.createElement('button'), { type: 'button', className: 'pill-button primary', textContent: 'Render' });
    buttons.append(cancel, render);
    dialog.append(heading, note, size.row, quality.row, bar, status, buttons);
    this.backdrop.append(dialog);
    document.body.append(this.backdrop);

    let abort: AbortController | null = null;
    cancel.addEventListener('click', () => {
      abort?.abort();
      this.close();
    });
    render.addEventListener('click', () => {
      abort = new AbortController();
      render.disabled = size.select.disabled = quality.select.disabled = true;
      bar.hidden = false;
      status.textContent = 'Preparing…';
      const started = performance.now();
      void realistic
        .renderStill(Number(size.select.value), Number(quality.select.value), (done, of) => {
          fill.style.width = `${Math.round((100 * done) / of)}%`;
          const seconds = (performance.now() - started) / 1000;
          const left = done > 2 ? Math.round((seconds / done) * (of - done)) : null;
          status.textContent = `${done} / ${of} samples${left !== null ? ` · about ${left < 90 ? `${left} s` : `${Math.round(left / 60)} min`} left` : ''}`;
        }, abort.signal)
        .then((url) => {
          if (url) download(url, `${name}.png`);
          this.close();
        });
    });
  }

  close(): void {
    this.backdrop.remove();
  }
}
