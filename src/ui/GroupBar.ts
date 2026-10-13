import type { Document } from '../document';
import type { Selection } from '../tools/Selection';
import { nextTag } from './TagsPanel';

function button(text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill-button';
  b.textContent = text;
  b.title = title;
  return b;
}

export interface GroupCommands {
  makeGroup(kind: 'group' | 'component'): void;
  explode(): void;
  edit(): void;
  /** Combine the two selected groups (the first selected is the one kept in a subtraction). */
  combine(op: 'union' | 'subtract' | 'intersect'): void;
}

/**
 * Floating controls over the viewport: a breadcrumb while editing inside a
 * group, and group actions for the current selection.
 */
export class GroupBar {
  private readonly crumbs = document.createElement('nav');
  private readonly actions = document.createElement('div');

  constructor(
    container: HTMLElement,
    private readonly doc: Document,
    private readonly selection: Selection,
    private readonly commands: GroupCommands,
  ) {
    this.crumbs.className = 'crumbs';
    this.actions.className = 'group-actions';
    container.append(this.crumbs, this.actions);
    doc.contextChanged.on(() => this.render());
    doc.geometryChanged.on(() => this.render());
    doc.namesChanged.on(() => this.render());
    selection.changed.on(() => this.render());
    this.render();
  }

  private render(): void {
    this.renderCrumbs();
    this.renderActions();
  }

  private renderCrumbs(): void {
    const path = this.doc.context.path;
    this.crumbs.replaceChildren();
    this.crumbs.hidden = path.length === 0;
    if (path.length === 0) return;
    const names = ['Model'];
    let model = this.doc.model;
    for (const id of path) {
      const def = this.doc.definition(model.instance(id).definition);
      names.push(def.name);
      model = def.model;
    }
    names.forEach((name, i) => {
      if (i > 0) this.crumbs.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '›' }));
      if (i < names.length - 1) {
        const link = button(name, `Back to ${name}`);
        link.classList.add('crumb');
        link.addEventListener('click', () => {
          this.selection.clear();
          this.doc.setContext(path.slice(0, i));
        });
        this.crumbs.append(link);
      } else {
        this.crumbs.append(Object.assign(document.createElement('strong'), { textContent: name }));
      }
    });
    const close = button('Close', 'Close group (Esc)');
    close.addEventListener('click', () => {
      this.selection.clear();
      this.doc.exit();
    });
    this.crumbs.append(close);
  }

  /** A selector for the tag of the selected groups and components (blank when they differ). */
  private tagSelect(): HTMLSelectElement {
    const model = this.doc.context.model;
    const ids = [...this.selection.instances].filter((id) => model.hasInstance(id));
    const tags = new Set(ids.map((id) => model.instance(id).tag ?? ''));
    const select = document.createElement('select');
    select.className = 'tag-select';
    select.title = 'Tag: hide or show it with others in the Tags panel';
    const option = (value: string, label: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      select.append(o);
    };
    if (tags.size > 1) option('__mixed', 'Mixed tags');
    option('', 'Untagged');
    for (const t of this.doc.drawingSettings.tags) option(t.id, t.name);
    option('__new', 'New tag…');
    select.value = tags.size > 1 ? '__mixed' : [...tags][0] ?? '';
    select.addEventListener('change', () => {
      if (select.value === '__mixed') return;
      let id = select.value;
      if (id === '__new') {
        const tag = nextTag(this.doc.drawingSettings.tags);
        this.doc.updateDrawingSettings('Add Tag', { ...structuredClone(this.doc.drawingSettings), tags: [...this.doc.drawingSettings.tags, tag] });
        id = tag.id;
      }
      this.doc.run('Set Tag', () => {
        for (const i of ids) model.setInstanceTag(i, id || undefined);
      });
    });
    return select;
  }

  private renderActions(): void {
    this.actions.replaceChildren();
    const { faces, edges, instances } = this.selection;
    this.actions.hidden = this.selection.empty;
    if (this.selection.empty) return;

    const single = instances.size === 1 && faces.size === 0 && edges.size === 0;
    if (single) {
      const [id] = instances;
      const model = this.doc.context.model;
      if (model.hasInstance(id)) {
        const def = this.doc.definition(model.instance(id).definition);
        const shared = def.kind === 'component' ? ` · ${this.doc.instanceCount(def.id)} in model` : '';
        const name = Object.assign(document.createElement('input'), { className: 'name-input', value: def.name, title: 'Rename', spellcheck: false });
        name.size = Math.max(6, def.name.length);
        name.addEventListener('change', () => this.doc.renameDefinition(def.id, name.value));
        name.addEventListener('keydown', (e) => {
          e.stopPropagation(); // typing a name must not trigger tool shortcuts
          if (e.key === 'Enter' || e.key === 'Escape') name.blur();
        });
        this.actions.append(name, Object.assign(document.createElement('span'), { className: 'label', textContent: shared.replace(' · ', '') }));
      }
      const edit = button('Edit', 'Edit inside (double-click)');
      edit.addEventListener('click', () => this.commands.edit());
      const explode = button('Explode', 'Turn back into loose geometry');
      explode.addEventListener('click', () => this.commands.explode());
      this.actions.append(edit, explode);
    }
    if (instances.size > 0) this.actions.append(this.tagSelect());
    if (instances.size === 2 && faces.size === 0 && edges.size === 0) {
      for (const [op, label, title] of [
        ['union', 'Union', 'Join the two into one solid'],
        ['subtract', 'Subtract', 'Cut the second selected out of the first selected'],
        ['intersect', 'Intersect', 'Keep only where the two overlap'],
      ] as const) {
        const b = button(label, title);
        b.addEventListener('click', () => this.commands.combine(op));
        this.actions.append(b);
      }
    }
    const group = button('Make Group', 'Make Group (⌘G)');
    group.addEventListener('click', () => this.commands.makeGroup('group'));
    const component = button('Make Component', 'Make Component (⇧⌘G): copies stay linked');
    component.addEventListener('click', () => this.commands.makeGroup('component'));
    this.actions.append(group, component);
  }
}
