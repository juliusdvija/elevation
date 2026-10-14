import * as THREE from 'three';
import type { Document, Placement } from '../document';
import type { Id } from '../kernel/Model';
import { faceArea, triangulateFace } from '../kernel/faces';
import { smoothNormal } from './shading';
import { theme } from './theme';
import { ThickLines } from './thickLines';
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
/** Line widths in screen pixels: model edges, the selection's outline, and the hover outline. */
const EDGE_WIDTH = 1.6;
const SELECTION_WIDTH = 3.2;
const HOVER_WIDTH = 2.4;

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
  edges: ThickLines;
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
  private readonly selectionEdges: ThickLines;
  private readonly hoverFaces: THREE.Mesh;
  private readonly hoverEdges: ThickLines;
  private readonly guideLines: THREE.LineSegments;
  private readonly guidePoints: THREE.Points;
  /** Faces meeting at less than this angle (radians) shade smoothly and show no edge line between them; 0 turns it off. */
  smoothAngle = THREE.MathUtils.degToRad(20);
  private realistic = false;
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
      const edges = new ThickLines(theme.edge, EDGE_WIDTH, opacity);
      // Faces cast and receive the sun's shadows; glass and the back side do not cast.
      front.castShadow = true;
      front.receiveShadow = true;
      front.material.shadowSide = THREE.DoubleSide;
      back.receiveShadow = true;
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
    this.selectionEdges = new ThickLines(theme.selection, SELECTION_WIDTH);
    this.hoverEdges = new ThickLines(theme.hover, HOVER_WIDTH);
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

    // Selection, hover and guides are working marks, not part of a picture of the model.
    viewport.snapshotHooks.push((rendering) => {
      for (const obj of [this.selectionFaces, this.selectionEdges, this.hoverFaces, this.hoverEdges]) obj.visible = !rendering;
      this.guideLines.visible = this.guidePoints.visible = !rendering && !this.realistic;
    });

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

  /** Sets the width (screen pixels) of the model's edge lines. */
  setLineWidth(width: number): void {
    for (const layer of [this.active, this.faded]) layer.edges.material.linewidth = width;
    this.viewport.requestRender();
  }

  /** Hides the plain faces, edges and guides (they still take part in picking) while the photorealistic view draws the model. */
  setRealistic(on: boolean): void {
    this.realistic = on;
    for (const layer of [this.active, this.faded]) {
      layer.front.visible = layer.back.visible = layer.glass.visible = layer.edges.visible = !on;
    }
    this.guideLines.visible = this.guidePoints.visible = !on;
    this.viewport.requestRender();
  }

  /** Changes the smoothing angle (degrees; 0 is off) and redraws. */
  setSmoothing(degrees: number): void {
    this.smoothAngle = THREE.MathUtils.degToRad(degrees);
    this.rebuild();
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
      const worldNormal = new Map<Id, THREE.Vector3>();
      const faceNormal = (f: { id: Id; normal: THREE.Vector3 }) => {
        let n = worldNormal.get(f.id);
        if (!n) worldNormal.set(f.id, (n = f.normal.clone().applyMatrix3(normalMatrix).normalize()));
        return n;
      };
      // Between faces that meet at a shallow angle (the facets of a round) shading is smooth and the edge is not drawn.
      const cosSmooth = Math.cos(this.smoothAngle);
      const smoothing = this.smoothAngle > 0;
      const keyOf = (p: THREE.Vector3) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;
      const around = new Map<string, { n: THREE.Vector3; weight: number }[]>();
      if (smoothing) {
        for (const face of model.allFaces()) {
          const n = faceNormal(face);
          const weight = Math.max(faceArea(model, face), 1e-6);
          for (const id of model.faceVertices(face)) {
            const key = keyOf(model.position(id));
            (around.get(key) ?? around.set(key, []).get(key)!).push({ n, weight });
          }
        }
      }
      for (const face of model.allFaces()) {
        const local = triangulateFace(model, face);
        const n = faceNormal(face);
        const paint = face.color ? new THREE.Color(face.color) : PLAIN;
        const glass = face.opacity !== undefined && face.opacity < 1;
        const sink = glass ? target.glass : target;
        for (let i = 0; i < local.length; i += 3) {
          // Each corner as its position in the model (for finding the faces around it) and in the world.
          let [a, b, c] = [local[i], local[i + 1], local[i + 2]].map((q) => ({ q, p: q.clone().applyMatrix4(matrix) }));
          // Wind triangles to match the face normal so front/back materials work.
          const cross = new THREE.Vector3().subVectors(b.p, a.p).cross(new THREE.Vector3().subVectors(c.p, a.p));
          if (cross.dot(n) < 0) [b, c] = [c, b];
          for (const { q, p } of [a, b, c]) {
            sink.positions.push(p.x, p.y, p.z);
            const shade = smoothing ? smoothNormal(around.get(keyOf(q)), n, cosSmooth) : n;
            sink.normals.push(shade.x, shade.y, shade.z);
            sink.colors.push(paint.r, paint.g, paint.b);
            if (glass) sink.colors.push(face.opacity!);
          }
          sink.refs.push({ placement, face: face.id });
        }
      }
      for (const e of model.allEdges()) {
        if (smoothing) {
          const faces = model.facesOfEdge(e.id);
          if (faces.length === 2 && faceNormal(model.face(faces[0])).dot(faceNormal(model.face(faces[1]))) >= cosSmooth) continue;
        }
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
      layer.edges.setSegments(data.edges);
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

  private updateHighlight(mesh: THREE.Mesh, lines: ThickLines, highlight: Highlight): void {
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
    lines.setSegments([...segments, ...guides]);
    this.viewport.requestRender();
  }
}
