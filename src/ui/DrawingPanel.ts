import { Download, Layers, LayoutGrid, Plus, Trash2, createElement, type IconNode } from 'lucide';
import type { CameraData } from '../io/format';
import { Emitter } from '../core/emitter';
import type { Document } from '../document';
import { buildSheets } from '../drawing/build';
import { addSceneViewport, addViewport, composeLayout, isScene, nextLayout, nextScene, tidyLayout, type ImageProvider, type Layout, type LayoutPaper, type PageItem, type RenderedImage } from '../drawing/layout';
import { sheetsToPdf } from '../drawing/pdf';
import { allViews, nextLevel, sectionCoordinate, sortedLevels, type DrawingSettings, type ViewRef } from '../drawing/settings';
import type { Paper } from '../drawing/sheet';
import { sheetToSvg } from '../drawing/svg';
import { viewSetup, type ViewKind, type ViewSetup } from '../drawing/views';

const TABS: [ViewKind, string][] = [
  ['plan', 'Plan'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['section', 'Section'],
];

const SCALES = [20, 50, 100, 200, 500];
const LAYOUT_PAPERS: LayoutPaper[] = ['A4', 'A3', 'A2', 'A1'];
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

/** What the panel needs from the 3D viewport to put pictures of it on sheets. */
export interface ScenePort {
  /** Where the camera stands now. */
  camera(): CameraData;
  /** The viewport's height / width, for the shape of a new picture. */
  ratio(): number;
  /** Renders a picture of the model from a camera. */
  snapshot(camera: CameraData, width: number, height: number, hidden: string[]): RenderedImage | null;
}

const PREVIEW_DPI = 110;
const EXPORT_DPI = 220;

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
  /** Showing the layout pages instead of one drawing. */
  private sheetsMode = false;
  private layoutId: string | null = null;
  private tabSheets!: HTMLButtonElement;
  /** Page size (paper mm) and the draggable things on it, from the last composed sheet. */
  private page: { width: number; height: number; items: PageItem[] } | null = null;

  /** Pictures already rendered, by scene camera, size and model version; and when each scene was last rendered. */
  private readonly pictures = new Map<string, RenderedImage>();
  private readonly lastPicture = new Map<string, { image: RenderedImage; at: number }>();
  private modelVersion = 0;
  private pictureTimer = 0;

  private readonly tabs = new Map<ViewKind, HTMLButtonElement>();
  private readonly controls = el('div', 'drawings-controls');
  private readonly levelsEditor = el('div', 'levels-editor');
  private readonly viewportsEditor = el('div', 'levels-editor');
  private readonly stage = el('div', 'drawings-stage');
  private readonly sheet = el('div', 'drawings-sheet');
  private readonly empty = el('div', 'drawings-empty', 'Draw something to see its drawings here.');
  private readonly status = el('span', 'drawings-status');
  private readonly exportMenu = el('div', 'export-menu');
  private view = { x: 0, y: 0, zoom: 1 };

  constructor(
    private readonly doc: Document,
    private readonly port?: ScenePort,
  ) {
    const header = el('div', 'drawings-header');
    const tabs = el('div', 'group segmented');
    for (const [kind, label] of TABS) {
      const button = el('button', 'text-button', label);
      button.type = 'button';
      button.addEventListener('click', () => this.setKind(kind));
      this.tabs.set(kind, button);
      tabs.append(button);
    }
    this.tabSheets = el('button', 'text-button');
    this.tabSheets.type = 'button';
    this.tabSheets.title = 'Pages with several drawings';
    this.tabSheets.append(createElement(LayoutGrid, { width: 14, height: 14 }), ' Sheets');
    this.tabSheets.addEventListener('click', () => this.setSheets());
    tabs.append(this.tabSheets);
    header.append(tabs);

    this.buildExportMenu();
    this.stage.append(this.sheet, this.empty);
    this.el.append(header, this.controls, this.levelsEditor, this.viewportsEditor, this.stage);
    this.bindStage();

    doc.geometryChanged.on(() => {
      this.modelVersion++;
      this.schedule();
    });
    doc.settingsChanged.on(() => {
      this.preview = null;
      this.renderControls();
      this.renderLevelsEditor();
      this.renderViewportsEditor();
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
    this.sheetsMode = false;
    for (const [k, button] of this.tabs) button.setAttribute('aria-pressed', String(k === kind));
    this.tabSheets.setAttribute('aria-pressed', 'false');
    this.fillExportMenu();
    this.renderControls();
    this.renderLevelsEditor();
    this.renderViewportsEditor();
    this.view = { x: 0, y: 0, zoom: 1 };
    this.applyView();
    this.schedule();
  }

  private setSheets(): void {
    this.sheetsMode = true;
    for (const button of this.tabs.values()) button.setAttribute('aria-pressed', 'false');
    this.tabSheets.setAttribute('aria-pressed', 'true');
    this.fillExportMenu();
    this.renderControls();
    this.renderLevelsEditor();
    this.renderViewportsEditor();
    this.view = { x: 0, y: 0, zoom: 1 };
    this.applyView();
    this.schedule();
  }

  /** The selected layout (falls back to the first). */
  private currentLayout(): Layout | undefined {
    const layouts = this.settings.layouts;
    return layouts.find((l) => l.id === this.layoutId) ?? layouts[0];
  }

  /** Changes the selected layout as one undo step. */
  private commitLayout(label: string, change: (layout: Layout) => Layout | void): void {
    const current = this.currentLayout();
    if (!current) return;
    this.commit(label, (n) => {
      const i = n.layouts.findIndex((l) => l.id === current.id);
      n.layouts[i] = change(n.layouts[i]) ?? n.layouts[i];
    });
  }

  /** Adds the drawing on show to the selected layout, creating the first one when there is none. */
  private addCurrentToSheet(): void {
    let layout = this.currentLayout();
    const created = !layout;
    layout ??= nextLayout(this.doc.drawingSettings.layouts);
    const updated = addViewport(this.doc, layout, this.currentRef(), this.scale, this.settings);
    this.layoutId = updated.id;
    this.commit('Add Drawing to Sheet', (n) => {
      if (created) n.layouts.push(updated);
      else n.layouts[n.layouts.findIndex((l) => l.id === updated.id)] = updated;
    });
    this.status.textContent = `Added to ${updated.name}`;
  }

  /** Adds a picture of the 3D view as it is now to the selected sheet. */
  private addSceneToSheet(): void {
    const port = this.port;
    const layout = this.currentLayout();
    if (!port || !layout) return;
    const camera = port.camera();
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1);
    // Reuse a saved view when the camera is on one, so the sheet and the scenes bar share it.
    const nowHidden = [...this.doc.hiddenTags()].sort().join(',');
    const existing = this.doc.drawingSettings.scenes.find((s) => s.camera.ortho === camera.ortho && near(s.camera.position, camera.position) && near(s.camera.target, camera.target) && [...(s.hidden ?? [])].sort().join(',') === nowHidden);
    const hidden = [...this.doc.hiddenTags()];
    const scene = existing ?? { ...nextScene(this.doc.drawingSettings.scenes, camera), ...(hidden.length > 0 ? { hidden } : {}) };
    // About a third of the page wide, in the shape of the 3D view on screen.
    const pageWidth = { A4: 297, A3: 420, A2: 594, A1: 841 }[layout.paper];
    const ratio = Math.min(1.1, Math.max(0.45, port.ratio()));
    const withScene = { ...structuredClone(this.doc.drawingSettings), scenes: existing ? this.doc.drawingSettings.scenes : [...this.doc.drawingSettings.scenes, scene] };
    const updated = addSceneViewport(this.doc, layout, scene, Math.round(pageWidth * 0.36), ratio, withScene);
    this.commit('Add 3D View to Sheet', (n) => {
      if (!existing) n.scenes.push(scene);
      n.layouts[n.layouts.findIndex((l) => l.id === layout.id)] = updated;
    });
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

    if (this.sheetsMode) {
      this.renderSheetControls();
      return;
    }

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
    const shading = el('button', 'pill-button', 'Shading');
    shading.type = 'button';
    shading.title = 'Tint faces by how the light falls on them, and cast shadows on the ground in plans';
    shading.setAttribute('aria-pressed', String(s.shading));
    shading.addEventListener('click', () => this.commit('Shading', (n) => (n.shading = !n.shading)));
    const addToSheet = el('button', 'pill-button', 'Add to sheet');
    addToSheet.type = 'button';
    addToSheet.title = 'Put this drawing, at this scale, on a sheet with other drawings';
    addToSheet.addEventListener('click', () => this.addCurrentToSheet());
    this.controls.append(el('div', 'spacer'), this.status, auto, shading, addToSheet, field('Scale', scale), field('Paper', paper), this.exportControl());
  }

  private exportControl(): HTMLElement {
    const exportButton = iconButton(Download, 'Export');
    exportButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportMenu.hidden = !this.exportMenu.hidden;
    });
    const exportWrap = el('div', 'export-wrap');
    exportWrap.append(exportButton, this.exportMenu);
    return exportWrap;
  }

  private renderSheetControls(): void {
    const layouts = this.settings.layouts;
    const layout = this.currentLayout();
    const select = el('select');
    for (const l of layouts) {
      const option = el('option', undefined, l.name);
      option.value = l.id;
      option.selected = l.id === layout?.id;
      select.append(option);
    }
    select.disabled = layouts.length === 0;
    select.addEventListener('change', () => {
      this.layoutId = select.value;
      this.renderControls();
      this.renderViewportsEditor();
      this.schedule();
    });
    const add = iconButton(Plus, 'New sheet');
    add.addEventListener('click', () => {
      const created = nextLayout(this.doc.drawingSettings.layouts, layout?.paper ?? 'A3');
      this.layoutId = created.id;
      this.commit('Add Sheet', (n) => n.layouts.push(created));
    });
    this.controls.append(field('Sheet', select), add);
    if (layout) {
      const name = el('input');
      name.value = layout.name;
      name.addEventListener('change', () => this.commitLayout('Rename Sheet', (l) => ({ ...l, name: name.value.trim() || l.name })));
      const paper = el('select');
      for (const value of LAYOUT_PAPERS) {
        const option = el('option', undefined, value);
        option.value = value;
        option.selected = value === layout.paper;
        paper.append(option);
      }
      paper.addEventListener('change', () => this.commitLayout('Sheet Paper', (l) => ({ ...l, paper: paper.value as LayoutPaper })));
      const tidy = el('button', 'pill-button', 'Tidy');
      tidy.type = 'button';
      tidy.title = 'Place the drawings again, side by side without overlap';
      tidy.addEventListener('click', () => this.commitLayout('Tidy Sheet', (l) => tidyLayout(this.doc, l, this.settings)));
      const remove = iconButton(Trash2, 'Delete sheet');
      remove.addEventListener('click', () => this.commit('Delete Sheet', (n) => (n.layouts = n.layouts.filter((l) => l.id !== layout.id))));
      this.controls.append(field('Name', name), field('Paper', paper), tidy, remove);
    }
    this.controls.append(el('div', 'spacer'), this.status, this.exportControl());
  }

  /** The drawings on the selected sheet: scale, position, remove. */
  private renderViewportsEditor(): void {
    this.viewportsEditor.replaceChildren();
    const layout = this.currentLayout();
    this.viewportsEditor.hidden = !this.sheetsMode || !layout;
    if (this.viewportsEditor.hidden || !layout) return;
    const bounds = this.doc.bounds();
    for (const viewport of layout.viewports) {
      const change = (label: string, patch: Record<string, unknown>) =>
        this.commitLayout(label, (l) => ({ ...l, viewports: l.viewports.map((v) => (v.id === viewport.id ? { ...v, ...patch } : v)) }));
      const row = el('div', 'level-row');
      if (isScene(viewport)) {
        const scene = this.settings.scenes.find((x) => x.id === viewport.scene);
        const name = el('input');
        name.value = scene?.name ?? 'Scene';
        name.title = 'Name of the 3D view';
        name.addEventListener('change', () => this.commit('Rename 3D View', (n) => {
          const target = n.scenes.find((x) => x.id === viewport.scene);
          if (target) target.name = name.value.trim() || target.name;
        }));
        const width = numberInput(viewport.width, 5);
        width.addEventListener('change', () => Number(width.value) >= 20 && change('3D View Width', { width: Number(width.value) }));
        const update = el('button', 'pill-button', 'Use current camera');
        update.type = 'button';
        update.title = 'Show this 3D view from where the camera is now';
        update.addEventListener('click', () => {
          if (this.port) this.commit('Update 3D View', (n) => {
            const target = n.scenes.find((x) => x.id === viewport.scene);
            if (target) target.camera = this.port!.camera();
          });
        });
        const x = numberInput(viewport.x, 5);
        x.addEventListener('change', () => Number.isFinite(Number(x.value)) && change('Move 3D View', { x: Number(x.value) }));
        const y = numberInput(viewport.y, 5);
        y.addEventListener('change', () => Number.isFinite(Number(y.value)) && change('Move 3D View', { y: Number(y.value) }));
        const remove = iconButton(Trash2, 'Remove from sheet');
        remove.addEventListener('click', () => this.commit('Remove 3D View', (n) => {
          const target = n.layouts.find((l) => l.id === layout.id);
          if (target) target.viewports = target.viewports.filter((v) => v.id !== viewport.id);
        }));
        row.append(name, field('width', width, 'mm'), update, field('x', x, 'mm'), field('y', y, 'mm'), remove);
        this.viewportsEditor.append(row);
        continue;
      }
      row.append(el('span', 'unit', viewSetup(viewport.view, this.settings, bounds).title));
      const scale = el('select');
      for (const value of new Set([...SCALES, viewport.scale].sort((a, b) => a - b))) {
        const option = el('option', undefined, `1:${value}`);
        option.value = String(value);
        option.selected = value === viewport.scale;
        scale.append(option);
      }
      scale.addEventListener('change', () => change('Viewport Scale', { scale: Number(scale.value) }));
      const x = numberInput(viewport.x, 5);
      x.addEventListener('change', () => Number.isFinite(Number(x.value)) && change('Move Drawing', { x: Number(x.value) }));
      const y = numberInput(viewport.y, 5);
      y.addEventListener('change', () => Number.isFinite(Number(y.value)) && change('Move Drawing', { y: Number(y.value) }));
      const remove = iconButton(Trash2, 'Remove from sheet');
      remove.addEventListener('click', () => this.commitLayout('Remove Drawing', (l) => ({ ...l, viewports: l.viewports.filter((v) => v.id !== viewport.id) })));
      row.append(scale, field('x', x, 'mm'), field('y', y, 'mm'), remove);
      this.viewportsEditor.append(row);
    }
    if (layout.viewports.length === 0) this.viewportsEditor.append(el('span', 'unit', 'Open a drawing and choose "Add to sheet", or add a 3D view.'));

    for (const note of layout.texts ?? []) {
      const patch = (label: string, change: Partial<typeof note>) =>
        this.commitLayout(label, (l) => ({ ...l, texts: (l.texts ?? []).map((t) => (t.id === note.id ? { ...t, ...change } : t)) }));
      const row = el('div', 'level-row');
      const text = el('textarea');
      text.rows = Math.min(4, note.text.split('\n').length);
      text.value = note.text;
      text.addEventListener('change', () => patch('Edit Note', { text: text.value }));
      const size = numberInput(note.size, 1);
      size.addEventListener('change', () => Number(size.value) > 0 && patch('Note Size', { size: Number(size.value) }));
      const x = numberInput(note.x, 5);
      x.addEventListener('change', () => Number.isFinite(Number(x.value)) && patch('Move Note', { x: Number(x.value) }));
      const y = numberInput(note.y, 5);
      y.addEventListener('change', () => Number.isFinite(Number(y.value)) && patch('Move Note', { y: Number(y.value) }));
      const remove = iconButton(Trash2, 'Remove note');
      remove.addEventListener('click', () => this.commitLayout('Remove Note', (l) => ({ ...l, texts: (l.texts ?? []).filter((t) => t.id !== note.id) })));
      row.append(text, field('size', size, 'mm'), field('x', x, 'mm'), field('y', y, 'mm'), remove);
      this.viewportsEditor.append(row);
    }

    const addNote = el('button', 'pill-button');
    addNote.type = 'button';
    addNote.append(createElement(Plus, { width: 14, height: 14 }), ' Text');
    addNote.title = 'Add a title or note to the page';
    addNote.addEventListener('click', () =>
      this.commitLayout('Add Note', (l) => {
        const texts = l.texts ?? [];
        let n = texts.length + 1;
        while (texts.some((t) => t.id === `note-${n}`)) n++;
        return { ...l, texts: [...texts, { id: `note-${n}`, x: 20, y: 20, text: 'Title', size: 8 }] };
      }),
    );
    const north = el('button', 'pill-button', 'North arrow');
    north.type = 'button';
    north.setAttribute('aria-pressed', String(!!layout.north));
    north.addEventListener('click', () => {
      const [width] = layout.north ? [0] : [{ A4: 297, A3: 420, A2: 594, A1: 841 }[layout.paper]];
      this.commitLayout('North Arrow', (l) => ({ ...l, north: l.north ? undefined : { x: width - 24, y: 24 } }));
    });
    const addScene = el('button', 'pill-button');
    addScene.type = 'button';
    addScene.append(createElement(Plus, { width: 14, height: 14 }), ' 3D view');
    addScene.title = 'Put a picture of the 3D view, as it is now, on the sheet';
    addScene.disabled = !this.port;
    addScene.addEventListener('click', () => this.addSceneToSheet());
    const actions = el('div', 'level-row');
    actions.append(addNote, addScene, north);
    this.viewportsEditor.append(actions);
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
    document.addEventListener('click', () => (this.exportMenu.hidden = true));
    this.fillExportMenu();
  }

  /** The menu follows the mode: one drawing and the whole set, or one sheet and all sheets. */
  private fillExportMenu(): void {
    this.exportMenu.replaceChildren();
    const item = (label: string, action: () => void) => {
      const b = el('button', 'menu-item', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.exportMenu.hidden = true;
        action();
      });
      this.exportMenu.append(b);
    };
    if (this.sheetsMode) {
      item('This sheet as SVG', () => this.exportSvg());
      item('This sheet as PNG', () => this.exportPng(`${this.fileBase()} - ${this.currentLayout()?.name ?? 'sheet'}.png`));
      item('This sheet as PDF', () => this.exportLayoutPdf(false));
      item('All sheets as PDF', () => this.exportLayoutPdf(true));
    } else {
      item('This drawing as SVG', () => this.exportSvg());
      item('This drawing as PNG', () => this.exportPng(`${this.fileBase()} - ${this.setup?.title ?? 'drawing'} 1-${this.scale}.png`));
      item('This drawing as PDF', () => this.exportPdf(false));
      item('All drawings as PDF', () => this.exportPdf(true));
    }
  }

  private fileBase(): string {
    return this.doc.name.replace(/[\\/:*?"<>|]+/g, '-');
  }

  private exportSvg(): void {
    if (!this.svg) return;
    if (this.sheetsMode) {
      const layout = this.currentLayout();
      if (layout) download(this.layoutSvg(layout), 'image/svg+xml', `${this.fileBase()} - ${layout.name}.svg`);
      return;
    }
    if (!this.setup) return;
    download(this.svg, 'image/svg+xml', `${this.fileBase()} - ${this.setup.title} 1-${this.scale}.svg`);
  }

  /** Renders the SVG on show to a PNG at 200 dpi (paper size from the SVG's own millimetres). */
  private exportPng(name: string): void {
    const layout = this.currentLayout();
    const svg = this.sheetsMode && layout ? this.layoutSvg(layout) : this.svg;
    if (!svg) return;
    const match = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
    if (!match) return;
    const dpi = 200;
    const width = Math.round((Number(match[1]) / 25.4) * dpi);
    const height = Math.round((Number(match[2]) / 25.4) * dpi);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => blob && download(blob, 'image/png', name));
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  private exportLayoutPdf(all: boolean): void {
    const layouts = all ? this.doc.drawingSettings.layouts : [this.currentLayout()].filter((l): l is Layout => !!l);
    if (layouts.length === 0) return;
    const flat = this.doc.flatten();
    const pdf = sheetsToPdf(
      layouts.map((layout) => composeLayout(this.doc, layout, this.doc.drawingSettings, flat, this.pictureProvider(EXPORT_DPI, true)).sheet),
      this.doc.name,
    );
    download(pdf.slice().buffer, 'application/pdf', all ? `${this.fileBase()} - sheets.pdf` : `${this.fileBase()} - ${layouts[0].name}.pdf`);
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
    if (this.sheetsMode) {
      this.updateSheets(flat, start);
      return;
    }
    this.empty.textContent = 'Draw something to see its drawings here.';
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

  /**
   * Pictures for scenes on a sheet. Renders are cached by camera, size and model version; while the model is
   * changing a recent picture is reused for a moment (and refreshed shortly after), so dragging stays smooth.
   */
  private pictureProvider(dpi: number, fresh = false): ImageProvider | undefined {
    const port = this.port;
    if (!port) return undefined;
    return (scene, widthMm, heightMm) => {
      const pixels: [number, number] = [Math.round((widthMm / 25.4) * dpi), Math.round((heightMm / 25.4) * dpi)];
      const key = `${JSON.stringify(scene.camera)}|${(scene.hidden ?? []).join(',')}|${pixels.join('x')}|${this.modelVersion}`;
      const cached = this.pictures.get(key);
      if (cached) return cached;
      const last = this.lastPicture.get(scene.id);
      if (!fresh && last && performance.now() - last.at < 400) {
        // Too soon after the last render: show that one and refresh when things settle.
        window.clearTimeout(this.pictureTimer);
        this.pictureTimer = window.setTimeout(() => this.schedule(), 420);
        return last.image;
      }
      const image = port.snapshot(scene.camera, pixels[0], pixels[1], scene.hidden ?? []);
      if (!image) return null;
      if (this.pictures.size > 12) this.pictures.clear();
      this.pictures.set(key, image);
      this.lastPicture.set(scene.id, { image, at: performance.now() });
      return image;
    };
  }

  /** The current sheet as SVG at export quality. */
  private layoutSvg(layout: Layout): string {
    const { sheet } = composeLayout(this.doc, layout, this.doc.drawingSettings, this.doc.flatten(), this.pictureProvider(EXPORT_DPI, true));
    return sheetToSvg(sheet);
  }

  private updateSheets(flat: ReturnType<Document['flatten']>, start: number): void {
    this.setup = null;
    this.page = null;
    this.viewChanged.emit(null);
    const layout = this.currentLayout();
    const isEmpty = !layout || layout.viewports.length === 0;
    this.empty.textContent = layout ? 'Open a drawing and choose "Add to sheet" to place it here.' : 'Press + to make a sheet, then add drawings to it.';
    this.empty.hidden = !isEmpty;
    this.sheet.hidden = isEmpty;
    if (!layout || isEmpty) {
      this.status.textContent = '';
      this.svg = '';
      return;
    }
    const { sheet, fits, rects } = composeLayout(this.doc, layout, this.settings, flat, this.pictureProvider(PREVIEW_DPI));
    this.page = { width: sheet.width, height: sheet.height, items: rects };
    this.svg = sheetToSvg(sheet);
    this.sheet.innerHTML = this.svg;
    const ms = Math.max(1, Math.round(performance.now() - start));
    this.status.textContent = fits ? `Live · ${ms} ms` : `A drawing does not fit on ${layout.paper}`;
    this.status.dataset.warn = String(!fits);
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
    let moving: { item: PageItem; dx: number; dy: number; layout: Layout } | null = null;
    this.stage.addEventListener('pointerdown', (e) => {
      const hit = this.sheetsMode ? this.pickOnPage(e) : null;
      const layout = this.currentLayout();
      if (hit && layout) {
        moving = { item: hit.item, dx: hit.x - hit.item.x, dy: hit.y - hit.item.y, layout };
      } else {
        drag = { x: e.clientX, y: e.clientY };
      }
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (moving) {
        const at = this.pagePoint(e);
        if (at) this.previewMove(moving.layout, moving.item, Math.round(at.x - moving.dx), Math.round(at.y - moving.dy));
        return;
      }
      if (!drag) return;
      this.view.x += e.clientX - drag.x;
      this.view.y += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      this.applyView();
    });
    this.stage.addEventListener('pointerup', () => {
      drag = null;
      if (moving && this.preview) {
        // The drag was previewed live; make it one undo step.
        const next = this.preview;
        this.preview = null;
        this.doc.updateDrawingSettings('Move on Sheet', next);
      }
      moving = null;
    });
    this.stage.addEventListener('dblclick', () => {
      this.view = { x: 0, y: 0, zoom: 1 };
      this.applyView();
    });
  }

  /** The paper position (mm) under a pointer event, when the sheet is on show. */
  private pagePoint(e: PointerEvent): { x: number; y: number } | null {
    const svg = this.sheet.querySelector('svg');
    if (!svg || !this.page) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const k = this.page.width / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
  }

  /** The topmost thing on the page under the pointer (notes and the arrow over drawings). */
  private pickOnPage(e: PointerEvent): { item: PageItem; x: number; y: number } | null {
    const at = this.pagePoint(e);
    if (!at || !this.page) return null;
    const order = { text: 0, north: 0, viewport: 1 };
    const hit = [...this.page.items]
      .filter((i) => at.x >= i.x && at.x <= i.x + i.w && at.y >= i.y && at.y <= i.y + i.h)
      .sort((a, b) => order[a.kind] - order[b.kind])[0];
    return hit ? { item: hit, ...at } : null;
  }

  /** Shows a dragged item at a new place without committing it. */
  private previewMove(layout: Layout, item: PageItem, x: number, y: number): void {
    const next = structuredClone(this.doc.drawingSettings);
    const target = next.layouts.find((l) => l.id === layout.id);
    if (!target) return;
    if (item.kind === 'viewport') {
      const vp = target.viewports.find((v) => v.id === item.id);
      if (vp) Object.assign(vp, { x, y });
    } else if (item.kind === 'text') {
      const note = target.texts?.find((t) => t.id === item.id);
      if (note) Object.assign(note, { x, y });
    } else if (target.north) {
      target.north = { x: x + 6, y: y + 10 };
    }
    this.preview = next;
    this.schedule();
  }

  private applyView(): void {
    this.sheet.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
  }
}
