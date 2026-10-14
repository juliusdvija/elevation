import { createElement, ChevronLeft, ChevronRight, Footprints, Pause, Play, X, type IconNode } from 'lucide';
import type { Document } from '../document';
import type { Scene } from '../drawing/settings';
import type { Viewport } from '../viewport/Viewport';

export interface PresentationHost {
  root: HTMLElement;
  viewport: Viewport;
  doc: Document;
  /** Switches the photorealistic view on or off (and the toolbar button with it); returns whether it was on. */
  setRealistic(on: boolean): boolean;
  /** Flies the camera to a saved view over `ms` milliseconds. */
  flyTo(scene: Scene, ms: number): void;
  /** Activates a tool by id (the walk tool, or back to select). */
  activateTool(id: string): void;
  activeTool(): string | null;
}

/** How long a tour flies between views and rests on each (ms). */
const FLIGHT = 2600;
const REST = 4500;

function button(icon: IconNode, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'present-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(createElement(icon, { width: 18, height: 18, 'stroke-width': 1.75 }));
  return b;
}

/**
 * Presenting to a client: the app goes full screen with no toolbars, panels, selection or guides, in the
 * photorealistic view. A slim bar at the bottom names the project and the view, steps through the saved views with
 * a slow cinematic flight (arrow keys or space too), plays them as a tour, and starts a walk. Esc ends it and puts
 * everything back as it was.
 */
export class Presentation {
  private readonly bar = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly dots = document.createElement('div');
  private readonly tour = button(Play, 'Play the views as a tour');
  private readonly walk = button(Footprints, 'Walk through (W A S D, mouse to look)');
  private index = -1;
  private active = false;
  private wasRealistic = false;
  private toolBefore: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: PresentationHost) {
    this.bar.className = 'presentation-bar';
    this.title.className = 'presentation-title';
    this.dots.className = 'presentation-dots';
    const previous = button(ChevronLeft, 'Previous view (←)');
    const next = button(ChevronRight, 'Next view (→ or space)');
    const exit = button(X, 'End the presentation (Esc)');
    previous.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    this.tour.addEventListener('click', () => (this.timer ? this.stopTour() : this.startTour()));
    this.walk.addEventListener('click', () => this.toggleWalk());
    exit.addEventListener('click', () => this.exit());
    this.bar.append(this.title, previous, this.dots, next, this.tour, this.walk, exit);

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active) return;
        const walking = this.host.activeTool() === 'walk';
        if (e.key === 'Escape') {
          if (walking) this.toggleWalk();
          else this.exit();
        } else if (!walking && (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown')) this.step(1);
        else if (!walking && (e.key === 'ArrowLeft' || e.key === 'PageUp')) this.step(-1);
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true },
    );
    document.addEventListener('fullscreenchange', () => {
      if (this.active && !document.fullscreenElement) this.exit();
    });
    // The bar fades away while nothing moves, and comes back with the mouse.
    host.root.addEventListener('pointermove', () => this.wake());
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.wasRealistic = this.host.setRealistic(true);
    this.toolBefore = this.host.activeTool();
    this.host.root.classList.add('presenting');
    this.host.viewport.container.append(this.bar);
    this.host.viewport.cleanFrame(true);
    this.index = -1;
    this.renderDots();
    void this.host.root.requestFullscreen?.().catch(() => {});
    this.wake();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.stopTour();
    if (this.host.activeTool() === 'walk') this.host.activateTool(this.toolBefore && this.toolBefore !== 'walk' ? this.toolBefore : 'select');
    this.host.root.classList.remove('presenting');
    this.bar.remove();
    this.host.viewport.cleanFrame(false);
    if (!this.wasRealistic) this.host.setRealistic(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  private scenes(): Scene[] {
    return this.host.doc.drawingSettings.scenes;
  }

  private step(by: number): void {
    const scenes = this.scenes();
    if (scenes.length === 0) return;
    if (this.host.activeTool() === 'walk') this.toggleWalk();
    this.index = (((this.index + by) % scenes.length) + scenes.length) % scenes.length;
    this.host.flyTo(scenes[this.index], FLIGHT);
    this.renderDots();
  }

  private startTour(): void {
    this.tour.replaceChildren(createElement(Pause, { width: 18, height: 18, 'stroke-width': 1.75 }));
    this.tour.title = 'Pause the tour';
    const advance = () => {
      this.step(1);
      this.timer = setTimeout(advance, FLIGHT + REST);
    };
    advance();
  }

  private stopTour(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.tour.replaceChildren(createElement(Play, { width: 18, height: 18, 'stroke-width': 1.75 }));
    this.tour.title = 'Play the views as a tour';
  }

  private toggleWalk(): void {
    const walking = this.host.activeTool() === 'walk';
    if (!walking) this.stopTour();
    this.host.activateTool(walking ? 'select' : 'walk');
    this.walk.setAttribute('aria-pressed', String(!walking));
  }

  private renderDots(): void {
    const scenes = this.scenes();
    this.dots.replaceChildren(
      ...scenes.map((scene, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'presentation-dot';
        dot.title = scene.name;
        dot.setAttribute('aria-pressed', String(i === this.index));
        dot.addEventListener('click', () => {
          this.index = i - 1;
          this.step(1);
        });
        return dot;
      }),
    );
    const view = this.index >= 0 ? scenes[this.index]?.name : null;
    this.title.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: this.host.doc.name || 'Untitled' }),
      ...(view ? [Object.assign(document.createElement('span'), { textContent: view })] : []),
    );
  }

  private wake(): void {
    if (!this.active) return;
    this.bar.classList.remove('asleep');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.bar.classList.add('asleep'), 3000);
  }
}
