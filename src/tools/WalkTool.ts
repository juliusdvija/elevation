import * as THREE from 'three';
import type { Tool, ToolContext } from './Tool';
import { EYE_HEIGHT, raycastWorld, standOn, walkStep } from './walk';

const WALK_SPEED = 1400; // mm per second
const RUN_FACTOR = 2.5;
const TURN_SPEED = 1.6; // radians per second (arrow keys)
const LOOK_SPEED = 0.0025; // radians per pixel
const GRAVITY = 9810; // mm/s²

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ']);

/**
 * Walk through the model at eye height, like a visitor: the mouse looks around (click to capture it, Esc frees
 * it), W A S D or the arrow keys walk, Shift runs. The feet follow floors, climb steps and stairs, fall to lower
 * floors, and walls stop the body (see `walk.ts`). On a touch screen, drag to look and use the joystick to walk.
 */
export function createWalkTool(ctx: ToolContext): Tool {
  const { viewport } = ctx;
  const world = raycastWorld(() => ctx.renderer.pickMeshes);
  const pressed = new Set<string>();
  const feet = new THREE.Vector3();
  let eyeZ = 0;
  let fall = 0;
  let yaw = 0;
  let pitch = 0;
  let frame = 0;
  let last = 0;
  let dragging: { x: number; y: number } | null = null;
  const stick = { x: 0, y: 0 };
  const joystick = createJoystick(stick);

  const ground = () => 0;

  const place = () => {
    const rig = viewport.rig;
    const look = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch));
    rig.position.set(feet.x, feet.y, eyeZ);
    rig.target.copy(rig.position).addScaledVector(look, 1000);
    rig.update();
    viewport.requestRender();
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const forward = (pressed.has('w') || pressed.has('arrowup') ? 1 : 0) - (pressed.has('s') || pressed.has('arrowdown') ? 1 : 0) + -stick.y;
    const side = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0) + stick.x;
    yaw += ((pressed.has('arrowright') ? 1 : 0) - (pressed.has('arrowleft') ? 1 : 0)) * TURN_SPEED * dt;
    const speed = WALK_SPEED * (pressed.has('shift') ? RUN_FACTOR : 1) * dt;
    const ahead = new THREE.Vector3(Math.sin(yaw), Math.cos(yaw), 0);
    const right = new THREE.Vector3(Math.cos(yaw), -Math.sin(yaw), 0);
    const move = ahead.multiplyScalar(forward).addScaledVector(right, side);
    if (move.lengthSq() > 1) move.normalize();
    move.multiplyScalar(speed);
    const before = feet.clone();
    feet.copy(walkStep(feet, move, world, ground()));
    // The eye rises quickly up a step and falls with gravity down a drop.
    const wanted = feet.z + EYE_HEIGHT;
    if (wanted >= eyeZ) {
      eyeZ += (wanted - eyeZ) * Math.min(1, dt * 12);
      fall = 0;
    } else {
      fall += GRAVITY * dt;
      eyeZ = Math.max(wanted, eyeZ - fall * dt);
    }
    const moved = !feet.equals(before) || Math.abs(wanted - eyeZ) > 0.5 || forward !== 0 || side !== 0 || pressed.has('arrowleft') || pressed.has('arrowright');
    if (moved) place();
    frame = requestAnimationFrame(tick);
  };

  const keyUp = (e: KeyboardEvent) => pressed.delete(e.key.toLowerCase());
  const blur = () => pressed.clear();
  const mouseLook = (e: MouseEvent) => {
    if (document.pointerLockElement !== viewport.canvas) return;
    turn(e.movementX, e.movementY);
  };
  const turn = (dx: number, dy: number) => {
    yaw += dx * LOOK_SPEED;
    pitch = THREE.MathUtils.clamp(pitch - dy * LOOK_SPEED, -1.4, 1.4);
    place();
  };

  return {
    id: 'walk',
    label: 'Walk',
    shortcut: 'G',
    hint: 'Click to look around with the mouse (Esc frees it). W A S D or the arrow keys walk, Shift runs. Steps and stairs are climbed; walls stop you.',
    cursor: 'crosshair',

    activate() {
      const rig = viewport.rig;
      if (rig.isOrtho) rig.toggleProjection();
      // Start where the camera is, looking the same way, with the feet on the floor below (or the ground).
      const direction = rig.direction();
      yaw = Math.atan2(direction.x, direction.y);
      pitch = 0;
      feet.set(rig.position.x, rig.position.y, rig.position.z);
      feet.z = standOn(new THREE.Vector3(feet.x, feet.y, rig.position.z - 300), world, ground());
      eyeZ = feet.z + EYE_HEIGHT;
      place();
      window.addEventListener('keyup', keyUp);
      window.addEventListener('blur', blur);
      document.addEventListener('mousemove', mouseLook);
      viewport.container.append(joystick.el);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },

    deactivate() {
      cancelAnimationFrame(frame);
      pressed.clear();
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      document.removeEventListener('mousemove', mouseLook);
      if (document.pointerLockElement === viewport.canvas) document.exitPointerLock();
      joystick.el.remove();
    },

    pointerDown(e) {
      if (e.pointerType === 'mouse') {
        void viewport.canvas.requestPointerLock?.();
        return;
      }
      dragging = { x: e.clientX, y: e.clientY };
    },

    pointerMove(e) {
      if (!dragging) return;
      turn(e.clientX - dragging.x, e.clientY - dragging.y);
      dragging = { x: e.clientX, y: e.clientY };
    },

    pointerUp() {
      dragging = null;
    },

    keyDown(e) {
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey || !MOVE_KEYS.has(key)) return false;
      pressed.add(key);
      return true;
    },

    cancel() {
      pressed.clear();
    },
  };
}

/** An on-screen joystick for touch screens (hidden with a mouse): drag the knob to walk. */
function createJoystick(stick: { x: number; y: number }): { el: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'walk-joystick';
  const knob = document.createElement('div');
  knob.className = 'walk-joystick-knob';
  el.append(knob);
  const radius = 44;
  let id: number | null = null;
  const update = (e: PointerEvent) => {
    const box = el.getBoundingClientRect();
    let x = (e.clientX - (box.left + box.width / 2)) / radius;
    let y = (e.clientY - (box.top + box.height / 2)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    stick.x = x;
    stick.y = y;
    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
  };
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    update(e);
    e.stopPropagation();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) update(e);
  });
  const release = () => {
    id = null;
    stick.x = stick.y = 0;
    knob.style.transform = '';
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  return { el };
}
