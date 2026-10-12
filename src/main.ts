import './ui/style.css';
import { History } from './core/history';
import { Viewport } from './viewport/Viewport';
import { createDemoMassing } from './viewport/demo';
import { Navigator } from './tools/Navigator';
import { ToolManager } from './tools/ToolManager';
import { createOrbitTool, createPanTool, createSelectTool } from './tools/navigationTools';
import type { ToolContext } from './tools/Tool';
import { buildShell } from './ui/shell';

const toolInfo = [
  { id: 'select', label: 'Select', shortcut: 'Space' },
  { id: 'orbit', label: 'Orbit', shortcut: 'O' },
  { id: 'pan', label: 'Pan', shortcut: 'H' },
];

const shell = buildShell(document.getElementById('app')!, toolInfo);
const viewport = new Viewport(shell.viewport);
const history = new History();
const navigator = new Navigator(viewport);

const ctx: ToolContext = {
  viewport,
  navigator,
  history,
  setHint: (text) => (shell.hint.textContent = text),
};

const tools = new ToolManager(ctx);
tools.register(createSelectTool());
tools.register(createOrbitTool(ctx));
tools.register(createPanTool(ctx));

tools.changed.on((tool) => {
  for (const [id, button] of shell.toolButtons) button.setAttribute('aria-pressed', String(id === tool.id));
});
for (const [id, button] of shell.toolButtons) button.addEventListener('click', () => tools.activate(id));
tools.activate('select');

// Camera
for (const [view, button] of shell.viewButtons) {
  button.addEventListener('click', () => {
    viewport.rig.setView(view);
    viewport.requestRender();
  });
}

function toggleProjection() {
  viewport.rig.toggleProjection();
  shell.projection.textContent = viewport.rig.isOrtho ? 'Parallel' : 'Perspective';
  viewport.requestRender();
}
shell.projection.addEventListener('click', toggleProjection);
shell.zoomExtents.addEventListener('click', () => navigator.zoomExtents());

// History
function syncHistory() {
  shell.undo.disabled = !history.canUndo;
  shell.redo.disabled = !history.canRedo;
  shell.undo.title = history.undoLabel ? `Undo ${history.undoLabel} (⌘Z)` : 'Undo (⌘Z)';
  shell.redo.title = history.redoLabel ? `Redo ${history.redoLabel} (⇧⌘Z)` : 'Redo (⇧⌘Z)';
}
history.changed.on(() => {
  syncHistory();
  viewport.requestRender();
});
shell.undo.addEventListener('click', () => history.undo());
shell.redo.addEventListener('click', () => history.redo());
syncHistory();

// Keyboard
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, [contenteditable]')) return;

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    history.redo();
  } else if (e.shiftKey && !mod && e.key.toLowerCase() === 'z') {
    navigator.zoomExtents();
  } else if (!mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
    toggleProjection();
  } else if (tools.keyDown(e)) {
    e.preventDefault();
  }
});

// Temporary until the modelling kernel exists.
viewport.content.add(createDemoMassing());
viewport.rig.setView('iso');
navigator.zoomExtents();
