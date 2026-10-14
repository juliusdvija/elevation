import * as THREE from 'three';

/** Body measures for walking through a model (mm). */
export const EYE_HEIGHT = 1600;
/** Highest step climbed without stopping (a stair riser, a kerb). */
export const STEP_UP = 450;
/** How close the body comes to a wall. */
export const BODY_RADIUS = 300;
/** Walls met at a glancing angle count as met at this cosine, so the clearance stays bounded. */
const MIN_COS = 0.2;

/** What the walker can find in the model: the floor under a point, and the nearest obstacle along a horizontal ray. */
export interface WalkWorld {
  /** Height of the first surface straight below `from` (looking down at most `range`), or null. */
  floorBelow(from: THREE.Vector3, range: number): number | null;
  /** Distance and surface normal of the first obstacle from `from` along the unit `direction` within `range`, or null. */
  obstacle(from: THREE.Vector3, direction: THREE.Vector3, range: number): { distance: number; normal: THREE.Vector3 } | null;
}

/** Where feet at `feet` stand: on the floor under them (climbing up to a step), else falling to the next floor or `ground`. */
export function standOn(feet: THREE.Vector3, world: WalkWorld, ground: number): number {
  const floor = world.floorBelow(new THREE.Vector3(feet.x, feet.y, feet.z + STEP_UP), 1e6);
  return floor ?? ground;
}

/**
 * One step of walking: the feet at `feet` try to move by the horizontal `move`. Walls (anything met at knee or chest
 * height) stop the body `BODY_RADIUS` short, and the body slides along them; low steps are climbed, and the feet then
 * settle on the floor below (up a step, or down to a lower floor). Returns the new position of the feet.
 */
export function walkStep(feet: THREE.Vector3, move: THREE.Vector3, world: WalkWorld, ground: number): THREE.Vector3 {
  const flat = new THREE.Vector3(move.x, move.y, 0);
  const result = feet.clone();
  for (let attempt = 0; attempt < 3 && flat.lengthSq() > 1e-6; attempt++) {
    const length = flat.length();
    const direction = flat.clone().divideScalar(length);
    let nearest: { distance: number; normal: THREE.Vector3 } | null = null;
    for (const height of [STEP_UP + 50, 1300]) {
      const hit = world.obstacle(new THREE.Vector3(result.x, result.y, result.z + height), direction, length + BODY_RADIUS / MIN_COS);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    if (!nearest) {
      result.add(flat);
      break;
    }
    // Go as far as keeps the body clear of the wall (measured square to it), then slide along it with what is left.
    const cos = Math.max(MIN_COS, -direction.dot(nearest.normal));
    const allowed = Math.max(0, nearest.distance - BODY_RADIUS / cos);
    if (allowed >= length) {
      result.add(flat);
      break;
    }
    result.addScaledVector(direction, Math.min(allowed, length));
    const normal = new THREE.Vector3(nearest.normal.x, nearest.normal.y, 0);
    if (normal.lengthSq() < 1e-6) break;
    normal.normalize();
    flat.multiplyScalar(Math.max(0, length - allowed) / length);
    flat.addScaledVector(normal, -flat.dot(normal));
  }
  result.z = standOn(result, world, ground);
  return result;
}

/** A `WalkWorld` made by casting rays against meshes (in world space). */
export function raycastWorld(meshes: () => THREE.Object3D[]): WalkWorld {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, 0, -1);
  return {
    floorBelow(from, range) {
      ray.set(from, down);
      ray.far = range;
      const hit = ray.intersectObjects(meshes(), false)[0];
      return hit ? hit.point.z : null;
    },
    obstacle(from, direction, range) {
      ray.set(from, direction);
      ray.far = range;
      const hit = ray.intersectObjects(meshes(), false)[0];
      if (!hit) return null;
      const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : direction.clone().negate();
      // A face seen from behind still blocks; its normal should face the walker.
      if (normal.dot(direction) > 0) normal.negate();
      return { distance: hit.distance, normal };
    },
  };
}
