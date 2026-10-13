import { parseGltf, parseStl } from '../io/mesh';
import { guessUnit, meshSize, parseObj, UNITS, type ImportOptions, type ObjMesh } from '../io/obj';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** What the user picked: the mesh, the options, and the file's name without extension. */
export interface ImportChoice {
  mesh: ObjMesh;
  options: ImportOptions;
  name: string;
}

/** A model file ready to import: its mesh and what that format usually means by units and up. */
export interface ImportSource {
  format: 'obj' | 'stl' | 'gltf';
  name: string;
  mesh: ObjMesh;
  /** The usual unit of the format ('m' for glTF, 'mm' for STL), or undefined to guess from the size (OBJ). */
  unit?: string;
  yUp: boolean;
  /** OBJ only: the text (to read a .mtl later) and the .mtl the file names. */
  text?: string;
  mtl?: string;
  mtlName?: string;
}

const MODEL_FILE = /\.(obj|stl|glb|gltf)$/i;

export const isModelFile = (file: File): boolean => MODEL_FILE.test(file.name);

/**
 * Reads a dropped or chosen set of files into an import source: an OBJ (with the .mtl it names, or any .mtl
 * chosen with it), an STL (binary or ASCII), or a glTF (.glb, or .gltf with embedded data). Null when there is none.
 */
export async function readModelFiles(files: File[]): Promise<ImportSource | null> {
  const file = files.find(isModelFile);
  if (!file) return null;
  const extension = /\.(\w+)$/.exec(file.name)![1].toLowerCase();
  const name = file.name.replace(/\.\w+$/, '');
  if (extension === 'stl') return { format: 'stl', name, mesh: parseStl(await file.arrayBuffer()), unit: 'mm', yUp: false };
  if (extension === 'glb' || extension === 'gltf') {
    return { format: 'gltf', name, mesh: parseGltf(extension === 'gltf' ? await file.text() : await file.arrayBuffer()), unit: 'm', yUp: true };
  }
  const text = await file.text();
  const wanted = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
  const mtlFile = files.find((f) => wanted && f.name === wanted) ?? files.find((f) => /\.mtl$/i.test(f.name));
  const mtl = mtlFile ? await mtlFile.text() : undefined;
  return { format: 'obj', name, mesh: parseObj(text, mtl), yUp: true, text, mtl, mtlName: wanted };
}

/** Opens a file chooser for a model file (and optionally an OBJ's .mtl). Resolves to the chosen files, or null. */
export function chooseObjFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.obj,.mtl,.stl,.glb,.gltf';
    input.addEventListener('change', () => resolve(input.files && input.files.length > 0 ? [...input.files] : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Shows the import options for an OBJ: units (guessed from the size), which axis is up, whether to
 * keep colours, whether to recentre. Resolves to the choice, or null when cancelled.
 */
export function askImportOptions(source: ImportSource): Promise<ImportChoice | null> {
  let mesh = source.mesh;
  return new Promise((resolve) => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Import OBJ');
    const finish = (value: ImportChoice | null) => {
      backdrop.remove();
      resolve(value);
    };

    dialog.append(el('h2', undefined, `Import ${source.name}.${source.format === 'gltf' ? 'glb' : source.format}`));
    const summary = el('p', 'dialog-summary');
    dialog.append(summary);

    const row = (label: string, control: HTMLElement) => {
      const r = el('label', 'dialog-row');
      r.append(el('span', undefined, label), control);
      dialog.append(r);
    };
    const units = el('select');
    for (const u of UNITS) {
      const o = el('option', undefined, u.label);
      o.value = u.id;
      units.append(o);
    }
    const up = el('select');
    for (const [value, label] of [['y', 'Y axis (OBJ, glTF)'], ['z', 'Z axis (STL, CAD)']] as const) {
      const o = el('option', undefined, label);
      o.value = value;
      up.append(o);
    }
    const colors = el('input');
    colors.type = 'checkbox';
    colors.checked = true;
    const recenter = el('input');
    recenter.type = 'checkbox';
    row('Units in the file', units);
    row('Up is the', up);
    if (source.format !== 'stl') row('Import colours', colors); // STL carries no materials
    row('Move to the origin, on the ground', recenter);

    const note = el('p', 'dialog-note');
    dialog.append(note);
    const describe = () => {
      const size = meshSize(mesh).map((n) => n * (UNITS.find((u) => u.id === units.value)?.mm ?? 1) / 1000);
      summary.textContent = `${mesh.positions.length.toLocaleString()} vertices · ${mesh.faces.length.toLocaleString()} polygons · about ${size.map((n) => n.toFixed(1)).join(' × ')} m`;
      const missing = source.mtlName && mesh.materials.size === 0;
      note.textContent = missing
        ? `Colours come from ${source.mtlName}, which was not chosen. Pick both files to keep them, or import without. Textures and groups are not imported.`
        : 'Textures, normals and groups are not imported.';
    };
    units.value = source.unit ?? guessUnit(mesh);
    up.value = source.yUp ? 'y' : 'z';
    units.addEventListener('change', describe);
    describe();

    const buttons = el('div', 'dialog-buttons');
    const cancel = el('button', 'pill-button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    // Offered only while the materials the OBJ names are missing.
    const addMtl = el('button', 'pill-button', 'Add .mtl…');
    addMtl.hidden = !(source.format === 'obj' && source.mtlName && mesh.materials.size === 0);
    addMtl.type = 'button';
    addMtl.addEventListener('click', async () => {
      const files = await chooseObjFiles();
      const mtl = files?.find((f) => /\.mtl$/i.test(f.name));
      if (!mtl) return;
      source.mtl = await mtl.text();
      mesh = parseObj(source.text!, source.mtl);
      addMtl.hidden = mesh.materials.size > 0;
      describe();
    });
    const go = el('button', 'pill-button primary', 'Import');
    go.type = 'button';
    go.addEventListener('click', () =>
      finish({
        mesh,
        name: source.name,
        options: { scale: UNITS.find((u) => u.id === units.value)!.mm, yUp: up.value === 'y', colors: colors.checked, recenter: recenter.checked },
      }),
    );
    buttons.append(cancel, addMtl, go);
    dialog.append(buttons);

    backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && finish(null));
    backdrop.addEventListener('keydown', (e) => e.key === 'Escape' && finish(null));
    backdrop.append(dialog);
    document.body.append(backdrop);
    go.focus();
  });
}
