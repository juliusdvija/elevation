import type { Viewport } from '../viewport/Viewport';
import { kindColor, type InferredPoint } from './inference';
import { GuideLines, PreviewLines, type SnapMarker } from './overlay';

/** Shows an inferred point: snap marker and label, dotted guides, reference edge. */
export class InferenceFeedback {
  private readonly guides: GuideLines;
  private readonly reference: PreviewLines;

  constructor(
    viewport: Viewport,
    private readonly marker: SnapMarker,
  ) {
    this.guides = new GuideLines(viewport);
    this.reference = new PreviewLines(viewport);
  }

  show(point: InferredPoint | null): void {
    if (!point) return this.clear();
    this.marker.show(point.point, point.kind, point.label);
    this.guides.set(point.guides);
    this.reference.set(point.reference ? [point.reference] : [], kindColor('parallel'));
  }

  clear(): void {
    this.marker.hide();
    this.guides.clear();
    this.reference.clear();
  }
}
