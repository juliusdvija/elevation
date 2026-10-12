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
import { createFigureTool } from './tools/FigureTool';
import { createDimensionTool } from './tools/DimensionTool';
import { DimensionRenderer } from './viewport/DimensionRenderer';
import { createTapeMeasureTool } from './tools/TapeMeasureTool';
import { createMoveTool } from './tools/MoveTool';
import { createRotateTool } from './tools/RotateTool';
import { createCircleTool } from './tools/CircleTool';
import { createArcTool } from './tools/ArcTool';
import { createOffsetTool } from './tools/OffsetTool';
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
import { openDocument, saveDocument } from './io/files';
import { restoreAutosave, startAutosave } from './io/autosave';
import { CutPlaneGizmo } from './viewport/CutPlaneGizmo';
import { GroupBar } from './ui/GroupBar';

const toolInfo = [
  { id: 'select', label: 'Select', shortcut: 'Space' },
  { id: 'line', label: 'Line', shortcut: 'L' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R' },
  { id: 'circle', label: 'Circle', shortcut: 'C' },
  { id: 'arc', label: 'Arc', shortcut: 'A' },
  { id: 'pushpull', label: 'Push/Pull', shortcut: 'P' },
  { id: 'move', label: 'Move', shortcut: 'M' },
  { id: 'rotate', label: 'Rotate', shortcut: 'Q' },
  { id: 'offset', label: 'Offset', shortcut: 'F' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'tape', label: 'Tape Measure', shortcut: 'T' },
  { id: 'dimension', label: 'Dimension', shortcut: 'D' },
  { id: 'figure', label: 'Scale Figure', shortcut: 'N' },
  { id: 'orbit', label: 'Orbit', shortcut: 'O' },
  { id: 'pan', label: 'Pan', shortcut: 'H' },
];

const shell = buildShell(document.getElementById('app')!, toolInfo);
const doc = new Document();
const { history, model } = doc;
const viewport = new Viewport(shell.viewport);
const renderer = new ModelRenderer(doc, viewport);
new DimensionRenderer(doc, viewport);
const navigator = new Navigator(viewport);
const picker = new Picker(doc, viewport, renderer);
const selection = new Selection();
const marker = new SnapMarker(viewport);
const inference = new Inference(picker, viewport);
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
  createCircleTool,
  createArcTool,
  createPushPullTool,
  createMoveTool,
  createRotateTool,
  createOffsetTool,
  createEraserTool,
  createTapeMeasureTool,
  createDimensionTool,
  createFigureTool,
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

selection.changed.on(() => renderer.setSelection({ faces: selection.faces, edges: selection.edges, instances: selection.instances }));
doc.geometryChanged.on(() => selection.prune(doc.context.model));
doc.contextChanged.on(() => {
  tools.cancel();
  selection.clear();
});

// Groups and components
function makeGroup(kind: 'group' | 'component') {
  if (selection.empty) return;
  tools.cancel();
  const faces = [...selection.faces];
  const edges = [...selection.edges];
  const instances = [...selection.instances];
  const id = doc.run(kind === 'group' ? 'Make Group' : 'Make Component', () => doc.makeDefinition(kind, faces, edges, instances));
  selection.clear();
  selection.add({ kind: 'instance', id });
}
function selectedInstance(): number | undefined {
  return selection.instances.size === 1 && selection.faces.size === 0 && selection.edges.size === 0 ? [...selection.instances][0] : undefined;
}
function explodeSelected() {
  const id = selectedInstance();
  if (id === undefined) return;
  tools.cancel();
  doc.run('Explode', () => doc.explode(id));
  selection.clear();
}
function editSelected() {
  const id = selectedInstance();
  if (id !== undefined) doc.enter(id);
}
new GroupBar(shell.viewport, doc, selection, { makeGroup, explode: explodeSelected, edit: editSelected });
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
const drawings = new DrawingPanel(doc);
shell.workspace.append(drawings.el);
const cutPlane = new CutPlaneGizmo(viewport);
drawings.viewChanged.on((setup) => cutPlane.show(setup, doc.bounds()));
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

// Files
function syncTitle() {
  shell.docName.textContent = doc.name;
  shell.docName.dataset.dirty = String(doc.dirty);
  document.title = `${doc.name}${doc.dirty ? ' •' : ''} — Elevation`;
}
doc.changed.on(syncTitle);

function afterLoad() {
  tools.cancel();
  selection.clear();
  viewport.requestRender();
}

async function confirmDiscard(): Promise<boolean> {
  return !doc.dirty || window.confirm(`Discard unsaved changes to "${doc.name}"?`);
}

async function save(saveAs = false) {
  try {
    tools.cancel();
    await saveDocument(doc, viewport.rig, { saveAs });
  } catch (error) {
    window.alert(`Could not save: ${(error as Error).message}`);
  }
}

async function open() {
  if (!(await confirmDiscard())) return;
  try {
    const file = await openDocument(doc, viewport.rig);
    if (!file) return;
    afterLoad();
    if (!file.camera) navigator.zoomExtents();
  } catch (error) {
    window.alert((error as Error).message);
  }
}

async function newDocument() {
  if (!(await confirmDiscard())) return;
  doc.reset();
  afterLoad();
}

shell.saveDoc.addEventListener('click', () => save());
shell.openDoc.addEventListener('click', () => open());
shell.newDoc.addEventListener('click', () => newDocument());
window.addEventListener('beforeunload', (e) => {
  if (doc.dirty && doc.fileHandle) e.preventDefault();
});

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
const MEASUREMENT_KEY = /^[0-9.,;\-\/]$/;
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

  if (mod && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    makeGroup(e.shiftKey ? 'component' : 'group');
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save(e.shiftKey);
  } else if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    open();
  } else if (mod && e.key.toLowerCase() === 'z') {
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

viewport.beforeRender = () => doc.setViewer(viewport.rig.camera.position);
viewport.rig.setView('iso');
const recovered = restoreAutosave(doc, viewport.rig);
if (recovered.restored) afterLoad();
else doc.addDefaultFigure();
if (recovered.unsaved) ctx.setHint('Restored your unsaved work from last time. Save it to keep it in a file (⌘S).');
startAutosave(doc, viewport.rig);
syncTitle();

if (import.meta.env.DEV) {
  // Debug handle for the browser console.
  const loadSample = async () => {
    (await import('./dev/sample')).buildSample(doc);
    navigator.zoomExtents();
  };
  const validate = async () => (await import('./kernel/validate')).validateModel(model);
  Object.assign(window, { __elevation: { doc, model, viewport, picker, tools, selection, drawings, loadSample, validate } });
}
