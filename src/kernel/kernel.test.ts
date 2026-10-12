import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Model } from './Model';
import { drawPolygon, drawSegments } from './draw';
import { eraseEdges, eraseFaces } from './cleanup';
import { pushPull } from './pushPull';
import { faceArea } from './faces';

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function rect(x0: number, y0: number, x1: number, y1: number, z = 0) {
  return [v(x0, y0, z), v(x1, y0, z), v(x1, y1, z), v(x0, y1, z)];
}

function run(model: Model, fn: () => void) {
  return model.edit(fn).edit;
}

function areas(model: Model) {
  return model
    .allFaces()
    .map((f) => Math.round(faceArea(model, f)))
    .sort((a, b) => a - b);
}

/** Every edge of a closed solid is shared by exactly two faces. */
function isClosedSolid(model: Model) {
  return model.allEdges().every((e) => model.facesOfEdge(e.id).length === 2);
}

/** Sum of signed volumes from the face normals (divergence theorem). */
function volume(model: Model) {
  let total = 0;
  for (const face of model.allFaces()) {
    const p = model.position(face.outer[0]);
    total += (faceArea(model, face) * face.normal.dot(p)) / 3;
  }
  return Math.round(total);
}

describe('drawing', () => {
  it('closes a rectangle into a face facing down on the ground', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 500)));
    expect(model.edgeCount).toBe(4);
    expect(model.faceCount).toBe(1);
    expect(areas(model)).toEqual([500_000]);
    expect(model.allFaces()[0].normal.z).toBe(-1);
  });

  it('does not make a face from an open chain', () => {
    const model = new Model();
    run(model, () =>
      drawSegments(model, [
        [v(0, 0), v(1000, 0)],
        [v(1000, 0), v(1000, 1000)],
      ]),
    );
    expect(model.faceCount).toBe(0);
  });

  it('closes a loop drawn one line at a time', () => {
    const model = new Model();
    const pts = rect(0, 0, 1000, 1000, 500);
    for (let i = 0; i < 4; i++) run(model, () => drawSegments(model, [[pts[i], pts[(i + 1) % 4]]]));
    expect(model.faceCount).toBe(1);
    expect(model.allFaces()[0].normal.z).toBe(1);
  });

  it('splits a face with an edge across it, keeping the id on the larger half', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    const id = model.allFaces()[0].id;
    run(model, () => drawSegments(model, [[v(300, 0), v(300, 1000)]]));
    expect(areas(model)).toEqual([300_000, 700_000]);
    expect(model.hasFace(id)).toBe(true);
    expect(faceArea(model, model.face(id))).toBeCloseTo(700_000);
  });

  it('splits crossing edges and makes four faces', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () =>
      drawSegments(model, [
        [v(500, 0), v(500, 1000)],
        [v(0, 500), v(1000, 500)],
      ]),
    );
    expect(model.faceCount).toBe(4);
    expect(model.edgeCount).toBe(12);
    expect(areas(model)).toEqual([250_000, 250_000, 250_000, 250_000]);
  });

  it('turns a rectangle drawn inside a face into a hole plus an inner face', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => drawPolygon(model, rect(200, 200, 400, 400)));
    expect(areas(model)).toEqual([40_000, 960_000]);
    const outer = model.allFaces().find((f) => f.holes.length === 1);
    expect(outer).toBeDefined();
  });

  it('leaves a dangling edge on a face without splitting it', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => drawSegments(model, [[v(0, 500), v(400, 500)]]));
    expect(model.faceCount).toBe(1);
    expect(areas(model)).toEqual([1_000_000]);
  });
});

describe('erasing', () => {
  it('merges coplanar faces when erasing the edge between them', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => drawSegments(model, [[v(300, 0), v(300, 1000)]]));
    const middle = model.edgeBetween(model.findVertex(v(300, 0))!, model.findVertex(v(300, 1000))!)!;
    run(model, () => eraseEdges(model, [middle]));
    expect(areas(model)).toEqual([1_000_000]);
    // The split vertices were collinear and are gone again.
    expect(model.vertexCount).toBe(4);
    expect(model.edgeCount).toBe(4);
  });

  it('deletes the face when erasing one of its boundary edges', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => eraseEdges(model, [model.allEdges()[0].id]));
    expect(model.faceCount).toBe(0);
    expect(model.edgeCount).toBe(3);
  });

  it('does not bring back a deleted face when drawing next to it', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => eraseFaces(model, [model.allFaces()[0].id]));
    run(model, () => drawSegments(model, [[v(1000, 0), v(2000, 0)]]));
    expect(model.faceCount).toBe(0);
  });
});

describe('push/pull', () => {
  it('pulls a ground rectangle into a closed box', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 2000)));
    const face = model.allFaces()[0];
    // Ground faces point down, so pulling up is a negative distance.
    run(model, () => pushPull(model, face.id, -3000));
    expect(model.faceCount).toBe(6);
    expect(model.edgeCount).toBe(12);
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(6_000_000_000);
  });

  it('moves a box top instead of adding geometry', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    const top = model.allFaces().find((f) => f.normal.z === 1)!;
    run(model, () => pushPull(model, top.id, 500));
    expect(model.faceCount).toBe(6);
    expect(model.vertexCount).toBe(8);
    expect(volume(model)).toBe(1_500_000_000);

    run(model, () => pushPull(model, top.id, -1200));
    expect(volume(model)).toBe(300_000_000);
    // Cannot push through the bottom.
    expect(model.edit(() => pushPull(model, top.id, -400)).result).toBe(false);
  });

  it('pulls a rectangle drawn on a box top into a bump', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 3000, 3000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    run(model, () => drawPolygon(model, rect(1000, 1000, 2000, 2000, 1000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 1_000_000)!;
    run(model, () => pushPull(model, inner.id, 500));
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(9_000_000_000 + 500_000_000);
  });

  it('pushes a rectangle on a box top into a recess', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 3000, 3000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    run(model, () => drawPolygon(model, rect(1000, 1000, 2000, 2000, 1000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 1_000_000)!;
    run(model, () => pushPull(model, inner.id, -400));
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(9_000_000_000 - 400_000_000);
  });

  it('merges a wall flush with an existing wall', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 3000, 3000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    // Rectangle on the top touching the front edge (y = 0).
    run(model, () => drawPolygon(model, rect(1000, 0, 2000, 1000, 1000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 1_000_000)!;
    run(model, () => pushPull(model, inner.id, 500));
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(9_000_000_000 + 500_000_000);
    const front = model.allFaces().filter((f) => f.normal.y === -1);
    expect(front).toHaveLength(1);
    expect(Math.round(faceArea(model, front[0]))).toBe(3_000_000 + 500_000);
  });

  it('pushes an extrusion back flush and it disappears', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 3000, 3000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    run(model, () => drawPolygon(model, rect(1000, 1000, 2000, 2000, 1000)));
    const inner = model.allFaces().find((f) => f.normal.z === 1 && Math.round(faceArea(model, f)) === 1_000_000)!;
    run(model, () => pushPull(model, inner.id, 500));
    const raised = model.allFaces().find((f) => f.normal.z === 1 && model.position(f.outer[0]).z === 1500)!;
    run(model, () => pushPull(model, raised.id, -500));
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(9_000_000_000);
    expect(model.faceCount).toBe(6);
  });
});

describe('undo', () => {
  it('reverts an edit exactly', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 1000, 1000)));
    const snapshot = JSON.stringify([model.allVertices(), model.allEdges(), model.allFaces()]);
    const edit = run(model, () => pushPull(model, model.allFaces()[0].id, -1000));
    expect(model.faceCount).toBe(6);
    edit.revert();
    expect(JSON.stringify([model.allVertices(), model.allEdges(), model.allFaces()])).toBe(snapshot);
    edit.apply();
    expect(model.faceCount).toBe(6);
    expect(isClosedSolid(model)).toBe(true);
  });

  it('rolls back a failed edit', () => {
    const model = new Model();
    expect(() =>
      model.edit(() => {
        drawPolygon(model, rect(0, 0, 1000, 1000));
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(model.vertexCount + model.edgeCount + model.faceCount).toBe(0);
  });
});

describe('push/pull next to a solid', () => {
  it('pulls a ground rectangle against a building into its own block', () => {
    const model = new Model();
    run(model, () => drawPolygon(model, rect(0, 0, 3000, 3000)));
    run(model, () => pushPull(model, model.allFaces()[0].id, -2000));
    // Porch on the ground sharing part of the front wall's bottom edge.
    run(model, () => drawPolygon(model, rect(1000, -1500, 2000, 0)));
    const porch = model.allFaces().find((f) => f.normal.z === -1 && Math.round(faceArea(model, f)) === 1_500_000)!;
    run(model, () => pushPull(model, porch.id, -1000));
    expect(isClosedSolid(model)).toBe(true);
    expect(volume(model)).toBe(18_000_000_000 + 1_500_000_000);
    // The porch floor merges with the building floor into one footprint.
    expect(model.allFaces().filter((f) => f.normal.z === -1).length).toBe(1);
  });
});
