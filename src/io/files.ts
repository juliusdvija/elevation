import type { Document } from '../document';
import type { CameraRig } from '../viewport/CameraRig';
import * as THREE from 'three';
import { parse, serialize, toFile, type CameraData, type ElevationFile } from './format';

const EXTENSION = '.elev';
const PICKER_TYPES = [{ description: 'Elevation model', accept: { 'application/json': [EXTENSION] } }];

interface FilePickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
}
const pickers = window as unknown as FilePickerWindow;

function baseName(fileName: string): string {
  return fileName.replace(/\.(elev|json)$/i, '');
}

export function cameraData(rig: CameraRig): CameraData {
  return {
    position: rig.position.toArray() as [number, number, number],
    target: rig.target.toArray() as [number, number, number],
    ortho: rig.isOrtho,
    orthoHeight: rig.orthoHeight,
  };
}

export function applyCamera(rig: CameraRig, camera: CameraData | undefined): void {
  if (!camera) return;
  rig.position.copy(new THREE.Vector3(...camera.position));
  rig.target.copy(new THREE.Vector3(...camera.target));
  rig.orthoHeight = camera.orthoHeight;
  if (rig.isOrtho !== camera.ortho) rig.toggleProjection();
  rig.update();
}

function contents(doc: Document, rig: CameraRig): string {
  return serialize(toFile(doc.model.toData(), cameraData(rig), doc.definitionsInUse(), doc.drawingSettings));
}

/**
 * Saves the document: back to its file when the browser allows it,
 * otherwise through a save dialog (or a download as a last resort).
 * Returns false when the user cancelled.
 */
export async function saveDocument(doc: Document, rig: CameraRig, options: { saveAs?: boolean } = {}): Promise<boolean> {
  const text = contents(doc, rig);
  let handle = options.saveAs ? null : doc.fileHandle;

  if (!handle && pickers.showSaveFilePicker) {
    try {
      handle = await pickers.showSaveFilePicker({ suggestedName: `${doc.name}${EXTENSION}`, types: PICKER_TYPES });
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return false;
      throw error;
    }
  }

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    doc.markSaved(baseName(handle.name), handle);
    return true;
  }

  // No file system access: download a copy.
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = `${doc.name}${EXTENSION}`;
  link.click();
  URL.revokeObjectURL(link.href);
  doc.markSaved(doc.name, null);
  return true;
}

/** Lets the user pick an .elev file. Resolves null when cancelled. */
async function pickFile(): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
  if (pickers.showOpenFilePicker) {
    try {
      const [handle] = await pickers.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      return { file: await handle.getFile(), handle };
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return null;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${EXTENSION},application/json`;
    input.addEventListener('change', () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Opens a file into the document. Returns the parsed file, or null when cancelled. Throws on a bad file. */
export async function openDocument(doc: Document, rig: CameraRig): Promise<ElevationFile | null> {
  const picked = await pickFile();
  if (!picked) return null;
  const file = parse(await picked.file.text());
  doc.load(file.model, baseName(picked.file.name), picked.handle, { definitions: file.definitions, drawing: file.drawing });
  applyCamera(rig, file.camera);
  return file;
}
