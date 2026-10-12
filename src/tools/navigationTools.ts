import type { Tool, ToolContext } from './Tool';

export function createSelectTool(): Tool {
  return {
    id: 'select',
    label: 'Select',
    shortcut: 'Space',
    hint: 'Select objects. Middle-drag to orbit, Shift + middle-drag to pan, scroll to zoom.',
    cursor: 'default',
  };
}

export function createOrbitTool(ctx: ToolContext): Tool {
  return {
    id: 'orbit',
    label: 'Orbit',
    shortcut: 'O',
    hint: 'Drag to orbit around the point under the cursor. Hold Shift to pan.',
    cursor: 'grab',
    pointerDown: (e) => ctx.navigator.begin(e.shiftKey ? 'pan' : 'orbit', e),
    pointerMove: (e) => {
      ctx.navigator.setMode(e.shiftKey ? 'pan' : 'orbit');
      ctx.navigator.move(e);
    },
    pointerUp: () => ctx.navigator.end(),
  };
}

export function createPanTool(ctx: ToolContext): Tool {
  return {
    id: 'pan',
    label: 'Pan',
    shortcut: 'H',
    hint: 'Drag to pan the view.',
    cursor: 'move',
    pointerDown: (e) => ctx.navigator.begin('pan', e),
    pointerMove: (e) => ctx.navigator.move(e),
    pointerUp: () => ctx.navigator.end(),
  };
}
