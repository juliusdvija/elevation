import * as THREE from 'three';
import { formatArea, formatLength, formatNumber, formatVolume, parseLength, UNIT_INFO, displaySettings } from '../core/units';
import type { Document } from '../document';
import { areaOf, edgeLength, enclosedVolume, entityBounds, facePerimeter } from '../kernel/measure';
import { transformVertices } from '../kernel/transform';
import type { Selection } from '../tools/Selection';
import { moveTargets, scaleTargets, selectedTargets } from '../tools/selectionOps';
import type { ToolContext } from '../tools/Tool';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * A card over the viewport with the numbers of the selection: how long, how much area, how much volume, how big and where,
 * and for size, position and an edge's length, a field you can type into to set it exactly.
 */
export class InfoPanel {
  readonly el = el('aside', 'info-panel');

  constructor(
    private readonly ctx: ToolContext,
    private readonly doc: Document,
    private readonly selection: Selection,
  ) {
    this.el.hidden = true;
    selection.changed.on(() => this.render());
    doc.geometryChanged.on(() => this.render());
    doc.contextChanged.on(() => this.render());
    this.render();
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (visible) this.render();
  }

  get isVisible(): boolean {
    return !this.el.hidden;
  }

  /** The selection's box in world space, with the volume when it is a closed solid. */
  private measure(): { bounds: THREE.Box3; volume: number | null; area: number; faces: number; edges: number; instances: number } {
    const { faces, edges, instances } = this.selection;
    const placement = this.doc.context;
    const model = placement.model;
    const bounds = entityBounds(model, faces, edges, placement.matrix);
    let volume: number | null = null;
    let totalVolume = 0;
    let anyVolume = false;
    for (const id of instances) {
      if (!model.hasInstance(id)) continue;
      const stats = this.doc.instanceStats(id);
      bounds.union(stats.bounds);
      if (stats.volume !== null) {
        totalVolume += stats.volume;
        anyVolume = true;
      }
    }
    if (anyVolume) volume = totalVolume;
    else if (faces.size > 0) {
      const enclosed = enclosedVolume(model, faces);
      volume = enclosed === null ? null : enclosed * Math.abs(placement.matrix.determinant());
    }
    const scale = Math.pow(Math.abs(placement.matrix.determinant()), 2 / 3);
    let area = 0;
    for (const id of faces) if (model.hasFace(id)) area += areaOf(model, id) * scale;
    return { bounds, volume, area, faces: faces.size, edges: edges.size, instances: instances.size };
  }

  private render(): void {
    if (this.el.hidden) return;
    this.el.replaceChildren();
    const { faces, edges, instances } = this.selection;
    const model = this.doc.context.model;
    this.el.append(el('h3', undefined, 'Info'));

    if (this.selection.empty) {
      const flat = this.doc.flatten();
      this.el.append(el('p', 'info-note', 'Select something to see its numbers.'));
      if (flat.faceCount > 0) this.rows([['Model', `${flat.faceCount.toLocaleString()} faces`], ...this.sizeRow(flat.bounds())]);
      return;
    }

    const m = this.measure();
    const parts = [m.faces && `${m.faces} face${m.faces > 1 ? 's' : ''}`, m.edges && `${m.edges} edge${m.edges > 1 ? 's' : ''}`, m.instances && `${m.instances} group${m.instances > 1 ? 's' : ''}`].filter(Boolean);
    this.el.append(el('p', 'info-note', parts.join(' · ')));

    // One edge: its length can be typed.
    if (edges.size === 1 && faces.size === 0 && instances.size === 0) {
      const id = [...edges][0];
      if (model.hasEdge(id)) {
        const length = edgeLength(model, id) * Math.cbrt(Math.abs(this.doc.context.matrix.determinant()));
        this.field('Length', length, (value) => this.setEdgeLength(id, value));
      }
    }
    if (faces.size === 1 && edges.size === 0 && instances.size === 0) {
      const id = [...faces][0];
      if (model.hasFace(id)) this.rows([['Perimeter', formatLength(facePerimeter(model, id) * Math.cbrt(Math.abs(this.doc.context.matrix.determinant())))]]);
    }
    const rows: [string, string][] = [];
    if (m.faces > 0) rows.push(['Area', formatArea(m.area)]);
    if (m.volume !== null) rows.push(['Volume', formatVolume(m.volume)]);
    this.rows(rows);

    if (!m.bounds.isEmpty()) {
      const size = m.bounds.getSize(new THREE.Vector3());
      const axes = ['X', 'Y', 'Z'] as const;
      axes.forEach((axis, i) => this.field(`Size ${axis}`, size.getComponent(i), (value) => this.setSize(i, value), size.getComponent(i) < 1e-6));
      axes.forEach((axis, i) => this.field(`At ${axis}`, m.bounds.min.getComponent(i), (value) => this.moveTo(i, value)));
    }
  }

  private sizeRow(bounds: THREE.Box3): [string, string][] {
    if (bounds.isEmpty()) return [];
    const s = bounds.getSize(new THREE.Vector3());
    return [['Size', `${formatNumber(s.x)} × ${formatNumber(s.y)} × ${formatNumber(s.z)} ${UNIT_INFO[displaySettings().unit].suffix}`]];
  }

  private rows(rows: [string, string][]): void {
    for (const [label, value] of rows) {
      const row = el('div', 'info-row');
      row.append(el('span', undefined, label), el('b', undefined, value));
      this.el.append(row);
    }
  }

  /** A row with a typed number: Enter applies it. */
  private field(label: string, mm: number, apply: (mm: number) => void, disabled = false): void {
    const row = el('label', 'info-row');
    const input = el('input');
    input.value = formatNumber(mm);
    input.disabled = disabled;
    input.spellcheck = false;
    input.inputMode = 'decimal';
    input.title = `Type a length and press Enter (${UNIT_INFO[displaySettings().unit].suffix} unless you add a unit)`;
    const commit = () => {
      const value = parseLength(input.value);
      if (value === null || Math.abs(value - mm) < 1e-9) {
        input.value = formatNumber(mm);
        return;
      }
      apply(value);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here must not trigger tool shortcuts
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = formatNumber(mm);
        input.blur();
      }
    });
    input.addEventListener('change', commit);
    row.append(el('span', undefined, label), input, el('em', undefined, UNIT_INFO[displaySettings().unit].suffix));
    this.el.append(row);
  }

  /** Resizes the selection along one world axis by scaling about the corner of its box. */
  private setSize(axis: number, mm: number): void {
    if (mm <= 0) return;
    const bounds = this.measure().bounds;
    const old = bounds.getSize(new THREE.Vector3()).getComponent(axis);
    if (old < 1e-9) return;
    const factors = new THREE.Vector3(1, 1, 1);
    factors.setComponent(axis, mm / old);
    this.doc.run('Resize', () => scaleTargets(this.ctx, selectedTargets(this.ctx), bounds.min.clone(), factors));
  }

  /** Moves the selection so the corner of its box is at a coordinate. */
  private moveTo(axis: number, mm: number): void {
    const bounds = this.measure().bounds;
    const delta = new THREE.Vector3();
    delta.setComponent(axis, mm - bounds.min.getComponent(axis));
    this.doc.run('Move', () => moveTargets(this.ctx, selectedTargets(this.ctx), delta));
  }

  /** Stretches an edge to a length by moving its far end along its direction (what is attached follows). */
  private setEdgeLength(id: number, mm: number): void {
    if (mm <= 0) return;
    const placement = this.doc.context;
    const model = placement.model;
    if (!model.hasEdge(id)) return;
    const edge = model.edge(id);
    const a = model.position(edge.a);
    const b = model.position(edge.b);
    const worldScale = Math.cbrt(Math.abs(placement.matrix.determinant()));
    const current = a.distanceTo(b) * worldScale;
    if (current < 1e-9) return;
    const shift = b.clone().sub(a).normalize().multiplyScalar((mm - current) / worldScale);
    this.doc.run('Set Length', () => transformVertices(model, [edge.b], new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z)));
  }
}
