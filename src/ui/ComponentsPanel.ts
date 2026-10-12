import type { Document } from '../document';
import type { Selection } from '../tools/Selection';

/**
 * A floating list of the groups and components in the document: rename them,
 * see how many copies each has, and select every copy in the open context.
 */
export class ComponentsPanel {
  readonly el = document.createElement('aside');
  private readonly list = document.createElement('div');

  constructor(
    container: HTMLElement,
    private readonly doc: Document,
    private readonly selection: Selection,
  ) {
    this.el.className = 'components-panel';
    this.el.hidden = true;
    const title = document.createElement('div');
    title.className = 'components-title';
    title.textContent = 'Components';
    this.list.className = 'components-list';
    this.el.append(title, this.list);
    container.append(this.el);
    doc.geometryChanged.on(() => this.render());
    doc.namesChanged.on(() => this.renderNamesOnly());
    doc.contextChanged.on(() => this.render());
    this.render();
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (visible) this.render();
  }

  /** Definitions in use, components first. */
  private entries() {
    return [...this.doc.definitions.values()]
      .map((def) => ({ def, count: this.doc.instanceCount(def.id) }))
      .filter((e) => e.count > 0)
      .sort((a, b) => Number(b.def.kind === 'component') - Number(a.def.kind === 'component') || a.def.name.localeCompare(b.def.name));
  }

  private renderNamesOnly(): void {
    // Not while the user is typing a name in this list.
    if (!this.el.contains(document.activeElement)) this.render();
  }

  private render(): void {
    if (this.el.hidden) return;
    // Keep an input being edited rather than rebuilding it under the cursor.
    if (this.el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    this.list.replaceChildren();
    const entries = this.entries();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'components-empty';
      empty.textContent = 'No groups or components yet. Select geometry and choose Make Component.';
      this.list.append(empty);
      return;
    }
    for (const { def, count } of entries) {
      const row = document.createElement('div');
      row.className = 'components-row';

      const kind = document.createElement('span');
      kind.className = 'components-kind';
      kind.textContent = def.kind === 'component' ? 'C' : 'G';
      kind.title = def.kind === 'component' ? 'Component: copies stay linked' : 'Group';

      const name = Object.assign(document.createElement('input'), { className: 'name-input', value: def.name, spellcheck: false, title: 'Rename' });
      name.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') name.blur();
      });
      name.addEventListener('change', () => this.doc.renameDefinition(def.id, name.value));
      name.addEventListener('blur', () => this.render());

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'pill-button';
      select.textContent = `${count}×`;
      select.title = 'Select every copy in the model you are editing';
      select.addEventListener('click', () => {
        const model = this.doc.context.model;
        this.selection.clear();
        for (const i of model.allInstances()) if (i.definition === def.id) this.selection.add({ kind: 'instance', id: i.id });
      });

      row.append(kind, name, select);
      this.list.append(row);
    }
  }
}
