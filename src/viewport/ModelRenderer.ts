import * as THREE from 'three';
import type { Document, Placement } from '../document';
import type { Id } from '../kernel/Model';
import { triangulateFace } from '../kernel/faces';
import { theme } from './theme';
import type { Viewport } from './Viewport';

/** Entities to highlight: ids in the current context's model (guides in the root). */
export interface Highlight {
  faces: Iterable<Id>;
  edges: Iterable<Id>;
  guides?: Iterable<Id>;
  instances?: Iterable<Id>;
}

/** A face as hit by picking: which placed model, which face. */
export interface FaceRef {
  placement: Placement;
  face: Id;
}

const EMPTY: Highlight = { faces: [], edges: [] };
const GUIDE_REACH = 100_000; // guide lines are drawn 100 m each way
const FADED_OPACITY = 0.3;
const PLAIN = new THREE.Color(theme.face);

/** Whether `path` lies inside (or is) the context at `context`. */
export function within(path: Id[], context: Id[]): boolean {
  return context.every((id, i) => path[i] === id);
}

interface Layer {
  front: THREE.Mesh;
  back: THREE.Mesh;
  /** See-through faces (glass), drawn after the solid ones. */
  glass: THREE.Mesh;
  edges: THREE.LineSegments;
  refs: FaceRef[];
  glassRefs: FaceRef[];
}

/**
 * Draws every placed model in world space: faces white on the front,
 * blue-grey on the back (like SketchUp, so flipped faces show), edges as
 * thin dark lines. While editing inside a group, everything outside it is
 * faded. Also draws guides and selection/hover highlights.
 */
export class ModelRenderer {
  readonly group = new THREE.Group();
  private readonly active: Layer;
  private readonly faded: Layer;
  private readonly selectionFaces: THREE.Mesh;
  private readonly selectionEdges: THREE.LineSegments;
  private readonly hoverFaces: THREE.Mesh;
  private readonly hoverEdges: THREE.LineSegments;
  private readonly guideLines: THREE.LineSegments;
  private readonly guidePoints: THREE.Points;
  private selection = EMPTY;
  private hover = EMPTY;

  constructor(
    private readonly doc: Document,
    private readonly viewport: Viewport,
  ) {
    const faceMaterial = (color: number, side: THREE.Side, opacity = 1, vertexColors = false) =>
      new THREE.MeshLambertMaterial({
        color,
        vertexColors,
        side,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity === 1,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    const layer = (opacity: number): Layer => {
      const front = new THREE.Mesh(new THREE.BufferGeometry(), faceMaterial(0xffffff, THREE.FrontSide, opacity, true));
      const back = new THREE.Mesh(front.geometry, faceMaterial(theme.faceBack, THREE.BackSide, opacity));
      const edges = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: theme.edge, transparent: opacity < 1, opacity }),
      );
      edges.raycast = () => {};
      // Per-vertex alpha (an RGBA colour attribute) gives each pane its own opacity.
      const glass = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity }),
      );
      glass.renderOrder = 1;
      return { front, back, glass, edges, refs: [], glassRefs: [] };
    };
    this.active = layer(1);
    this.faded = layer(FADED_OPACITY);

    const tint = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    this.selectionFaces = new THREE.Mesh(new THREE.BufferGeometry(), tint(theme.selection, 0.22));
    this.hoverFaces = new THREE.Mesh(new THREE.BufferGeometry(), tint(theme.hover, 0.16));
    this.selectionEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: theme.selection }));
    this.hoverEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: theme.hover }));
    for (const lines of [this.selectionEdges, this.hoverEdges]) lines.renderOrder = 2;
    for (const obj of [this.selectionFaces, this.hoverFaces, this.selectionEdges, this.hoverEdges]) obj.raycast = () => {};

    this.guideLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: theme.guide, dashSize: 200, gapSize: 150, transparent: true, opacity: 0.8 }),
    );
    this.guidePoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: theme.guide, size: 5, sizeAttenuation: false }));
    for (const obj of [this.guideLines, this.guidePoints]) obj.raycast = () => {};

    this.faded.front.renderOrder = 1;
    this.faded.back.renderOrder = 1;
    this.group.add(
      this.guideLines,
      this.guidePoints,
      this.active.front,
      this.active.back,
      this.active.glass,
      this.active.edges,
      this.faded.front,
      this.faded.back,
      this.faded.glass,
      this.faded.edges,
      this.hoverFaces,
      this.selectionFaces,
      this.hoverEdges,
      this.selectionEdges,
    );
    viewport.content.add(this.group);

    doc.geometryChanged.on(() => this.rebuild());
    this.rebuild();
  }

  /** Meshes to raycast for picking faces (front and back sides of everything). */
  get pickMeshes(): THREE.Mesh[] {
    return [this.active.front, this.active.back, this.active.glass, this.faded.front, this.faded.back, this.faded.glass];
  }

  /** The face behind a raycast hit on one of `pickMeshes`. */
  faceOfHit(mesh: THREE.Object3D, triangle: number): FaceRef | undefined {
    const layer = mesh === this.active.front || mesh === this.active.back || mesh === this.active.glass ? this.active : this.faded;
    return mesh === layer.glass ? layer.glassRefs[triangle] : layer.refs[triangle];
  }

  setSelection(highlight: Highlight): void {
    this.selection = highlight;
    this.updateHighlight(this.selectionFaces, this.selectionEdges, highlight);
  }

  setHover(highlight: Highlight | null): void {
    this.hover = highlight ?? EMPTY;
    this.updateHighlight(this.hoverFaces, this.hoverEdges, this.hover);
  }

  private rebuild(): void {
    const context = this.doc.context.path;
    const buffers = () => ({
      positions: [] as number[],
      normals: [] as number[],
      colors: [] as number[],
      refs: [] as FaceRef[],
      glass: { positions: [] as number[], normals: [] as number[], colors: [] as number[], refs: [] as FaceRef[] },
      edges: [] as number[],
    });
    const build = { active: buffers(), faded: buffers() };

    for (const placement of this.doc.placements()) {
      const target = within(placement.path, context) ? build.active : build.faded;
      const { model, matrix } = placement;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      for (const face of model.allFaces()) {
        const triangles = triangulateFace(model, face).map((p) => p.clone().applyMatrix4(matrix));
        const n = face.normal.clone().applyMatrix3(normalMatrix).normalize();
        const paint = face.color ? new THREE.Color(face.color) : PLAIN;
        const glass = face.opacity !== undefined && face.opacity < 1;
        const sink = glass ? target.glass : target;
        for (let i = 0; i < triangles.length; i += 3) {
          let [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
          // Wind triangles to match the face normal so front/back materials work.
          const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
          if (cross.dot(n) < 0) [b, c] = [c, b];
          for (const p of [a, b, c]) {
            sink.positions.push(p.x, p.y, p.z);
            sink.normals.push(n.x, n.y, n.z);
            sink.colors.push(paint.r, paint.g, paint.b);
            if (glass) sink.colors.push(face.opacity!);
          }
          sink.refs.push({ placement, face: face.id });
        }
      }
      for (const e of model.allEdges()) {
        const a = model.position(e.a).clone().applyMatrix4(matrix);
        const b = model.position(e.b).clone().applyMatrix4(matrix);
        target.edges.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    for (const [layer, data] of [
      [this.active, build.active],
      [this.faded, build.faded],
    ] as const) {
      const faces = new THREE.BufferGeometry();
      faces.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      faces.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      faces.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
      faces.computeBoundingSphere();
      layer.front.geometry.dispose();
      layer.front.geometry = faces;
      layer.back.geometry = faces;
      layer.refs = data.refs;
      const glass = new THREE.BufferGeometry();
      glass.setAttribute('position', new THREE.Float32BufferAttribute(data.glass.positions, 3));
      glass.setAttribute('normal', new THREE.Float32BufferAttribute(data.glass.normals, 3));
      glass.setAttribute('color', new THREE.Float32BufferAttribute(data.glass.colors, 4));
      glass.computeBoundingSphere();
      layer.glass.geometry.dispose();
      layer.glass.geometry = glass;
      layer.glassRefs = data.glass.refs;
      layer.edges.geometry.dispose();
      layer.edges.geometry = new THREE.BufferGeometry();
      layer.edges.geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.edges, 3));
    }

    const guides = this.doc.model.allGuides();
    this.guideLines.geometry.dispose();
    this.guideLines.geometry = this.guideGeometry(guides.map((g) => g.id));
    this.guideLines.computeLineDistances();
    this.guidePoints.geometry.dispose();
    this.guidePoints.geometry = new THREE.BufferGeometry().setFromPoints(guides.flatMap((g) => (g.kind === 'point' ? [g.point] : [])));

    // Drop highlights of entities that no longer exist.
    this.setSelection(this.selection);
    this.setHover(this.hover);
    this.viewport.requestRender();
  }

  private guideGeometry(ids: Iterable<Id>): THREE.BufferGeometry {
    const wanted = new Set(ids);
    const points: THREE.Vector3[] = [];
    for (const g of this.doc.model.allGuides()) {
      if (!wanted.has(g.id) || g.kind !== 'line') continue;
      points.push(g.point.clone().addScaledVector(g.direction, -GUIDE_REACH), g.point.clone().addScaledVector(g.direction, GUIDE_REACH));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  private updateHighlight(mesh: THREE.Mesh, lines: THREE.LineSegments, highlight: Highlight): void {
    const ctx = this.doc.context;
    const { model, matrix } = ctx;
    const positions: number[] = [];
    for (const id of highlight.faces) {
      if (!model.hasFace(id)) continue;
      for (const p of triangulateFace(model, model.face(id))) {
        const w = p.clone().applyMatrix4(matrix);
        positions.push(w.x, w.y, w.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.dispose();
    mesh.geometry = geometry;

    const segments: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3) => segments.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (const id of highlight.edges) {
      if (!model.hasEdge(id)) continue;
      const e = model.edge(id);
      push(model.position(e.a).clone().applyMatrix4(matrix), model.position(e.b).clone().applyMatrix4(matrix));
    }
    // Instances: all their edges plus a bounding box.
    const instances = new Set(highlight.instances ?? []);
    if (instances.size > 0) {
      for (const id of instances) {
        if (!model.hasInstance(id)) continue;
        const box = new THREE.Box3();
        for (const p of this.doc.placements()) {
          if (!within(p.path, [...ctx.path, id])) continue;
          for (const e of p.model.allEdges()) {
            const a = p.model.position(e.a).clone().applyMatrix4(p.matrix);
            const b = p.model.position(e.b).clone().applyMatrix4(p.matrix);
            push(a, b);
            box.expandByPoint(a).expandByPoint(b);
          }
        }
        if (!box.isEmpty()) {
          const c = [box.min, box.max];
          const corner = (i: number) => new THREE.Vector3(c[i & 1].x, c[(i >> 1) & 1].y, c[(i >> 2) & 1].z);
          for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) push(corner(i), corner(i | bit));
        }
      }
    }
    const guides = this.guideGeometry(highlight.guides ?? []).getAttribute('position')?.array ?? new Float32Array();
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry();
    lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute([...segments, ...guides], 3));
    this.viewport.requestRender();
  }
}
