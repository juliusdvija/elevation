import {
  ArrowUpFromLine,
  Box,
  Eraser,
  Expand,
  Hand,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Redo2,
  Rotate3d,
  Undo2,
  createElement,
  type IconNode,
} from 'lucide';
import type { StandardView } from '../viewport/CameraRig';

export interface ShellElements {
  root: HTMLElement;
  viewport: HTMLElement;
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
  pushpull: ArrowUpFromLine,
  eraser: Eraser,
  orbit: Rotate3d,
  pan: Hand,
};

const VIEWS: [StandardView, string][] = [
  ['iso', 'Iso'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
];

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
  const brand = el('div', 'brand', 'Elevation');

  const toolGroup = el('div', 'group');
  const toolButtons = new Map<string, HTMLButtonElement>();
  for (const tool of tools) {
    if (tool.id === 'orbit') toolGroup.append(el('span', 'divider'));
    const button = iconButton(TOOL_ICONS[tool.id] ?? Box, `${tool.label} (${tool.shortcut})`);
    toolButtons.set(tool.id, button);
    toolGroup.append(button);
  }

  const viewGroup = el('div', 'group segmented');
  const viewButtons = new Map<StandardView, HTMLButtonElement>();
  for (const [view, label] of VIEWS) {
    const button = el('button', 'text-button', label);
    button.type = 'button';
    viewButtons.set(view, button);
    viewGroup.append(button);
  }

  const projection = el('button', 'text-button projection', 'Perspective');
  projection.type = 'button';
  projection.title = 'Toggle perspective / parallel projection';
  const zoomExtents = iconButton(Expand, 'Zoom extents (Shift+Z)');
  const cameraGroup = el('div', 'group');
  cameraGroup.append(projection, zoomExtents);

  const undo = iconButton(Undo2, 'Undo (⌘Z)');
  const redo = iconButton(Redo2, 'Redo (⇧⌘Z)');
  const historyGroup = el('div', 'group');
  historyGroup.append(undo, redo);

  toolbar.append(brand, toolGroup, el('div', 'spacer'), viewGroup, cameraGroup, historyGroup);

  const viewport = el('main', 'viewport');

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

  root.append(toolbar, viewport, statusbar);
  mount.append(root);

  return { root, viewport, toolButtons, viewButtons, projection, zoomExtents, undo, redo, hint, measurements };
}
