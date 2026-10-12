import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, WORLD_UP } from './CameraRig';

function project(rig: CameraRig, point: THREE.Vector3): THREE.Vector3 {
  return point.clone().project(rig.camera);
}

describe('CameraRig', () => {
  it('orbits around a pivot without changing the distance to it', () => {
    const rig = new CameraRig();
    const pivot = new THREE.Vector3(1000, 2000, 0);
    const before = rig.position.distanceTo(pivot);
    rig.orbit(pivot, 0.7, 0.2);
    expect(rig.position.distanceTo(pivot)).toBeCloseTo(before, 6);
  });

  it('never tilts past straight down', () => {
    const rig = new CameraRig();
    rig.orbit(rig.target.clone(), 0, 10);
    const dir = rig.direction();
    expect(dir.dot(WORLD_UP)).toBeLessThan(-0.999);
    expect(dir.dot(WORLD_UP)).toBeGreaterThan(-1);
    expect(Number.isFinite(rig.right().x)).toBe(true);
  });

  it('keeps the zoom point fixed on screen in both projections', () => {
    for (const ortho of [false, true]) {
      const rig = new CameraRig();
      rig.setAspect(1.5);
      if (ortho) rig.toggleProjection();
      const point = new THREE.Vector3(1500, 800, 300);
      const before = project(rig, point);
      rig.zoomAt(point, 0.6);
      const after = project(rig, point);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('keeps the target at the same size when switching projection', () => {
    const rig = new CameraRig();
    const offset = new THREE.Vector3().addVectors(rig.target, rig.screenUp().multiplyScalar(1000));
    const perspY = project(rig, offset).y;
    rig.toggleProjection();
    expect(project(rig, offset).y).toBeCloseTo(perspY, 6);
    rig.toggleProjection();
    expect(project(rig, offset).y).toBeCloseTo(perspY, 6);
  });

  it('pans so the depth point follows the cursor', () => {
    const rig = new CameraRig();
    rig.setAspect(1);
    const point = rig.target.clone();
    const before = project(rig, point);
    rig.pan(100, 0, 1000, point);
    const after = project(rig, point);
    // 100px of a 1000px-high viewport is 0.2 in NDC.
    expect(after.x - before.x).toBeCloseTo(0.2, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('shows a top view with +Y up on screen and fits a box', () => {
    const rig = new CameraRig();
    rig.setView('top');
    const north = project(rig, rig.target.clone().add(new THREE.Vector3(0, 1000, 0)));
    expect(north.y).toBeGreaterThan(0);
    expect(Math.abs(north.x)).toBeLessThan(1e-6);

    const box = new THREE.Box3(new THREE.Vector3(-5000, -5000, 0), new THREE.Vector3(5000, 5000, 3000));
    rig.setView('iso');
    rig.fit(box);
    for (const corner of [box.min, box.max]) {
      const p = project(rig, corner.clone());
      expect(Math.abs(p.x)).toBeLessThan(1);
      expect(Math.abs(p.y)).toBeLessThan(1);
    }
  });
});
