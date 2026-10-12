import { Download, createElement } from 'lucide';
import { Emitter } from '../core/emitter';
import type { Document } from '../document';
import { computeDrawing } from '../drawing/project';
import { drawingToSvg } from '../drawing/svg';
import { DEFAULT_VIEW_OPTIONS, viewSetup, type ViewKind, type ViewOptions, type ViewSetup } from '../drawing/views';

const TABS: [ViewKind, string][] = [
  ['plan', 'Plan'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['section', 'Section'],
];

const SCALES = [50, 100, 200, 500];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Side panel with the 2D drawings. Recomputes the visible drawing whenever
 * the model changes (at most once per frame), so it follows edits and tool
 * previews live.
 */
export class DrawingPanel {
  readonly el = el('aside', 'drawings');
  /** The current view, for the 3D cut plane. Null when the panel is hidden. */
  readonly viewChanged = new Emitter<ViewSetup | null>();

  private kind: ViewKind = 'plan';
  private options: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  private scale = 100;
  private svg = '';
  private setup: ViewSetup | null = null;
  private frame = 0;
  private visible = true;

  private readonly tabs = new Map<ViewKind, HTMLButtonElement>();
  private readonly controls = el('div', 'drawings-controls');
  private readonly stage = el('div', 'drawings-stage');
  private readonly sheet = el('div', 'drawings-sheet');
  private readonly empty = el('div', 'drawings-empty', 'Draw something to see its drawings here.');
  private readonly status = el('span', 'drawings-status');
  private view = { x: 0, y: 0, zoom: 1 };
  private exportButton!: HTMLButtonElement;

  constructor(private readonly doc: Document) {
    const header = el('div', 'drawings-header');
    const tabs = el('div', 'group segmented');
    for (const [kind, label] of TABS) {
      const button = el('button', 'text-button', label);
      button.type = 'button';
      button.addEventListener('click', () => this.setKind(kind));
      this.tabs.set(kind, button);
      tabs.append(button);
    }
    const exportButton = el('button', 'icon-button');
    exportButton.type = 'button';
    exportButton.title = 'Export SVG';
    exportButton.setAttribute('aria-label', 'Export SVG');
    exportButton.append(createElement(Download, { width: 18, height: 18, 'stroke-width': 1.75 }));
    exportButton.addEventListener('click', () => this.export());
    header.append(tabs);
    this.exportButton = exportButton;

    this.stage.append(this.sheet, this.empty);
    this.el.append(header, this.controls, this.stage);
    this.bindStage();

    doc.geometryChanged.on(() => this.schedule());
    this.setKind('plan');
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
    if (visible) {
      this.schedule();
    } else {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.viewChanged.emit(null);
    }
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private setKind(kind: ViewKind): void {
    this.kind = kind;
    for (const [k, button] of this.tabs) button.setAttribute('aria-pressed', String(k === kind));
    this.renderControls();
    this.view = { x: 0, y: 0, zoom: 1 };
    this.applyView();
    this.schedule();
  }

  private renderControls(): void {
    this.controls.replaceChildren();

    if (this.kind === 'plan') {
      const label = el('label', 'field');
      label.append(el('span', undefined, 'Cut height'));
      const input = el('input');
      input.type = 'number';
      input.step = '100';
      input.value = String(this.options.cutHeight);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) {
          this.options.cutHeight = value;
          this.schedule();
        }
      });
      label.append(input, el('span', 'unit', 'mm'));
      this.controls.append(label);
    }

    if (this.kind === 'section') {
      const axis = el('div', 'group segmented');
      for (const [value, text] of [
        ['y', 'A–A'],
        ['x', 'B–B'],
      ] as const) {
        const button = el('button', 'text-button', text);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(this.options.sectionAxis === value));
        button.addEventListener('click', () => {
          this.options.sectionAxis = value;
          this.renderControls();
          this.schedule();
        });
        axis.append(button);
      }
      const label = el('label', 'field');
      label.append(el('span', undefined, 'Position'));
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.01';
      range.value = String(this.options.sectionPosition);
      range.addEventListener('input', () => {
        this.options.sectionPosition = Number(range.value);
        this.schedule();
      });
      label.append(range);
      this.controls.append(axis, label);
    }

    const scaleLabel = el('label', 'field');
    scaleLabel.append(el('span', undefined, 'Scale'));
    const select = el('select');
    for (const s of SCALES) {
      const option = el('option', undefined, `1:${s}`);
      option.value = String(s);
      option.selected = s === this.scale;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.scale = Number(select.value);
      this.schedule();
    });
    scaleLabel.append(select);
    this.controls.append(el('div', 'spacer'), this.status, scaleLabel, this.exportButton);
  }

  private schedule(): void {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update(): void {
    const bounds = this.doc.bounds();
    this.setup = viewSetup(this.kind, this.options, bounds);
    this.viewChanged.emit(this.setup);

    // Groups and components are drawn like any other geometry.
    const flat = this.doc.flatten();
    const isEmpty = flat.edgeCount === 0;
    this.empty.hidden = !isEmpty;
    this.sheet.hidden = isEmpty;
    if (isEmpty) {
      this.status.textContent = '';
      this.svg = '';
      return;
    }

    const start = performance.now();
    const drawing = computeDrawing(flat, this.setup);
    this.svg = drawingToSvg(drawing, this.setup, { scale: this.scale });
    this.sheet.innerHTML = this.svg;
    const ms = Math.max(1, Math.round(performance.now() - start));
    this.status.textContent = `Live · ${ms} ms`;
  }

  private export(): void {
    if (!this.svg || !this.setup) return;
    const blob = new Blob([this.svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.setup.title.replace(/[^\w]+/g, '-').toLowerCase()}-1-${this.scale}.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** Wheel zooms around the cursor, drag pans, double-click resets. */
  private bindStage(): void {
    this.stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.stage.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const zoom = Math.min(Math.max(this.view.zoom * factor, 0.2), 40);
        const k = zoom / this.view.zoom;
        this.view = { zoom, x: cx - (cx - this.view.x) * k, y: cy - (cy - this.view.y) * k };
        this.applyView();
      },
      { passive: false },
    );

    let drag: { x: number; y: number } | null = null;
    this.stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.view.x += e.clientX - drag.x;
      this.view.y += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.applyView();
    });
    this.stage.addEventListener('pointerup', () => (drag = null));
    this.stage.addEventListener('dblclick', () => {
      this.view = { x: 0, y: 0, zoom: 1 };
      this.applyView();
    });
  }

  private applyView(): void {
    this.sheet.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
  }
}
