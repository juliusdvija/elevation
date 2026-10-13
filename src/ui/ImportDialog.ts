import { guessUnit, meshSize, parseObj, UNITS, type ImportOptions, type ObjMesh } from '../io/obj';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** What the user picked: the parsed mesh, the options, and the file's name without extension. */
export interface ImportChoice {
  mesh: ObjMesh;
  options: ImportOptions;
  name: string;
}

/** Splits dropped or picked files into the .obj and its .mtl (matched by the file the OBJ names, else any .mtl). */
export async function readObjFiles(files: File[]): Promise<{ text: string; mtl?: string; name: string; mtlName?: string } | null> {
  const obj = files.find((f) => /\.obj$/i.test(f.name));
  if (!obj) return null;
  const text = await obj.text();
  const wanted = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
  const mtlFile = files.find((f) => wanted && f.name === wanted) ?? files.find((f) => /\.mtl$/i.test(f.name));
  return { text, mtl: mtlFile ? await mtlFile.text() : undefined, name: obj.name.replace(/\.obj$/i, ''), mtlName: wanted };
}

/** Opens a file chooser for an .obj (and optionally its .mtl). Resolves to the chosen files, or null. */
export function chooseObjFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.obj,.mtl';
    input.addEventListener('change', () => resolve(input.files && input.files.length > 0 ? [...input.files] : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Shows the import options for an OBJ: units (guessed from the size), which axis is up, whether to
 * keep colours, whether to recentre. Resolves to the choice, or null when cancelled.
 */
export function askImportOptions(source: { text: string; mtl?: string; name: string; mtlName?: string }): Promise<ImportChoice | null> {
  let mesh = parseObj(source.text, source.mtl);
  return new Promise((resolve) => {
    const backdrop = el('div', 'dialog-backdrop');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Import OBJ');
    const finish = (value: ImportChoice | null) => {
      backdrop.remove();
      resolve(value);
    };

    dialog.append(el('h2', undefined, `Import ${source.name}.obj`));
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
    for (const [value, label] of [['y', 'Y axis (most OBJ files)'], ['z', 'Z axis']] as const) {
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
    row('Import colours', colors);
    row('Move to the origin, on the ground', recenter);

    const note = el('p', 'dialog-note');
    dialog.append(note);
    const describe = () => {
      const size = meshSize(mesh).map((n) => n * (UNITS.find((u) => u.id === units.value)?.mm ?? 1) / 1000);
      summary.textContent = `${mesh.positions.length.toLocaleString()} vertices · ${mesh.faces.length.toLocaleString()} polygons · about ${size.map((n) => n.toFixed(1)).join(' × ')} m`;
      const missing = source.mtlName && mesh.materials.size === 0;
      note.textContent = missing
        ? `Colours come from ${source.mtlName}, which was not chosen. Pick both files to keep them, or import without. Textures, transparency and groups are not imported.`
        : 'Textures, transparency, normals and groups are not imported.';
    };
    units.value = guessUnit(mesh);
    units.addEventListener('change', describe);
    describe();

    const buttons = el('div', 'dialog-buttons');
    const cancel = el('button', 'pill-button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    // Offered only while the materials the OBJ names are missing.
    const addMtl = el('button', 'pill-button', 'Add .mtl…');
    addMtl.hidden = !(source.mtlName && mesh.materials.size === 0);
    addMtl.type = 'button';
    addMtl.addEventListener('click', async () => {
      const files = await chooseObjFiles();
      const mtl = files?.find((f) => /\.mtl$/i.test(f.name));
      if (!mtl) return;
      source.mtl = await mtl.text();
      mesh = parseObj(source.text, source.mtl);
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
