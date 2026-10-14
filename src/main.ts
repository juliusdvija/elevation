import * as THREE from 'three';
import './ui/style.css';
import { Document } from './document';
import { Viewport } from './viewport/Viewport';
import { ModelRenderer } from './viewport/ModelRenderer';
import { RealisticRenderer } from './viewport/RealisticRenderer';
import { Navigator, type InputScheme } from './tools/Navigator';
import { createElement, Mouse, Touchpad } from 'lucide';
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
import { createFollowMeTool } from './tools/FollowMeTool';
import { createScaleTool } from './tools/ScaleTool';
import { createPaintTool, PaintState } from './tools/PaintTool';
import { PaintPalette } from './ui/PaintPalette';
import { ScenesBar } from './ui/ScenesBar';
import { InfoPanel } from './ui/InfoPanel';
import { SunPanel } from './ui/SunPanel';
import { RenderPanel } from './ui/RenderPanel';
import { DEFAULT_SUN } from './drawing/settings';
import { resolveSun } from './drawing/sun';
import { TagsPanel } from './ui/TagsPanel';
import type { Scene } from './drawing/settings';
import type { ToolContext } from './tools/Tool';
import { buildShell } from './ui/shell';
import { DrawingPanel } from './ui/DrawingPanel';
import { formatLength, displaySettings, setDisplaySettings, UNIT_INFO, type DisplayUnit } from './core/units';
import { applyCamera, cameraData, openDocument, saveDocument } from './io/files';
import { buildUnderlay } from './io/dxf';
import type { ImportMessage, ImportRequest } from './io/importWorker';
import { ProgressDialog } from './ui/ProgressDialog';
import { buildModel } from './io/obj';
import { Model } from './kernel/Model';
import { exportObj } from './io/objExport';
import { exportStl } from './io/stlExport';
import { flattenFace, layoutParts, layoutToDxf, layoutToSvg } from './io/flatExport';
import { askImportOptions, chooseObjFiles, isModelFile, readModelFiles } from './ui/ImportDialog';
import { EXAMPLE_NAME, loadExample } from './example';
import { restoreAutosave, startAutosave } from './io/autosave';
import { CutPlaneGizmo } from './viewport/CutPlaneGizmo';
import { GroupBar } from './ui/GroupBar';
import { ComponentsPanel } from './ui/ComponentsPanel';

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
  { id: 'followme', label: 'Follow Me', shortcut: 'W' },
  { id: 'scale', label: 'Scale', shortcut: 'S' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'paint', label: 'Paint', shortcut: 'B' },
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
const realistic = new RealisticRenderer(doc, viewport, renderer);
new DimensionRenderer(doc, viewport);
const navigator = new Navigator(viewport);
const picker = new Picker(doc, viewport, renderer);
const selection = new Selection();
const marker = new SnapMarker(viewport);
const inference = new Inference(picker, viewport);
const feedback = new InferenceFeedback(viewport, marker);

// Display units and precision, remembered between sessions.
const DISPLAY_KEY = 'elevation.display';
try {
  const saved = JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null');
  if (saved && saved.unit in UNIT_INFO && Number.isInteger(saved.decimals)) setDisplaySettings(saved);
} catch {
  /* private window or damaged value: keep the defaults */
}
shell.unitSelect.value = displaySettings().unit;
shell.decimalsSelect.value = String(displaySettings().decimals);
const changeDisplay = () => {
  setDisplaySettings({ unit: shell.unitSelect.value as DisplayUnit, decimals: Number(shell.decimalsSelect.value) });
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(displaySettings()));
  } catch {
    /* not remembered */
  }
};
// Smooth shading of rounded surfaces: a document setting, used by the 3D view and the drawings.
const syncSmoothing = () => {
  const degrees = doc.drawingSettings.smoothAngle ?? 20;
  if (![...shell.smoothSelect.options].some((o) => o.value === String(degrees))) shell.smoothSelect.append(Object.assign(document.createElement('option'), { value: String(degrees), textContent: `Smooth: ${degrees}°` }));
  shell.smoothSelect.value = String(degrees);
  renderer.setSmoothing(degrees);
  realistic.refresh();
};
doc.settingsChanged.on(syncSmoothing);
shell.smoothSelect.addEventListener('change', () => {
  doc.updateDrawingSettings('Smoothing', { ...structuredClone(doc.drawingSettings), smoothAngle: Number(shell.smoothSelect.value) });
});
syncSmoothing();

// Snap and grid spacing: automatic from the zoom, or a fixed step.
const GRID_MODE_KEY = 'elevation.gridMode';
try {
  const saved = localStorage.getItem(GRID_MODE_KEY);
  if (saved && [...shell.gridSelect.options].some((o) => o.value === saved)) shell.gridSelect.value = saved;
} catch {
  /* keep auto */
}
const applyGridMode = () => {
  viewport.gridMode = shell.gridSelect.value === 'auto' ? 'auto' : Number(shell.gridSelect.value);
  viewport.requestRender();
  try {
    localStorage.setItem(GRID_MODE_KEY, shell.gridSelect.value);
  } catch {
    /* not remembered */
  }
};
shell.gridSelect.addEventListener('change', applyGridMode);
applyGridMode();
// Mouse or trackpad navigation, one icon in the status bar.
const INPUT_KEY = 'elevation.inputScheme';
const applyInputScheme = (scheme: InputScheme) => {
  navigator.scheme = scheme;
  const trackpad = scheme === 'trackpad';
  const title = trackpad
    ? 'Trackpad: two-finger scroll orbits, Shift pans, pinch zooms. Click for mouse'
    : 'Mouse: wheel zooms, middle button orbits (Shift pans). Click for trackpad';
  shell.inputToggle.title = title;
  shell.inputToggle.setAttribute('aria-label', title);
  shell.inputToggle.replaceChildren(createElement(trackpad ? Touchpad : Mouse, { width: 16, height: 16, 'stroke-width': 1.75 }));
  try {
    localStorage.setItem(INPUT_KEY, scheme);
  } catch {
    /* not remembered */
  }
};
let savedScheme: string | null = null;
try {
  savedScheme = localStorage.getItem(INPUT_KEY);
} catch {
  /* default */
}
applyInputScheme(savedScheme === 'trackpad' ? 'trackpad' : 'mouse');
shell.inputToggle.addEventListener('click', () => applyInputScheme(navigator.scheme === 'mouse' ? 'trackpad' : 'mouse'));
shell.unitSelect.addEventListener('change', changeDisplay);
shell.decimalsSelect.addEventListener('change', changeDisplay);

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
  createFollowMeTool,
  createScaleTool,
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

const paintState = new PaintState();
tools.register(createPaintTool(ctx, paintState));
const palette = new PaintPalette(paintState);
shell.viewport.append(palette.el);

tools.changed.on((tool) => {
  palette.setVisible(tool.id === 'paint');
  for (const [id, button] of shell.toolButtons) button.setAttribute('aria-pressed', String(id === tool.id));
  typed = '';
  showMeasurement();
  feedback.clear();
});
for (const [id, button] of shell.toolButtons) button.addEventListener('click', () => tools.activate(id));
tools.activate('select');

selection.changed.on(() => {
  renderer.setSelection({ faces: selection.faces, edges: selection.edges, instances: selection.instances });
  viewport.setDimensionHighlight(selection.dimensions, null);
});
doc.settingsChanged.on(() => selection.pruneDimensions(new Set(doc.drawingSettings.dimensions.map((d) => d.id))));
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
/** Union, subtract or intersect the two selected groups; the first one selected is the one kept in a subtraction. */
function combineSelected(op: 'union' | 'subtract' | 'intersect') {
  const [first, second] = [...selection.instances];
  const result: { value: ReturnType<typeof doc.combineInstances> } = { value: { error: 'Select two groups or components.' } };
  ctx.setHint('Working…');
  doc.run({ union: 'Union', subtract: 'Subtract', intersect: 'Intersect' }[op], () => {
    result.value = doc.combineInstances(op, first, second);
  });
  const outcome = result.value;
  if ('error' in outcome) {
    ctx.setHint(outcome.error);
    return;
  }
  selection.clear();
  selection.instances.add(outcome.instance);
  selection.changed.emit();
  ctx.setHint('Done. Undo (⌘Z) brings the two groups back.');
}

new GroupBar(shell.viewport, doc, selection, { makeGroup, explode: explodeSelected, edit: editSelected, combine: combineSelected });
viewport.canvas.addEventListener('pointerleave', () => feedback.clear());

// Grid snap, remembered per browser.
const GRID_SNAP_KEY = 'elevation.gridSnap';
try {
  inference.gridSnap = localStorage.getItem(GRID_SNAP_KEY) === 'on';
} catch {
  // Storage unavailable: keep the default.
}
function syncGridSnap() {
  shell.gridSnapToggle.setAttribute('aria-pressed', String(inference.gridSnap));
  shell.gridSnapToggle.title = inference.gridSnap ? 'Grid and snap to grid: on' : 'Grid and snap to grid: off';
  viewport.gridVisible = inference.gridSnap;
  viewport.requestRender();
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

// Components overview
const components = new ComponentsPanel(shell.viewport, doc, selection);
shell.componentsToggle.addEventListener('click', () => {
  components.setVisible(!components.isVisible);
  shell.componentsToggle.setAttribute('aria-pressed', String(components.isVisible));
  shell.componentsToggle.title = components.isVisible ? 'Hide components' : 'Show components';
});

// Drawings
const drawings = new DrawingPanel(doc, {
  camera: () => cameraData(viewport.rig),
  ratio: () => viewport.container.clientHeight / Math.max(1, viewport.container.clientWidth),
  snapshot: (camera, width, height, hidden) => {
    // A picture shows the tags its scene had hidden: switch them for the render, then put the view back.
    const before = doc.hiddenTags();
    const same = hidden.length === before.size && hidden.every((t) => before.has(t));
    if (!same) doc.setHiddenTags(hidden);
    try {
      return viewport.snapshot(camera, width, height);
    } finally {
      if (!same) doc.setHiddenTags(before);
    }
  },
});
shell.workspace.append(drawings.el);

// Saved views: a strip over the 3D view; clicking one flies the camera there.
let flight = 0;
function flyTo(scene: Scene) {
  const camera = scene.camera;
  // The view remembers which tags were hidden.
  doc.setHiddenTags(scene.hidden ?? []);
  cancelAnimationFrame(flight);
  const rig = viewport.rig;
  if (rig.isOrtho !== camera.ortho) rig.toggleProjection();
  const from = { position: rig.position.clone(), target: rig.target.clone(), orthoHeight: rig.orthoHeight };
  const to = { position: new THREE.Vector3(...camera.position), target: new THREE.Vector3(...camera.target), orthoHeight: camera.orthoHeight };
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / 450);
    const k = t * t * (3 - 2 * t); // ease in and out
    rig.position.lerpVectors(from.position, to.position, k);
    rig.target.lerpVectors(from.target, to.target, k);
    rig.orthoHeight = from.orthoHeight + (to.orthoHeight - from.orthoHeight) * k;
    rig.update();
    viewport.requestRender();
    if (t < 1) flight = requestAnimationFrame(step);
    else {
      applyCamera(rig, camera); // land exactly on the saved view
      viewport.requestRender();
    }
  };
  flight = requestAnimationFrame(step);
}
// Taking over the camera cancels a flight in progress.
for (const type of ['pointerdown', 'wheel'] as const) shell.viewport.addEventListener(type, () => cancelAnimationFrame(flight), { capture: true, passive: true });
const infoPanel = new InfoPanel(ctx, doc, selection);
shell.viewport.append(infoPanel.el);
shell.infoToggle.addEventListener('click', () => {
  infoPanel.setVisible(!infoPanel.isVisible);
  shell.infoToggle.setAttribute('aria-pressed', String(infoPanel.isVisible));
});
const tagsPanel = new TagsPanel(doc);
shell.viewport.append(tagsPanel.el);
shell.tagsToggle.addEventListener('click', () => {
  tagsPanel.setVisible(!tagsPanel.isVisible);
  shell.tagsToggle.setAttribute('aria-pressed', String(tagsPanel.isVisible));
});
// The render settings panel belongs to the photorealistic view: it shows while that is on.
const renderPanel = new RenderPanel(realistic, doc);
shell.viewport.append(renderPanel.el);
shell.renderToggle.addEventListener('click', () => {
  realistic.setEnabled(!realistic.isOn);
  renderPanel.setVisible(realistic.isOn);
  shell.renderToggle.setAttribute('aria-pressed', String(realistic.isOn));
  shell.renderToggle.blur();
});
shell.renderToggle.setAttribute('aria-pressed', 'false');
const sunPanel = new SunPanel(doc);
shell.viewport.append(sunPanel.el);
shell.sunToggle.addEventListener('click', () => {
  sunPanel.setVisible(!sunPanel.isVisible);
  shell.sunToggle.setAttribute('aria-pressed', String(sunPanel.isVisible));
});
// The sun belongs to the document: the 3D view follows its settings, also after a file is opened.
const syncSun = () => {
  const sun = { ...DEFAULT_SUN, ...doc.drawingSettings.sun };
  viewport.setSun(resolveSun(sun));
  viewport.setNorth(sun.mode === 'place' ? sun.northAngle! : null);
};
doc.settingsChanged.on(syncSun);
doc.sunMoved.on(syncSun);
syncSun();
const scenesBar = new ScenesBar(doc, { camera: () => cameraData(viewport.rig), flyTo });
shell.viewport.append(scenesBar.el);

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
    // Let the folded-out box close again (it stays open while a face has focus).
    button.blur();
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
  drawings.suggestScale();
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

/**
 * Builds the imported model in a Web Worker so the page stays alive, with a progress bar and Cancel.
 * Resolves to null when cancelled. Falls back to building on this thread where workers are missing.
 */
function buildInWorker(choice: Awaited<ReturnType<typeof askImportOptions>> & object): Promise<Model | null> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(choice.drawing ? buildUnderlay(choice.drawing, choice.options.scale, choice.options.recenter) : buildModel(choice.mesh, choice.options));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./io/importWorker.ts', import.meta.url), { type: 'module' });
    const progress = new ProgressDialog(`Importing ${choice.name}`, () => {
      worker.terminate();
      resolve(null);
    });
    worker.onmessage = (event: MessageEvent<ImportMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        progress.update(message.fraction, message.stage);
        return;
      }
      progress.close();
      worker.terminate();
      if (message.type === 'error') {
        reject(new Error(message.message));
        return;
      }
      const model = new Model();
      model.load(message.data);
      resolve(model);
    };
    worker.onerror = (event) => {
      progress.close();
      worker.terminate();
      reject(new Error(event.message || 'The import worker failed.'));
    };
    worker.postMessage({ mesh: choice.mesh, drawing: choice.drawing, options: choice.options } satisfies ImportRequest);
  });
}

/** Imports a model file (OBJ with its .mtl, STL, glTF) as a group in the current context. Lossy: only geometry and colours come across. */
async function importObj(files: File[] | null) {
  if (!files) return;
  try {
    const source = await readModelFiles(files);
    if (!source) {
      window.alert('Choose an .obj, .stl, .glb, .gltf or .dxf file (an OBJ may come with its .mtl).');
      return;
    }
    const choice = await askImportOptions(source);
    if (!choice) return;
    const started = performance.now();
    const imported = await buildInWorker(choice);
    if (!imported) {
      ctx.setHint('Import cancelled.');
      return;
    }
    doc.run('Import', () => doc.addGroupFromModel(imported, choice.name));
    navigator.zoomExtents();
    ctx.setHint(`Imported ${choice.name}: ${choice.drawing ? `${imported.edgeCount.toLocaleString()} lines` : `${imported.faceCount.toLocaleString()} faces`} in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } catch (error) {
    ctx.setHint('Import failed.');
    window.alert(`Could not import: ${(error as Error).message}`);
  }
}

/** Exports the whole model, groups flattened, as an OBJ (and a .mtl when anything is painted). */
function exportObjFile() {
  const base = doc.name.replace(/[\\/:*?"<>|]+/g, '-');
  const flat = doc.flatten();
  if (flat.faceCount === 0) {
    ctx.setHint('Nothing to export yet.');
    return;
  }
  const { obj, mtl } = exportObj(flat, base);
  const save = (text: string, name: string) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  save(obj, `${base}.obj`);
  // Browsers may ask before a second download; the .mtl follows after a beat.
  if (mtl) setTimeout(() => save(mtl, `${base}.mtl`), 300);
  ctx.setHint(`Exported ${base}.obj${mtl ? ' and .mtl' : ''}: Y up, metres.`);
}
/** Saves bytes or text as a file download. */
function downloadFile(content: BlobPart, name: string, type: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Exports the whole model as binary STL (millimetres, Z up) for 3D printing, and says whether it is watertight. */
function exportStlFile() {
  const base = doc.name.replace(/[\\/:*?"<>|]+/g, '-');
  const flat = doc.flatten();
  if (flat.faceCount === 0) {
    ctx.setHint('Nothing to export yet.');
    return;
  }
  const result = exportStl(flat, base);
  downloadFile(result.data.slice().buffer, `${base}.stl`, 'model/stl');
  const size = `${formatLength(result.size.x)} × ${formatLength(result.size.y)} × ${formatLength(result.size.z)}`;
  ctx.setHint(
    result.openEdges === 0
      ? `Exported ${base}.stl: ${result.triangles.toLocaleString()} triangles, ${size}, watertight.`
      : `Exported ${base}.stl (${size}), but ${result.openEdges} edges are open: a slicer may refuse it. Close the holes first.`,
  );
}

/**
 * Exports the selected faces (or every face when nothing is selected) flat and at true size, for laser cutting
 * or CNC, as SVG or DXF in millimetres.
 */
function exportFlat(kind: 'svg' | 'dxf') {
  const base = doc.name.replace(/[\\/:*?"<>|]+/g, '-');
  const context = doc.context.model;
  const selected = [...selection.faces].filter((id) => context.hasFace(id));
  const source = selected.length > 0 ? context : doc.flatten();
  const faces = selected.length > 0 ? selected : source.allFaces().map((f) => f.id);
  if (faces.length === 0) {
    ctx.setHint('Nothing to export yet.');
    return;
  }
  const layout = layoutParts(faces.map((id) => flattenFace(source, id)));
  const text = kind === 'svg' ? layoutToSvg(layout) : layoutToDxf(layout);
  downloadFile(text, `${base} - flat.${kind}`, kind === 'svg' ? 'image/svg+xml' : 'application/dxf');
  ctx.setHint(`Exported ${layout.parts.length} flat part${layout.parts.length > 1 ? 's' : ''} at true size (${formatLength(layout.width)} × ${formatLength(layout.height)}), ${kind.toUpperCase()}.`);
}

// The export button opens a small menu.
const exportItems: [string, string, () => void][] = [
  ['STL', '3D printing: STL, in millimetres', exportStlFile],
  ['OBJ', 'Model with colours: OBJ (metres, Y up)', exportObjFile],
  ['SVG', 'Flat parts, true size: SVG (selection, or all faces)', () => exportFlat('svg')],
  ['DXF', 'Flat parts, true size: DXF for laser or CNC', () => exportFlat('dxf')],
];
for (const [, label, action] of exportItems) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.textContent = label;
  item.addEventListener('click', () => {
    shell.exportMenu.hidden = true;
    action();
  });
  shell.exportMenu.append(item);
}
shell.exportDoc.addEventListener('click', (e) => {
  e.stopPropagation();
  shell.exportMenu.hidden = !shell.exportMenu.hidden;
});
document.addEventListener('click', () => (shell.exportMenu.hidden = true));


shell.importDoc.addEventListener('click', async () => importObj(await chooseObjFiles()));
// Dropping an .obj (with its .mtl) on the window imports it too.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
  if (files.some(isModelFile)) void importObj(files);
});

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

viewport.beforeRender = () => {
  doc.setViewer(viewport.rig.camera.position);
  scenesBar.refresh();
};
viewport.rig.setView('iso');
const recovered = restoreAutosave(doc, viewport.rig);
// The villa is the starting model: it opens fresh from code each time, unless there is unsaved work to come back to
// (or another file's recovery copy).
if (recovered.restored && (recovered.unsaved || doc.name !== EXAMPLE_NAME)) afterLoad();
else {
  applyCamera(viewport.rig, loadExample(doc));
  afterLoad();
  viewport.rig.fit(doc.bounds());
  ctx.setHint('This villa is the starting model. Press New for an empty document; your edits to it are kept until you do.');
}
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
  Object.assign(window, { __elevation: { doc, model, viewport, picker, tools, selection, realistic, drawings, loadSample, validate } });
}
