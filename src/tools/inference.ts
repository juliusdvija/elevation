import * as THREE from 'three';
import { theme } from '../viewport/theme';
import type { Pick, Picker } from './Picker';
import type { Viewport } from '../viewport/Viewport';
import type { Model } from '../kernel/Model';
import type { SnapKind } from './overlay';
import { alignmentInPlane, closestOnLineToRay, intersectLines, projectOnLine, type Line3 } from './lines';

export interface GuideSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color?: number;
}

export interface InferredPoint {
  point: THREE.Vector3;
  kind: SnapKind;
  pick: Pick;
  /** Overrides the default label for `kind`. */
  label?: string;
  /** Set when the point is constrained to a direction from the start point. */
  direction?: THREE.Vector3;
  /** Dotted feedback lines to draw. */
  guides: GuideSegment[];
  /** Reference edge to highlight (parallel/perpendicular inference). */
  reference?: [THREE.Vector3, THREE.Vector3];
}

const PARALLEL_COLOR = 0xc13fc1;
const DIRECTION_RADIUS = 12; // px
const ALIGN_RADIUS = 8; // px
const MIN_DRAG = 16; // px from the start point before directions kick in
const MAX_POINTS = 4;

const AXES: { kind: SnapKind; dir: THREE.Vector3; color: number; arrow: string }[] = [
  { kind: 'axis-x', dir: new THREE.Vector3(1, 0, 0), color: theme.axisX, arrow: 'ArrowRight' },
  { kind: 'axis-y', dir: new THREE.Vector3(0, 1, 0), color: theme.axisY, arrow: 'ArrowLeft' },
  { kind: 'axis-z', dir: new THREE.Vector3(0, 0, 1), color: theme.axisZ, arrow: 'ArrowUp' },
];

const SNAP_KINDS = new Set<Pick['kind']>(['vertex', 'guide-point', 'intersection', 'midpoint', 'edge', 'guide']);

export function kindColor(kind: SnapKind): number | undefined {
  if (kind === 'parallel' || kind === 'perpendicular') return PARALLEL_COLOR;
  return AXES.find((a) => a.kind === kind)?.color;
}

interface Direction {
  kind: SnapKind;
  dir: THREE.Vector3;
  label?: string;
}

/**
 * SketchUp-style inference for drawing tools: snaps to geometry, locks to
 * red/green/blue axes and to directions parallel or perpendicular to a
 * reference edge, and aligns with remembered points. Remembers the points
 * and edges the cursor passes over.
 */
export class Inference {
  private points: THREE.Vector3[] = [];
  private reference: { a: THREE.Vector3; b: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  private lock: (Direction & { source: 'shift' | 'key' }) | null = null;
  private lastDirection: Direction | null = null;
  /** Normal of the face a drawing started on, for "perpendicular to face". */
  startNormal: THREE.Vector3 | null = null;

  constructor(
    private readonly model: Model,
    private readonly picker: Picker,
    private readonly viewport: Viewport,
  ) {}

  /** Adds a point that later points can align with. */
  remember(point: THREE.Vector3): void {
    this.points = [point.clone(), ...this.points.filter((p) => p.distanceTo(point) > 1)].slice(0, MAX_POINTS);
  }

  /** Releases locks after a point is placed or the tool is reset. */
  release(): void {
    this.lock = null;
    this.lastDirection = null;
  }

  get locked(): boolean {
    return this.lock !== null;
  }

  /**
   * Arrow keys lock a direction: right = red, left = green, up = blue,
   * down = parallel to the reference edge. Pressing again unlocks.
   */
  keyDown(e: KeyboardEvent): boolean {
    let next: Direction | null = null;
    const axis = AXES.find((a) => a.arrow === e.key);
    if (axis) next = { kind: axis.kind, dir: axis.dir };
    else if (e.key === 'ArrowDown' && this.reference) next = { kind: 'parallel', dir: this.reference.dir };
    else return false;
    this.lock = this.lock?.source === 'key' && this.lock.kind === next.kind ? null : { ...next, source: 'key' };
    return true;
  }

  /** The point a drawing tool should use for the cursor, drawing from `from` (if any). */
  infer(e: PointerEvent, from: THREE.Vector3 | null): InferredPoint | null {
    const pick = this.picker.pick(e.clientX, e.clientY);
    const ray = this.viewport.ray(e.clientX, e.clientY);
    const cursor = new THREE.Vector2(e.clientX, e.clientY);
    const px = (p: THREE.Vector3) => this.viewport.toScreen(p)?.distanceTo(cursor) ?? Infinity;

    if (pick.kind === 'vertex' || pick.kind === 'midpoint' || pick.kind === 'guide-point' || pick.kind === 'intersection') {
      if (!from || pick.point.distanceTo(from) > 1) this.remember(pick.point);
    }
    if (pick.kind === 'edge' || pick.kind === 'midpoint') {
      const edge = this.model.edge(pick.id);
      const a = this.model.position(edge.a).clone();
      const b = this.model.position(edge.b).clone();
      this.reference = { a, b, dir: b.clone().sub(a).normalize() };
    }

    // Shift holds whatever direction is currently inferred.
    if (e.shiftKey && !this.lock && this.lastDirection) this.lock = { ...this.lastDirection, source: 'shift' };
    if (!e.shiftKey && this.lock?.source === 'shift') this.lock = null;

    if (this.lock && from) {
      const line = { point: from, direction: this.lock.dir };
      const guides: GuideSegment[] = [];
      let point: THREE.Vector3;
      if (pick.kind !== 'none' && SNAP_KINDS.has(pick.kind)) {
        // Locked direction, length taken from the point under the cursor.
        point = projectOnLine(pick.point, line);
        guides.push({ from: pick.point, to: point });
      } else {
        point = closestOnLineToRay(line, ray);
      }
      return { point, kind: this.lock.kind, label: this.lock.label, pick, direction: this.lock.dir, guides, reference: this.referenceFor(this.lock.kind) };
    }

    if (pick.kind !== 'none' && SNAP_KINDS.has(pick.kind)) {
      this.lastDirection = null;
      return { point: pick.point, kind: pick.kind as SnapKind, pick, guides: [] };
    }

    if (from && px(from) > MIN_DRAG) {
      let best: (Direction & { point: THREE.Vector3; d: number }) | null = null;
      for (const candidate of this.directions()) {
        const point = closestOnLineToRay({ point: from, direction: candidate.dir }, ray);
        const d = px(point);
        if (d < DIRECTION_RADIUS && (!best || d < best.d) && point.distanceTo(from) > 1e-6) best = { ...candidate, point, d };
      }
      if (best) {
        this.lastDirection = { kind: best.kind, dir: best.dir, label: best.label };
        const line = { point: from, direction: best.dir };
        const aligned = this.alignOnLine(line, px);
        return {
          point: aligned?.point ?? best.point,
          kind: best.kind,
          label: aligned ? `${best.label ?? labelFor(best.kind)} · From Point` : best.label,
          pick,
          direction: best.dir,
          guides: aligned ? [aligned.guide] : [],
          reference: this.referenceFor(best.kind),
        };
      }
    }
    this.lastDirection = null;

    if (pick.kind === 'face' || pick.kind === 'ground') {
      const plane =
        pick.kind === 'face'
          ? this.model.facePlane(this.model.face(pick.id))
          : { normal: new THREE.Vector3(0, 0, 1), d: 0 };
      const aligned = this.alignInPlane(ray, plane, px, from ? [from] : []);
      if (aligned) return { point: aligned.point, kind: 'from-point', pick, guides: aligned.guides };
      return { point: pick.point, kind: pick.kind, pick, guides: [] };
    }
    return null;
  }

  /**
   * Aligns a point in a plane with remembered points (and `extra` points)
   * along the axes. Snaps to the crossing of two alignments when near one.
   */
  alignInPlane(
    ray: THREE.Ray,
    plane: { normal: THREE.Vector3; d: number },
    px: (p: THREE.Vector3) => number,
    extra: THREE.Vector3[] = [],
  ): { point: THREE.Vector3; guides: GuideSegment[] } | null {
    const lines: { line: Line3; source: THREE.Vector3; color: number; point: THREE.Vector3; d: number }[] = [];
    for (const source of [...extra, ...this.points]) {
      for (const axis of AXES) {
        const line = alignmentInPlane(source, axis.dir, plane);
        if (!line) continue;
        const point = closestOnLineToRay(line, ray);
        const d = px(point);
        if (d < ALIGN_RADIUS) lines.push({ line, source, color: axis.color, point, d });
      }
    }
    if (lines.length === 0) return null;

    let crossing: { point: THREE.Vector3; guides: GuideSegment[]; d: number } | null = null;
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const x = intersectLines(lines[i].line, lines[j].line);
        if (!x) continue;
        const d = px(x);
        if (d < ALIGN_RADIUS * 1.5 && (!crossing || d < crossing.d)) {
          crossing = {
            point: x,
            d,
            guides: [
              { from: lines[i].source, to: x, color: lines[i].color },
              { from: lines[j].source, to: x, color: lines[j].color },
            ],
          };
        }
      }
    }
    if (crossing) return crossing;

    const best = lines.sort((a, b) => a.d - b.d)[0];
    return { point: best.point, guides: [{ from: best.source, to: best.point, color: best.color }] };
  }

  /**
   * The point on a direction line level with a remembered point: where the
   * line passes square to it, so a line drawn along red stops in line with
   * a corner elsewhere, even at another height.
   */
  private alignOnLine(line: Line3, px: (p: THREE.Vector3) => number): { point: THREE.Vector3; guide: GuideSegment } | null {
    let best: { point: THREE.Vector3; guide: GuideSegment; d: number } | null = null;
    for (const source of this.points) {
      if (source.distanceTo(line.point) < 1) continue;
      const x = projectOnLine(source, line);
      if (x.distanceTo(source) < 1 || x.distanceTo(line.point) < 1) continue;
      const d = px(x);
      if (d < ALIGN_RADIUS && (!best || d < best.d)) {
        const along = x.clone().sub(source).normalize();
        const color = AXES.find((a) => Math.abs(a.dir.dot(along)) > 0.9999)?.color;
        best = { point: x, d, guide: { from: source, to: x, color } };
      }
    }
    return best;
  }

  /** Axis directions, then directions relative to the reference edge and start face. */
  private directions(): Direction[] {
    const result: Direction[] = AXES.map((a) => ({ kind: a.kind, dir: a.dir }));
    const isAxis = (d: THREE.Vector3) => AXES.some((a) => Math.abs(a.dir.dot(d)) > 0.9999);
    const add = (dir: THREE.Vector3, kind: SnapKind, label?: string) => {
      if (dir.lengthSq() < 1e-12) return;
      const d = dir.clone().normalize();
      if (!isAxis(d) && !result.some((r) => Math.abs(r.dir.dot(d)) > 0.9999)) result.push({ kind, dir: d, label });
    };

    if (this.reference) {
      const d = this.reference.dir;
      add(d, 'parallel');
      const horizontal = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1));
      add(horizontal, 'perpendicular');
      if (horizontal.lengthSq() > 1e-12) add(new THREE.Vector3().crossVectors(horizontal, d), 'perpendicular');
      if (this.startNormal) add(new THREE.Vector3().crossVectors(this.startNormal, d), 'perpendicular');
    }
    if (this.startNormal) add(this.startNormal, 'perpendicular', 'Perpendicular to Face');
    return result;
  }

  private referenceFor(kind: SnapKind): [THREE.Vector3, THREE.Vector3] | undefined {
    return (kind === 'parallel' || kind === 'perpendicular') && this.reference ? [this.reference.a, this.reference.b] : undefined;
  }
}

function labelFor(kind: SnapKind): string {
  return (
    {
      'axis-x': 'On Red Axis',
      'axis-y': 'On Green Axis',
      'axis-z': 'On Blue Axis',
      parallel: 'Parallel to Edge',
      perpendicular: 'Perpendicular to Edge',
    } as Partial<Record<SnapKind, string>>
  )[kind] ?? '';
}
