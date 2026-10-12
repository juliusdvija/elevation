import './ui/style.css';
import { Document } from './document';
import { Viewport } from './viewport/Viewport';
import { ModelRenderer } from './viewport/ModelRenderer';
import { Navigator } from './tools/Navigator';
import { Picker } from './tools/Picker';
import { Selection } from './tools/Selection';
import { SnapMarker } from './tools/overlay';
import { Inference } from './tools/inference';
import { InferenceFeedback } from './tools/feedback';
import { createTapeMeasureTool } from './tools/TapeMeasureTool';
import { ToolManager } from './tools/ToolManager';
import { createOrbitTool, createPanTool } from './tools/navigationTools';
import { createSelectTool } from './tools/SelectTool';
import { createLineTool } from './tools/LineTool';
import { createRectangleTool } from './tools/RectangleTool';
import { createPushPullTool } from './tools/PushPullTool';
import { createEraserTool } from './tools/EraserTool';
import type { ToolContext } from './tools/Tool';
import { buildShell } from './ui/shell';
import { DrawingPanel } from './ui/DrawingPanel';
import { CutPlaneGizmo } from './viewport/CutPlaneGizmo';

const toolInfo = [
  { id: 'select', label: 'Select', shortcut: 'Space' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { id: 'pushpull', label: 'Push/Pull', shortcut: 'P' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'tape', label: 'Tape Measure', shortcut: 'T' },
  { id: 'orbit', label: 'Orbit', shortcut: 'O' },
  { id: 'pan', label: 'Pan', shortcut: 'H' },
];

const shell = buildShell(document.getElementById('app')!, toolInfo);
const doc = new Document();
const { history, model } = doc;
const viewport = new Viewport(shell.viewport);
const renderer = new ModelRenderer(model, viewport);
const navigator = new Navigator(viewport);
const picker = new Picker(model, viewport, renderer);
const selection = new Selection();
const marker = new SnapMarker(viewport);
const inference = new Inference(model, picker, viewport);
const feedback = new InferenceFeedback(viewport, marker);

// Measurements box: shows live values from the active tool, or what the user types.
let typed = '';
let live = '';
function showMeasurement() {
  shell.measurements.value = typed || live;
  shell.measurements.dataset.typed = String(typed !== '');
}

const ctx: ToolContext = {
  doc,
  viewport,
  renderer,
  navigator,
  picker,
  selection,
  marker,
  inference,
  feedback,
  setHint: (text) => (shell.hint.textContent = text),
  setMeasurement: (value) => {
    live = value;
    showMeasurement();
  },
};

const tools = new ToolManager(ctx);
for (const create of [
  createSelectTool,
  createLineTool,
  createRectangleTool,
  createPushPullTool,
  createEraserTool,
  createTapeMeasureTool,
  createOrbitTool,
  createPanTool,
]) {
  tools.register(create(ctx));
}

tools.changed.on((tool) => {
  for (const [id, button] of shell.toolButtons) button.setAttribute('aria-pressed', String(id === tool.id));
  typed = '';
  showMeasurement();
  feedback.clear();
});
for (const [id, button] of shell.toolButtons) button.addEventListener('click', () => tools.activate(id));
tools.activate('select');

selection.changed.on(() => renderer.setSelection({ faces: selection.faces, edges: selection.edges }));
model.changed.on(() => selection.prune(model));
viewport.canvas.addEventListener('pointerleave', () => feedback.clear());

// Grid snap, remembered per browser.
const GRID_SNAP_KEY = 'elevation.gridSnap';
try {
  inference.gridSnap = localStorage.getItem(GRID_SNAP_KEY) !== 'off';
} catch {
  // Storage unavailable: keep the default.
}
function syncGridSnap() {
  shell.gridSnapToggle.setAttribute('aria-pressed', String(inference.gridSnap));
  shell.gridSnapToggle.title = inference.gridSnap ? 'Snap to grid: on' : 'Snap to grid: off';
}
shell.gridSnapToggle.addEventListener('click', () => {
  inference.gridSnap = !inference.gridSnap;
  try {
    localStorage.setItem(GRID_SNAP_KEY, inference.gridSnap ? 'on' : 'off');
  } catch {
    // Not persisted; the toggle still works for this session.
  }
  syncGridSnap();
});
syncGridSnap();

// Drawings
const drawings = new DrawingPanel(model);
shell.workspace.append(drawings.el);
const cutPlane = new CutPlaneGizmo(viewport);
drawings.viewChanged.on((setup) => cutPlane.show(setup, model.bounds()));
function syncDrawingsToggle() {
  shell.drawingsToggle.setAttribute('aria-pressed', String(drawings.isVisible));
  shell.drawingsToggle.title = drawings.isVisible ? 'Hide drawings' : 'Show drawings';
}
shell.drawingsToggle.addEventListener('click', () => {
  drawings.setVisible(!drawings.isVisible);
  syncDrawingsToggle();
});
syncDrawingsToggle();

// Camera
for (const [view, button] of shell.viewButtons) {
  button.addEventListener('click', () => {
    viewport.rig.setView(view);
    viewport.requestRender();
  });
}

shell.projection.addEventListener('click', () => {
  viewport.rig.toggleProjection();
  shell.projection.textContent = viewport.rig.isOrtho ? 'Parallel' : 'Perspective';
  viewport.requestRender();
});
shell.zoomExtents.addEventListener('click', () => navigator.zoomExtents());

// History
function syncHistory() {
  shell.undo.disabled = !history.canUndo;
  shell.redo.disabled = !history.canRedo;
  shell.undo.title = history.undoLabel ? `Undo ${history.undoLabel} (⌘Z)` : 'Undo (⌘Z)';
  shell.redo.title = history.redoLabel ? `Redo ${history.redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)';
}
history.changed.on(syncHistory);
function undo() {
  tools.cancel();
  history.undo();
}
function redo() {
  tools.cancel();
  history.redo();
}
shell.undo.addEventListener('click', undo);
shell.redo.addEventListener('click', redo);
syncHistory();

// Keyboard
const MEASUREMENT_KEY = /^[0-9.,;\-]$/;
const MEASUREMENT_UNIT_KEY = /^[a-z ]$/i;

window.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('input:not([readonly]), textarea, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const tool = tools.active;

  // Typing a value for the Measurements box.
  if (!mod && tool?.onMeasurement) {
    if (MEASUREMENT_KEY.test(e.key) || (typed && MEASUREMENT_UNIT_KEY.test(e.key))) {
      e.preventDefault();
      typed += e.key;
      showMeasurement();
      return;
    }
    if (typed && e.key === 'Backspace') {
      e.preventDefault();
      typed = typed.slice(0, -1);
      showMeasurement();
      return;
    }
    if (typed && e.key === 'Enter') {
      e.preventDefault();
      tool.onMeasurement(typed);
      typed = '';
      showMeasurement();
      return;
    }
    if (typed && e.key === 'Escape') {
      typed = '';
      showMeasurement();
      return;
    }
  }

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (e.shiftKey && !mod && e.key.toLowerCase() === 'z') {
    navigator.zoomExtents();
  } else if (tools.keyDown(e)) {
    e.preventDefault();
  }
});

viewport.rig.setView('iso');

if (import.meta.env.DEV) {
  // Debug handle for the browser console.
  const loadSample = async () => {
    (await import('./dev/sample')).buildSample(doc);
    navigator.zoomExtents();
  };
  Object.assign(window, { __elevation: { doc, model, viewport, picker, tools, selection, drawings, loadSample } });
}
