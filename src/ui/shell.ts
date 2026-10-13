import { UNIT_INFO } from '../core/units';
import { createLogo } from './logo';
import {
  ArrowUpFromLine,
  Circle,
  Move,
  RotateCw,
  Save,
  Spline,
  SquareDashed,
  Box,
  Eraser,
  PaintBucket,
  Route,
  Scaling,
  SquareRoundCorner,
  Expand,
  FilePlus,
  FileOutput,
  Import,
  FolderOpen,
  Grid3x3,
  Hand,
  PanelRight,
  Boxes,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Ruler,
  RulerDimensionLine,
  PersonStanding,
  Redo2,
  Info,
  Tags,
  Rotate3d,
  Undo2,
  createElement,
  type IconNode,
} from 'lucide';
import type { StandardView } from '../viewport/CameraRig';

export interface ShellElements {
  root: HTMLElement;
  workspace: HTMLElement;
  viewport: HTMLElement;
  drawingsToggle: HTMLButtonElement;
  componentsToggle: HTMLButtonElement;
  tagsToggle: HTMLButtonElement;
  infoToggle: HTMLButtonElement;
  gridSnapToggle: HTMLButtonElement;
  docName: HTMLElement;
  newDoc: HTMLButtonElement;
  openDoc: HTMLButtonElement;
  importDoc: HTMLButtonElement;
  exportDoc: HTMLButtonElement;
  saveDoc: HTMLButtonElement;
  toolButtons: Map<string, HTMLButtonElement>;
  viewButtons: Map<StandardView, HTMLButtonElement>;
  projection: HTMLButtonElement;
  zoomExtents: HTMLButtonElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  hint: HTMLElement;
  measurements: HTMLInputElement;
  unitSelect: HTMLSelectElement;
  gridSelect: HTMLSelectElement;
  decimalsSelect: HTMLSelectElement;
}

const TOOL_ICONS: Record<string, IconNode> = {
  select: MousePointer2,
  line: PenLine,
  rectangle: RectangleHorizontal,
  circle: Circle,
  arc: Spline,
  pushpull: ArrowUpFromLine,
  followme: Route,
  scale: Scaling,
  bevel: SquareRoundCorner,
  move: Move,
  rotate: RotateCw,
  offset: SquareDashed,
  eraser: Eraser,
  paint: PaintBucket,
  tape: Ruler,
  dimension: RulerDimensionLine,
  figure: PersonStanding,
  orbit: Rotate3d,
  pan: Hand,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(icon: IconNode, title: string): HTMLButtonElement {
  const button = el('button', 'icon-button');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(createElement(icon, { width: 18, height: 18, 'stroke-width': 1.75 }));
  return button;
}

export function buildShell(
  mount: HTMLElement,
  tools: { id: string; label: string; shortcut: string }[],
): ShellElements {
  const root = el('div', 'app');

  const toolbar = el('header', 'toolbar');
  const brand = el('div', 'brand');
  brand.append(createLogo(24), el('span', undefined, 'Elevation'));
  const docName = el('div', 'doc-name');
  const newDoc = iconButton(FilePlus, 'New');
  const openDoc = iconButton(FolderOpen, 'Open… (⌘O)');
  const importDoc = iconButton(Import, 'Import: OBJ, STL, glTF or a DXF underlay…');
  const exportDoc = iconButton(FileOutput, 'Export as OBJ (metres, Y up, with colours)');
  const saveDoc = iconButton(Save, 'Save (⌘S)');
  const fileGroup = el('div', 'group');
  fileGroup.append(newDoc, openDoc, importDoc, exportDoc, saveDoc);

  const toolGroup = el('div', 'group');
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const tool of tools) {
    if (tool.id === 'orbit') toolGroup.append(el('span', 'divider'));
    const button = iconButton(TOOL_ICONS[tool.id] ?? Box, `${tool.label} (${tool.shortcut})`);
    toolButtons.set(tool.id, button);
    toolGroup.append(button);
  }

  // The views as a box that unfolds on hover. A real 3D cube seen isometrically (Front on the left,
  // Right on the right, Top above); on hover every face turns 90 degrees about the edge it shares and
  // lies flat in the plane of Front, which does not move: Top above it, Bottom below, and a row
  // Back, Left, Front, Right. Each face is a button with its initial. The extra cell next to Top
  // (shown only when open) is the isometric view.
  const viewGroup = el('div', 'group');
  const viewButtons = new Map<StandardView, HTMLButtonElement>();
  const fold = el('div', 'view-fold');
  fold.setAttribute('role', 'group');
  fold.setAttribute('aria-label', 'Standard views');
  const card = el('span', 'fold-card');
  const scene = el('div', 'fold-scene');
  const face = (view: StandardView, letter: string, label: string, name: string) => {
    const node = el('div', `fold-face ${name}`);
    const button = el('button', 'fold-hit', letter);
    button.type = 'button';
    button.title = `${label} view`;
    button.setAttribute('aria-label', `${label} view`);
    viewButtons.set(view, button);
    node.append(button);
    return node;
  };
  const front = face('front', 'F', 'Front', 'front');
  const top = face('top', 'T', 'Top', 'top');
  const bottom = face('bottom', 'D', 'Bottom', 'bottom');
  const right = face('right', 'R', 'Right', 'right');
  const left = face('left', 'L', 'Left', 'left');
  const back = face('back', 'B', 'Back', 'back');
  const iso = face('iso', '◇', 'Isometric', 'iso');
  left.append(back); // Back hangs off Left, so it folds round the corner after it
  front.append(top, bottom, right, left, iso);
  scene.append(front);
  fold.append(card, scene);
  viewGroup.append(fold);

  const projection = el('button', 'text-button projection', 'Perspective');
  projection.type = 'button';
  projection.title = 'Toggle perspective / parallel projection';
  const zoomExtents = iconButton(Expand, 'Zoom extents (Shift+Z)');
  const gridSnapToggle = iconButton(Grid3x3, 'Snap to grid');
  const cameraGroup = el('div', 'group');
  cameraGroup.append(projection, zoomExtents, gridSnapToggle);

  const undo = iconButton(Undo2, 'Undo (⌘Z)');
  const redo = iconButton(Redo2, 'Redo (⇧⌘Z)');
  const historyGroup = el('div', 'group');
  historyGroup.append(undo, redo);

  const drawingsToggle = iconButton(PanelRight, 'Show drawings');
  const componentsToggle = iconButton(Boxes, 'Show components');
  const tagsToggle = iconButton(Tags, 'Show tags');
  const infoToggle = iconButton(Info, 'Show info: lengths, areas, volume, size and position of the selection');
  const panelGroup = el('div', 'group');
  panelGroup.append(infoToggle, tagsToggle, componentsToggle, drawingsToggle);

  toolbar.append(brand, docName, fileGroup, toolGroup, el('div', 'spacer'), viewGroup, cameraGroup, historyGroup, panelGroup);

  const workspace = el('div', 'workspace');
  const viewport = el('main', 'viewport');
  workspace.append(viewport);

  const statusbar = el('footer', 'statusbar');
  const hint = el('div', 'hint');
  const measureWrap = el('label', 'measurements');
  measureWrap.append(el('span', undefined, 'Measurements'));
  const measurements = el('input');
  measurements.readOnly = true;
  measurements.tabIndex = -1;
  measurements.spellcheck = false;
  measureWrap.append(measurements);
  // How lengths are shown and what a bare typed number means.
  const unitSelect = el('select', 'status-select');
  unitSelect.title = 'Units for lengths (a typed number without a unit uses this)';
  for (const [id, info] of Object.entries(UNIT_INFO)) unitSelect.append(Object.assign(el('option', undefined, info.suffix), { value: id }));
  const decimalsSelect = el('select', 'status-select');
  decimalsSelect.title = 'Decimals shown (trailing zeros are dropped)';
  for (const n of [0, 1, 2, 3, 4]) decimalsSelect.append(Object.assign(el('option', undefined, n === 0 ? '0' : `0.${'0'.repeat(n)}`), { value: String(n) }));
  const gridSelect = el('select', 'status-select');
  gridSelect.title = 'Snap and grid spacing: automatic from the zoom, or a fixed step';
  gridSelect.append(Object.assign(el('option', undefined, 'Grid: auto'), { value: 'auto' }));
  for (const mm of [0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000]) gridSelect.append(Object.assign(el('option', undefined, `Grid: ${mm} mm`), { value: String(mm) }));
  statusbar.append(hint, gridSelect, unitSelect, decimalsSelect, measureWrap);

  root.append(toolbar, workspace, statusbar);
  mount.append(root);

  return { root, workspace, viewport, drawingsToggle, componentsToggle, tagsToggle, infoToggle, gridSnapToggle, docName, newDoc, openDoc, importDoc, exportDoc, saveDoc, toolButtons, viewButtons, projection, zoomExtents, undo, redo, hint, measurements, unitSelect, gridSelect, decimalsSelect };
}
