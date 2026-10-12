import * as THREE from 'three';
import type { Id, Model } from '../kernel/Model';
import { triangulateFace } from '../kernel/faces';
import { theme } from './theme';
import type { Viewport } from './Viewport';

export interface Highlight {
  faces: Iterable<Id>;
  edges: Iterable<Id>;
  guides?: Iterable<Id>;
}

const EMPTY: Highlight = { faces: [], edges: [] };
const GUIDE_REACH = 100_000; // guide lines are drawn 100 m each way

/**
 * Draws the model: faces white on the front, blue-grey on the back (like
 * SketchUp, so flipped faces are visible), edges as thin dark lines. Also
 * draws selection and hover highlights. Rebuilt whenever the model changes.
 */
export class ModelRenderer {
  readonly group = new THREE.Group();
  readonly front: THREE.Mesh;
  readonly back: THREE.Mesh;
  private readonly edges: THREE.LineSegments;
  private readonly selectionFaces: THREE.Mesh;
  private readonly selectionEdges: THREE.LineSegments;
  private readonly hoverFaces: THREE.Mesh;
  private readonly hoverEdges: THREE.LineSegments;
  private readonly guideLines: THREE.LineSegments;
  private readonly guidePoints: THREE.Points;

  /** Face id per triangle of the face meshes, for picking. */
  private triangleFaces: Id[] = [];
  private selection = EMPTY;
  private hover = EMPTY;

  constructor(
    private readonly model: Model,
    private readonly viewport: Viewport,
  ) {
    const faceMaterial = (color: number, side: THREE.Side) =>
      new THREE.MeshLambertMaterial({ color, side, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

    this.front = new THREE.Mesh(new THREE.BufferGeometry(), faceMaterial(theme.face, THREE.FrontSide));
    this.back = new THREE.Mesh(this.front.geometry, faceMaterial(theme.faceBack, THREE.BackSide));
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: theme.edge }));

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
    this.selectionEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: theme.selection }),
    );
    this.hoverEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: theme.hover }));
    for (const lines of [this.selectionEdges, this.hoverEdges]) lines.renderOrder = 2;
    // Highlights must not be hit by picking.
    for (const obj of [this.selectionFaces, this.hoverFaces, this.selectionEdges, this.hoverEdges]) obj.raycast = () => {};
    this.edges.raycast = () => {};

    this.guideLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: theme.guide, dashSize: 200, gapSize: 150, transparent: true, opacity: 0.8 }),
    );
    this.guidePoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: theme.guide, size: 5, sizeAttenuation: false }),
    );
    for (const obj of [this.guideLines, this.guidePoints]) obj.raycast = () => {};

    this.group.add(this.guideLines, this.guidePoints, this.front, this.back, this.edges, this.hoverFaces, this.selectionFaces, this.hoverEdges, this.selectionEdges);
    viewport.content.add(this.group);

    model.changed.on(() => this.rebuild());
    this.rebuild();
  }

  /** Face id for a triangle index from a raycast hit on `front`/`back`. */
  faceOfTriangle(index: number): Id | undefined {
    return this.triangleFaces[index];
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
    const positions: number[] = [];
    const normals: number[] = [];
    this.triangleFaces = [];

    for (const face of this.model.allFaces()) {
      const triangles = triangulateFace(this.model, face);
      const n = face.normal;
      for (let i = 0; i < triangles.length; i += 3) {
        let [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
        // Wind triangles to match the face normal so front/back materials work.
        const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (cross.dot(n) < 0) [b, c] = [c, b];
        for (const p of [a, b, c]) {
          positions.push(p.x, p.y, p.z);
          normals.push(n.x, n.y, n.z);
        }
        this.triangleFaces.push(face.id);
      }
    }

    const faces = new THREE.BufferGeometry();
    faces.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    faces.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    faces.computeBoundingSphere();
    this.front.geometry.dispose();
    this.front.geometry = faces;
    this.back.geometry = faces;

    this.edges.geometry.dispose();
    this.edges.geometry = this.edgeGeometry(this.model.allEdges().map((e) => e.id));

    const guides = this.model.allGuides();
    this.guideLines.geometry.dispose();
    this.guideLines.geometry = this.guideGeometry(guides.map((g) => g.id));
    this.guideLines.computeLineDistances();
    this.guidePoints.geometry.dispose();
    this.guidePoints.geometry = new THREE.BufferGeometry().setFromPoints(
      guides.flatMap((g) => (g.kind === 'point' ? [g.point] : [])),
    );

    // Drop highlights of entities that no longer exist.
    this.setSelection(this.selection);
    this.setHover(this.hover);
    this.viewport.requestRender();
  }

  private edgeGeometry(ids: Iterable<Id>): THREE.BufferGeometry {
    const positions: number[] = [];
    for (const id of ids) {
      if (!this.model.hasEdge(id)) continue;
      const e = this.model.edge(id);
      const a = this.model.position(e.a);
      const b = this.model.position(e.b);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  private guideGeometry(ids: Iterable<Id>): THREE.BufferGeometry {
    const wanted = new Set(ids);
    const points: THREE.Vector3[] = [];
    for (const g of this.model.allGuides()) {
      if (!wanted.has(g.id) || g.kind !== 'line') continue;
      points.push(
        g.point.clone().addScaledVector(g.direction, -GUIDE_REACH),
        g.point.clone().addScaledVector(g.direction, GUIDE_REACH),
      );
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }

  private updateHighlight(mesh: THREE.Mesh, lines: THREE.LineSegments, highlight: Highlight): void {
    const positions: number[] = [];
    for (const id of highlight.faces) {
      if (!this.model.hasFace(id)) continue;
      for (const p of triangulateFace(this.model, this.model.face(id))) positions.push(p.x, p.y, p.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mesh.geometry.dispose();
    mesh.geometry = geometry;

    lines.geometry.dispose();
    const edges = this.edgeGeometry(highlight.edges).getAttribute('position').array as Float32Array;
    const guides = this.guideGeometry(highlight.guides ?? []).getAttribute('position')?.array ?? new Float32Array();
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute([...edges, ...guides], 3));
    lines.geometry = merged;
    this.viewport.requestRender();
  }
}
