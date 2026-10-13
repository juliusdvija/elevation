import * as THREE from 'three';
import { scaleAbout, transformVertices } from '../kernel/transform';
import { space } from './space';
import { targetVertices, type Targets } from './targets';
import type { ToolContext } from './Tool';

/** The current selection as targets for an operation. */
export function selectedTargets(ctx: ToolContext): Targets {
  const { selection } = ctx;
  return { faces: [...selection.faces], edges: [...selection.edges], vertices: [], instances: [...selection.instances] };
}

/**
 * Applies a world-space transform to targets: instances get it on their matrix, loose geometry on its vertices.
 * Call inside `doc.run`.
 */
export function transformTargets(ctx: ToolContext, targets: Targets, world: THREE.Matrix4): void {
  const s = space(ctx);
  const model = s.model;
  const m = s.matrixToLocal(world);
  for (const id of targets.instances) model.setInstanceMatrix(id, m.clone().multiply(new THREE.Matrix4().fromArray(model.instance(id).matrix)));
  transformVertices(model, targetVertices(ctx, targets), m);
}

/** Scales targets by per-axis factors about a world point (a negative factor mirrors). */
export function scaleTargets(ctx: ToolContext, targets: Targets, anchor: THREE.Vector3, factors: THREE.Vector3): void {
  transformTargets(ctx, targets, scaleAbout(anchor, factors));
}

/** Moves targets by a world-space displacement. */
export function moveTargets(ctx: ToolContext, targets: Targets, delta: THREE.Vector3): void {
  transformTargets(ctx, targets, new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z));
}
