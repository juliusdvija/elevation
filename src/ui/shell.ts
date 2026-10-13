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
  Expand,
  FilePlus,
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
  gridSnapToggle: HTMLButtonElement;
  docName: HTMLElement;
  newDoc: HTMLButtonElement;
  openDoc: HTMLButtonElement;
  saveDoc: HTMLButtonElement;
  toolButtons: Map<string, HTMLButtonElement>;
  viewButtons: Map<StandardView, HTMLButtonElement>;
  projection: HTMLButtonElement;
  zoomExtents: HTMLButtonElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  hint: HTMLElement;
  measurements: HTMLInputElement;
}

const TOOL_ICONS: Record<string, IconNode> = {
  select: MousePointer2,
  line: PenLine,
  rectangle: RectangleHorizontal,
  circle: Circle,
  arc: Spline,
  pushpull: ArrowUpFromLine,
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
  const saveDoc = iconButton(Save, 'Save (⌘S)');
  const fileGroup = el('div', 'group');
  fileGroup.append(newDoc, openDoc, saveDoc);

  const toolGroup = el('div', 'group');
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const tool of tools) {
    if (tool.id === 'orbit') toolGroup.append(el('span', 'divider'));
    const button = iconButton(TOOL_ICONS[tool.id] ?? Box, `${tool.label} (${tool.shortcut})`);
    toolButtons.set(tool.id, button);
    toolGroup.append(button);
  }

  // The views as a box that unfolds on hover. Closed it is an isometric cube (Front left, Right right,
  // Top above); open, Front stays and the other faces fold flat around it: Top above, Left, Right and
  // Back beside it, each labelled with its initial. Every face is a button; an extra cell is the cube itself.
  const viewGroup = el('div', 'group');
  const viewButtons = new Map<StandardView, HTMLButtonElement>();
  const fold = el('div', 'view-fold');
  fold.setAttribute('role', 'group');
  fold.setAttribute('aria-label', 'Standard views');
  fold.append(el('span', 'fold-card'));
  // Cell size 15, gap 2. `x`/`y` place the flat cell; `closed` is the transform that puts it on the cube
  // (an isometric matrix: edges at 30 degrees, a 15 mm edge), relative to its flat position.
  const FOLD: { view: StandardView; letter: string; label: string; x: number; y: number; closed: string; hidden?: boolean }[] = [
    { view: 'top', letter: 'T', label: 'Top', x: 0, y: 1, closed: 'matrix(0.866, 0.5, -0.866, 0.5, 13, 0)' },
    { view: 'left', letter: 'L', label: 'Left', x: -17, y: 18, closed: 'matrix(0.001, 0, 0, 1, 17, -9.5)', hidden: true },
    { view: 'front', letter: 'F', label: 'Front', x: 0, y: 18, closed: 'matrix(0.866, 0.5, 0, 1, 0, -9.5)' },
    { view: 'right', letter: 'R', label: 'Right', x: 17, y: 18, closed: 'matrix(0.866, -0.5, 0, 1, -4, -2)' },
    { view: 'back', letter: 'B', label: 'Back', x: 34, y: 18, closed: 'matrix(0.001, 0, 0, 1, -8, -9.5)', hidden: true },
    { view: 'iso', letter: '◇', label: 'Isometric', x: 17, y: 1, closed: 'matrix(0.001, 0, 0, 0.001, -4, 12)', hidden: true },
  ];
  for (const f of FOLD) {
    const button = el('button', 'fold-face', f.letter);
    button.type = 'button';
    button.title = `${f.label} view`;
    button.setAttribute('aria-label', `${f.label} view`);
    button.dataset.hidden = String(!!f.hidden);
    button.style.left = `${f.x}px`;
    button.style.top = `${f.y}px`;
    button.style.setProperty('--closed', f.closed);
    viewButtons.set(f.view, button);
    fold.append(button);
  }
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
  const panelGroup = el('div', 'group');
  panelGroup.append(componentsToggle, drawingsToggle);

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
  statusbar.append(hint, measureWrap);

  root.append(toolbar, workspace, statusbar);
  mount.append(root);

  return { root, workspace, viewport, drawingsToggle, componentsToggle, gridSnapToggle, docName, newDoc, openDoc, saveDoc, toolButtons, viewButtons, projection, zoomExtents, undo, redo, hint, measurements };
}
