import type { Document } from '../document';
import type { CameraRig } from '../viewport/CameraRig';
import { applyCamera, cameraData } from './files';
import { parse, serialize, toFile } from './format';

const KEY = 'elevation.recovery';
const DELAY = 800; // ms after the last change

/**
 * Keeps a recovery copy of the current document in this browser, so a reload
 * does not lose work. It is a safety net, not the saved file.
 */
export function startAutosave(doc: Document, rig: CameraRig): void {
  let timer = 0;
  const write = () => {
    try {
      if (doc.model.vertexCount === 0 && !doc.fileHandle) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ name: doc.name, dirty: doc.dirty, file: serialize(toFile(doc.model.toData(), cameraData(rig), doc.definitionsInUse())) }));
    } catch {
      // Storage full or unavailable: the recovery copy is best effort.
    }
  };
  doc.geometryChanged.on(() => {
    clearTimeout(timer);
    timer = window.setTimeout(write, DELAY);
  });
  doc.changed.on(() => {
    clearTimeout(timer);
    timer = window.setTimeout(write, DELAY);
  });
  window.addEventListener('pagehide', write);
}

/** Restores the recovery copy, if any. Returns whether it held unsaved work. */
export function restoreAutosave(doc: Document, rig: CameraRig): { restored: boolean; unsaved: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { restored: false, unsaved: false };
    const saved = JSON.parse(raw) as { name: string; dirty: boolean; file: string };
    const file = parse(saved.file);
    doc.load(file.model, saved.name, null, { unsaved: saved.dirty, definitions: file.definitions });
    applyCamera(rig, file.camera);
    return { restored: true, unsaved: saved.dirty };
  } catch {
    return { restored: false, unsaved: false };
  }
}
