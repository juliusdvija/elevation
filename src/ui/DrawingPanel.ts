import { Download, Layers, Plus, Trash2, createElement, type IconNode } from 'lucide';
import { Emitter } from '../core/emitter';
import type { Document } from '../document';
import { buildSheets } from '../drawing/build';
import { sheetsToPdf } from '../drawing/pdf';
import { allViews, nextLevel, sectionCoordinate, sortedLevels, type DrawingSettings, type ViewRef } from '../drawing/settings';
import type { Paper } from '../drawing/sheet';
import { sheetToSvg } from '../drawing/svg';
import type { ViewKind, ViewSetup } from '../drawing/views';

const TABS: [ViewKind, string][] = [
  ['plan', 'Plan'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['section', 'Section'],
];

const SCALES = [50, 100, 200, 500];
const PAPERS: [Paper, string][] = [
  ['fit', 'Fit'],
  ['A4', 'A4'],
  ['A3', 'A3'],
  ['A2', 'A2'],
  ['A1', 'A1'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(icon: IconNode, title: string): HTMLButtonElement {
  const b = el('button', 'icon-button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(createElement(icon, { width: 18, height: 18, 'stroke-width': 1.75 }));
  return b;
}

function field(label: string, control: HTMLElement, unit?: string): HTMLLabelElement {
  const f = el('label', 'field');
  f.append(el('span', undefined, label), control);
  if (unit) f.append(el('span', 'unit', unit));
  return f;
}

function numberInput(value: number, step = 100): HTMLInputElement {
  const input = el('input');
  input.type = 'number';
  input.step = String(step);
  input.value = String(Math.round(value));
  return input;
}

function download(data: BlobPart, type: string, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Side panel with the 2D drawings: plans per level, elevations and sections,
 * recomputed live whenever the model changes (at most once per frame). Exports
 * SVG, PDF, or the whole drawing set as one PDF.
 */
export class DrawingPanel {
  readonly el = el('aside', 'drawings');
  /** The current view, for the 3D cut plane. Null when the panel is hidden. */
  readonly viewChanged = new Emitter<ViewSetup | null>();

  private kind: ViewKind = 'plan';
  private levelId: string | null = null;
  private sectionId = 'A';
  private scale = 100;
  private paper: Paper = 'fit';
  /** Live value while a slider is dragged, before it is committed to the document. */
  private preview: DrawingSettings | null = null;
  private setup: ViewSetup | null = null;
  private svg = '';
  private frame = 0;
  private visible = true;
  private editingLevels = false;

  private readonly tabs = new Map<ViewKind, HTMLButtonElement>();
  private readonly controls = el('div', 'drawings-controls');
  private readonly levelsEditor = el('div', 'levels-editor');
  private readonly stage = el('div', 'drawings-stage');
  private readonly sheet = el('div', 'drawings-sheet');
  private readonly empty = el('div', 'drawings-empty', 'Draw something to see its drawings here.');
  private readonly status = el('span', 'drawings-status');
  private readonly exportMenu = el('div', 'export-menu');
  private view = { x: 0, y: 0, zoom: 1 };

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
    header.append(tabs);

    this.buildExportMenu();
    this.stage.append(this.sheet, this.empty);
    this.el.append(header, this.controls, this.levelsEditor, this.stage);
    this.bindStage();

    doc.geometryChanged.on(() => this.schedule());
    doc.settingsChanged.on(() => {
      this.preview = null;
      this.renderControls();
      this.renderLevelsEditor();
      this.schedule();
    });
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

  private get settings(): DrawingSettings {
    return this.preview ?? this.doc.drawingSettings;
  }

  /** The selected level (falls back to the lowest when it was removed). */
  private currentLevel(): string {
    const s = this.settings;
    return (s.levels.find((l) => l.id === this.levelId) ?? sortedLevels(s)[0]).id;
  }

  /** The selected section (falls back to the first). */
  private currentSection(): string {
    const s = this.settings;
    return (s.sections.find((x) => x.id === this.sectionId) ?? s.sections[0]).id;
  }

  private currentRef(): ViewRef {
    if (this.kind === 'plan') return { kind: 'plan', level: this.currentLevel() };
    if (this.kind === 'section') return { kind: 'section', section: this.currentSection() };
    return { kind: this.kind };
  }

  private setKind(kind: ViewKind): void {
    this.kind = kind;
    for (const [k, button] of this.tabs) button.setAttribute('aria-pressed', String(k === kind));
    this.renderControls();
    this.renderLevelsEditor();
    this.view = { x: 0, y: 0, zoom: 1 };
    this.applyView();
    this.schedule();
  }

  /** Commits a settings change (one undo step). */
  private commit(label: string, change: (s: DrawingSettings) => void): void {
    const next = structuredClone(this.doc.drawingSettings);
    change(next);
    this.doc.updateDrawingSettings(label, next);
  }

  private renderControls(): void {
    this.controls.replaceChildren();
    const s = this.settings;

    if (this.kind === 'plan') {
      const select = el('select');
      for (const level of sortedLevels(s)) {
        const option = el('option', undefined, `${level.name} (+${Math.round(level.elevation)})`);
        option.value = level.id;
        option.selected = level.id === this.currentLevel();
        select.append(option);
      }
      select.addEventListener('change', () => {
        this.levelId = select.value;
        this.schedule();
      });
      const levels = iconButton(Layers, 'Edit levels');
      levels.setAttribute('aria-pressed', String(this.editingLevels));
      levels.addEventListener('click', () => {
        this.editingLevels = !this.editingLevels;
        this.renderControls();
        this.renderLevelsEditor();
      });
      const cut = numberInput(s.cutHeight);
      cut.addEventListener('change', () => {
        const value = Number(cut.value);
        if (Number.isFinite(value)) this.commit('Plan Cut Height', (n) => (n.cutHeight = value));
      });
      this.controls.append(field('Level', select), levels, field('Cut', cut, 'mm'));
    }

    if (this.kind === 'section') {
      const ids = el('div', 'group segmented');
      for (const section of s.sections) {
        const button = el('button', 'text-button', `${section.id}–${section.id}`);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(section.id === this.currentSection()));
        button.addEventListener('click', () => {
          this.sectionId = section.id;
          this.renderControls();
          this.schedule();
        });
        ids.append(button);
      }
      const section = s.sections.find((x) => x.id === this.currentSection())!;
      const bounds = this.doc.bounds();
      const at = sectionCoordinate(section, bounds);
      const [lo, hi] = bounds.isEmpty() ? [-5000, 5000] : section.axis === 'y' ? [bounds.min.y, bounds.max.y] : [bounds.min.x, bounds.max.x];
      const input = numberInput(at);
      const range = el('input');
      range.type = 'range';
      range.min = String(Math.floor(lo));
      range.max = String(Math.ceil(hi));
      range.step = '50';
      range.value = String(Math.round(at));
      const setPosition = (value: number, live: boolean) => {
        const update = (n: DrawingSettings) => {
          const target = n.sections.find((x) => x.id === section.id);
          if (target) target.position = value;
        };
        if (live) {
          const next = structuredClone(this.doc.drawingSettings);
          update(next);
          this.preview = next;
          input.value = String(Math.round(value));
          this.schedule();
        } else {
          this.commit(`Move Section ${section.id}`, update);
        }
      };
      range.addEventListener('input', () => setPosition(Number(range.value), true));
      range.addEventListener('change', () => setPosition(Number(range.value), false));
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (Number.isFinite(value)) setPosition(value, false);
      });
      this.controls.append(ids, field(section.axis === 'y' ? 'y' : 'x', input, 'mm'), range);
    }

    const scale = el('select');
    for (const value of SCALES) {
      const option = el('option', undefined, `1:${value}`);
      option.value = String(value);
      option.selected = value === this.scale;
      scale.append(option);
    }
    scale.addEventListener('change', () => {
      this.scale = Number(scale.value);
      this.schedule();
    });
    const paper = el('select');
    for (const [value, label] of PAPERS) {
      const option = el('option', undefined, label);
      option.value = value;
      option.selected = value === this.paper;
      paper.append(option);
    }
    paper.addEventListener('change', () => {
      this.paper = paper.value as Paper;
      this.schedule();
    });
    const auto = el('button', 'pill-button', 'Auto dims');
    auto.type = 'button';
    auto.title = 'Dimension every drawing: overall size and a chain along the cut walls';
    auto.setAttribute('aria-pressed', String(s.autoDimensions));
    auto.addEventListener('click', () => this.commit('Auto Dimensions', (n) => (n.autoDimensions = !n.autoDimensions)));
    const exportButton = iconButton(Download, 'Export');
    exportButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportMenu.hidden = !this.exportMenu.hidden;
    });
    const exportWrap = el('div', 'export-wrap');
    exportWrap.append(exportButton, this.exportMenu);
    this.controls.append(el('div', 'spacer'), this.status, auto, field('Scale', scale), field('Paper', paper), exportWrap);
  }

  private renderLevelsEditor(): void {
    this.levelsEditor.replaceChildren();
    this.levelsEditor.hidden = !(this.kind === 'plan' && this.editingLevels);
    if (this.levelsEditor.hidden) return;
    const s = this.doc.drawingSettings;
    const levels = sortedLevels(s);
    for (const level of levels) {
      const row = el('div', 'level-row');
      const name = el('input');
      name.value = level.name;
      name.addEventListener('change', () => this.commit('Rename Level', (n) => (n.levels.find((l) => l.id === level.id)!.name = name.value.trim() || level.name)));
      const elevation = numberInput(level.elevation);
      elevation.addEventListener('change', () => {
        const value = Number(elevation.value);
        if (Number.isFinite(value)) this.commit('Level Height', (n) => (n.levels.find((l) => l.id === level.id)!.elevation = value));
      });
      const remove = iconButton(Trash2, 'Remove level');
      remove.disabled = levels.length <= 1;
      remove.addEventListener('click', () => this.commit('Remove Level', (n) => (n.levels = n.levels.filter((l) => l.id !== level.id))));
      row.append(name, field('', elevation, 'mm'), remove);
      this.levelsEditor.append(row);
    }
    const add = el('button', 'pill-button');
    add.type = 'button';
    add.append(createElement(Plus, { width: 14, height: 14 }), ' Add level');
    add.addEventListener('click', () => {
      const level = nextLevel(this.doc.drawingSettings);
      this.levelId = level.id;
      this.commit('Add Level', (n) => n.levels.push(level));
    });
    this.levelsEditor.append(add);
  }

  private buildExportMenu(): void {
    this.exportMenu.hidden = true;
    const item = (label: string, action: () => void) => {
      const b = el('button', 'menu-item', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.exportMenu.hidden = true;
        action();
      });
      this.exportMenu.append(b);
    };
    item('This drawing as SVG', () => this.exportSvg());
    item('This drawing as PDF', () => this.exportPdf(false));
    item('All drawings as PDF', () => this.exportPdf(true));
    document.addEventListener('click', () => (this.exportMenu.hidden = true));
  }

  private fileBase(): string {
    return this.doc.name.replace(/[\\/:*?"<>|]+/g, '-');
  }

  private exportSvg(): void {
    if (!this.svg || !this.setup) return;
    download(this.svg, 'image/svg+xml', `${this.fileBase()} - ${this.setup.title} 1-${this.scale}.svg`);
  }

  private exportPdf(all: boolean): void {
    const refs = all ? allViews(this.doc.drawingSettings) : [this.currentRef()];
    const built = buildSheets(this.doc, refs, { scale: this.scale, paper: this.paper }).filter((b) => all || !b.empty);
    if (built.length === 0) return;
    const pdf = sheetsToPdf(
      built.map((b) => b.sheet),
      this.doc.name,
    );
    const name = all ? `${this.fileBase()} - drawings 1-${this.scale}.pdf` : `${this.fileBase()} - ${built[0].setup.title} 1-${this.scale}.pdf`;
    download(pdf.slice().buffer, 'application/pdf', name);
  }

  private schedule(): void {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  private update(): void {
    const start = performance.now();
    const flat = this.doc.flatten();
    const [built] = buildSheets(this.doc, [this.currentRef()], { scale: this.scale, paper: this.paper }, flat, this.settings);
    this.setup = built.setup;
    this.viewChanged.emit(this.setup);

    const isEmpty = flat.edgeCount === 0;
    this.empty.hidden = !isEmpty;
    this.sheet.hidden = isEmpty;
    if (isEmpty) {
      this.status.textContent = '';
      this.svg = '';
      return;
    }
    this.svg = sheetToSvg(built.sheet);
    this.sheet.innerHTML = this.svg;
    const ms = Math.max(1, Math.round(performance.now() - start));
    this.status.textContent = built.sheet.fits ? `Live · ${ms} ms` : `Too big for ${this.paper} at 1:${this.scale}`;
    this.status.dataset.warn = String(!built.sheet.fits);
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
