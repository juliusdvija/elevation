import * as THREE from 'three';
import type { Placement } from '../document';
import type { Id } from '../kernel/Model';
import type { Plane } from '../kernel/math';
import type { ToolContext } from './Tool';

/**
 * The model being edited and conversions between its coordinates and the
 * world. Tools work in world space and edit in local space. Placements are
 * rigid (rotation + translation), so lengths and angles carry over.
 */
export interface Space {
  placement: Placement;
  model: Placement['model'];
  toLocal(p: THREE.Vector3): THREE.Vector3;
  toWorld(p: THREE.Vector3): THREE.Vector3;
  /** A direction (or displacement) from world to local. */
  vectorToLocal(v: THREE.Vector3): THREE.Vector3;
  vectorToWorld(v: THREE.Vector3): THREE.Vector3;
  /** A world-space transform expressed in local coordinates. */
  matrixToLocal(world: THREE.Matrix4): THREE.Matrix4;
}

export function spaceOf(placement: Placement): Space {
  const rotation = new THREE.Matrix3().setFromMatrix4(placement.matrix);
  const inverseRotation = new THREE.Matrix3().setFromMatrix4(placement.inverse);
  return {
    placement,
    model: placement.model,
    toLocal: (p) => p.clone().applyMatrix4(placement.inverse),
    toWorld: (p) => p.clone().applyMatrix4(placement.matrix),
    vectorToLocal: (v) => v.clone().applyMatrix3(inverseRotation),
    vectorToWorld: (v) => v.clone().applyMatrix3(rotation),
    matrixToLocal: (world) => placement.inverse.clone().multiply(world).multiply(placement.matrix),
  };
}

export function space(ctx: ToolContext): Space {
  return spaceOf(ctx.doc.context);
}

/** A face's plane in world space. */
export function worldFacePlane(placement: Placement, face: Id): Plane {
  const model = placement.model;
  const f = model.face(face);
  const normal = f.normal.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(placement.matrix)).normalize();
  const point = model.position(f.outer[0]).clone().applyMatrix4(placement.matrix);
  return { normal, d: normal.dot(point) };
}

/** An edge's end points in world space. */
export function worldEdge(placement: Placement, edge: Id): [THREE.Vector3, THREE.Vector3] {
  const model = placement.model;
  const e = model.edge(edge);
  return [model.position(e.a).clone().applyMatrix4(placement.matrix), model.position(e.b).clone().applyMatrix4(placement.matrix)];
}
