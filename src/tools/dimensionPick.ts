import * as THREE from 'three';
import { dimensionShape } from '../drawing/dimensions';
import type { ToolContext } from './Tool';

const LINE_TOLERANCE = 10; // px from the dimension line
const LABEL_TOLERANCE = 22; // px from the middle of the dimension, where its label sits

/** The dimension under the cursor (its line or its label), or null. Dimensions float above the model, so they win over what is behind them. */
export function dimensionAt(ctx: ToolContext, clientX: number, clientY: number): string | null {
  const cursor = new THREE.Vector3(clientX, clientY, 0);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const d of ctx.doc.drawingSettings.dimensions) {
    const s = dimensionShape(d);
    const p = ctx.viewport.toScreen(s.a2);
    const q = ctx.viewport.toScreen(s.b2);
    if (!p || !q) continue;
    const line = new THREE.Line3(new THREE.Vector3(p.x, p.y, 0), new THREE.Vector3(q.x, q.y, 0));
    const onLine = line.closestPointToPoint(cursor, true, new THREE.Vector3()).distanceTo(cursor);
    const mid = ctx.viewport.toScreen(s.mid);
    const onLabel = mid ? Math.hypot(mid.x - clientX, mid.y - clientY) : Infinity;
    const distance = Math.min(onLine <= LINE_TOLERANCE ? onLine : Infinity, onLabel <= LABEL_TOLERANCE ? onLabel : Infinity);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = d.id;
    }
  }
  return best;
}

/** Removes dimensions from the document as one undoable step. */
export function deleteDimensions(ctx: ToolContext, ids: Iterable<string>): void {
  const gone = new Set(ids);
  if (gone.size === 0) return;
  const next = structuredClone(ctx.doc.drawingSettings);
  next.dimensions = next.dimensions.filter((d) => !gone.has(d.id));
  ctx.doc.updateDrawingSettings(gone.size === 1 ? 'Delete Dimension' : 'Delete Dimensions', next);
}
