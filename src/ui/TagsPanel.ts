import { Eye, EyeOff, Plus, X, createElement } from 'lucide';
import type { Document } from '../document';
import type { Tag } from '../drawing/settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The next free tag id and a default name. */
export function nextTag(tags: readonly Tag[]): Tag {
  let n = tags.length + 1;
  const ids = new Set(tags.map((t) => t.id));
  while (ids.has(`tag-${n}`)) n++;
  return { id: `tag-${n}`, name: `Tag ${n}`, visible: true };
}

/**
 * A small panel over the viewport listing the tags: show or hide each one (the instances on it follow),
 * rename, delete, add. Showing and hiding is a view state (scenes remember it); the rest is undoable.
 */
export class TagsPanel {
  readonly el = el('div', 'tags-panel');

  constructor(private readonly doc: Document) {
    this.el.hidden = true;
    doc.settingsChanged.on(() => this.render());
    doc.geometryChanged.on(() => this.counts());
    this.render();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  /** How many instances (anywhere) carry each tag. */
  private usage(): Map<string, number> {
    const used = new Map<string, number>();
    for (const model of this.doc.allModels()) for (const i of model.allInstances()) if (i.tag) used.set(i.tag, (used.get(i.tag) ?? 0) + 1);
    return used;
  }

  private counts(): void {
    if (this.el.hidden) return;
    const used = this.usage();
    for (const label of this.el.querySelectorAll<HTMLElement>('[data-count]')) label.textContent = String(used.get(label.dataset.count!) ?? 0);
  }

  private commit(label: string, change: (tags: Tag[]) => void): void {
    const next = structuredClone(this.doc.drawingSettings);
    change(next.tags);
    this.doc.updateDrawingSettings(label, next);
  }

  private render(): void {
    this.el.replaceChildren();
    this.el.append(el('h3', undefined, 'Tags'));
    const tags = this.doc.drawingSettings.tags;
    const used = this.usage();
    if (tags.length === 0) {
      this.el.append(el('p', 'tags-empty', 'Select a group or component and choose a tag for it. Hide a tag to hide everything on it.'));
    }
    for (const tag of tags) {
      const row = el('div', 'tag-row');
      const eye = el('button', 'icon-button');
      eye.type = 'button';
      eye.title = tag.visible ? 'Hide this tag' : 'Show this tag';
      eye.setAttribute('aria-pressed', String(!tag.visible));
      eye.append(createElement(tag.visible ? Eye : EyeOff, { width: 16, height: 16, 'stroke-width': 1.75 }));
      eye.addEventListener('click', () => {
        const hidden = this.doc.hiddenTags();
        if (tag.visible) hidden.add(tag.id);
        else hidden.delete(tag.id);
        this.doc.setHiddenTags(hidden);
      });
      const name = el('input', 'tag-name');
      name.value = tag.name;
      name.spellcheck = false;
      name.dataset.hiddenTag = String(!tag.visible);
      name.addEventListener('change', () => this.commit('Rename Tag', (t) => (t.find((x) => x.id === tag.id)!.name = name.value.trim() || tag.name)));
      name.addEventListener('keydown', (e) => {
        e.stopPropagation(); // typing a name must not trigger tool shortcuts
        if (e.key === 'Enter' || e.key === 'Escape') name.blur();
      });
      const count = el('span', 'tag-count', String(used.get(tag.id) ?? 0));
      count.dataset.count = tag.id;
      count.title = 'Groups and components on this tag';
      const remove = el('button', 'icon-button');
      remove.type = 'button';
      remove.title = 'Delete this tag (what is on it becomes untagged)';
      remove.append(createElement(X, { width: 14, height: 14, 'stroke-width': 1.75 }));
      remove.addEventListener('click', () => this.removeTag(tag.id));
      row.append(eye, name, count, remove);
      this.el.append(row);
    }
    const add = el('button', 'pill-button');
    add.type = 'button';
    add.append(createElement(Plus, { width: 14, height: 14 }), ' Tag');
    add.addEventListener('click', () => this.commit('Add Tag', (t) => t.push(nextTag(t))));
    this.el.append(add);
  }

  /** Deletes a tag and clears it from every instance, as one undo step. */
  private removeTag(id: string): void {
    const next = structuredClone(this.doc.drawingSettings);
    next.tags = next.tags.filter((t) => t.id !== id);
    this.doc.run('Delete Tag', () => {
      for (const model of this.doc.allModels()) for (const i of model.allInstances()) if (i.tag === id) model.setInstanceTag(i.id, undefined);
    });
    this.doc.updateDrawingSettings('Delete Tag', next);
  }
}
