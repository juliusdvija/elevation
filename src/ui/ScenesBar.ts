import { Plus, X, createElement } from 'lucide';
import type { Document } from '../document';
import type { CameraData } from '../io/format';
import { nextScene } from '../drawing/layout';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Whether two cameras are (nearly) the same view, to show which scene is current. */
function sameView(a: CameraData, b: CameraData): boolean {
  const close = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) < 1);
  return a.ortho === b.ortho && close(a.position, b.position) && close(a.target, b.target) && Math.abs(a.orthoHeight - b.orthoHeight) < 1;
}

/**
 * A strip over the bottom of the 3D view: saved views ("scenes") as chips. Click one to fly the camera
 * there, double-click to rename, × to delete, + to save where the camera is now. Scenes live in the
 * drawing settings, so they are saved with the file, undoable, and can be put on sheets.
 */
export class ScenesBar {
  readonly el = el('div', 'scenes-bar');

  constructor(
    private readonly doc: Document,
    private readonly port: { camera(): CameraData; flyTo(camera: CameraData): void },
  ) {
    doc.settingsChanged.on(() => this.render());
    this.render();
  }

  /** Re-marks the current scene (call after the camera moved). */
  refresh(): void {
    const camera = this.port.camera();
    for (const chip of this.el.querySelectorAll<HTMLElement>('.scene-chip')) {
      const scene = this.doc.drawingSettings.scenes.find((s) => s.id === chip.dataset.scene);
      chip.setAttribute('aria-pressed', String(!!scene && sameView(scene.camera, camera)));
    }
  }

  private render(): void {
    this.el.replaceChildren();
    for (const scene of this.doc.drawingSettings.scenes) {
      const chip = el('div', 'scene-chip');
      chip.dataset.scene = scene.id;
      const name = el('button', 'scene-name', scene.name);
      name.type = 'button';
      name.title = 'Go to this view (double-click to rename)';
      name.addEventListener('click', () => this.port.flyTo(scene.camera));
      name.addEventListener('dblclick', () => this.rename(scene.id, chip, scene.name));
      const remove = el('button', 'scene-remove');
      remove.type = 'button';
      remove.title = 'Delete this view';
      remove.setAttribute('aria-label', `Delete ${scene.name}`);
      remove.append(createElement(X, { width: 12, height: 12, 'stroke-width': 2 }));
      remove.addEventListener('click', () => this.commit('Delete View', (n) => (n.scenes = n.scenes.filter((s) => s.id !== scene.id))));
      chip.append(name, remove);
      this.el.append(chip);
    }
    const add = el('button', 'scene-add');
    add.type = 'button';
    add.title = 'Save the current view';
    add.append(createElement(Plus, { width: 14, height: 14, 'stroke-width': 2 }), ' View');
    add.addEventListener('click', () => {
      const scene = nextScene(this.doc.drawingSettings.scenes, this.port.camera());
      this.commit('Save View', (n) => n.scenes.push(scene));
    });
    this.el.append(add);
    this.refresh();
  }

  private rename(id: string, chip: HTMLElement, current: string): void {
    const input = el('input', 'scene-rename');
    input.value = current;
    const finish = (save: boolean) => {
      const name = input.value.trim();
      if (save && name && name !== current) this.commit('Rename View', (n) => {
        const target = n.scenes.find((s) => s.id === id);
        if (target) target.name = name;
      });
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    chip.replaceChildren(input);
    input.focus();
    input.select();
  }

  private commit(label: string, change: (settings: Document['drawingSettings']) => void): void {
    const next = structuredClone(this.doc.drawingSettings);
    change(next);
    this.doc.updateDrawingSettings(label, next);
  }
}
