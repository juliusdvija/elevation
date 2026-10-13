import { Model, type Id } from './Model';
import { faceContainsPoint, type RegionDecision, newellNormal, rebuildPlane } from './faces';
import { canonicalPlane, planeFrame, planeFromPointNormal, pointInPolygon, samePlane, to2D } from './math';

/** Edges that border exactly one face: the rim of an opening. */
function openEdges(model: Model): Id[] {
  return model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 1).map((e) => e.id);
}

/** Whether the model has no openings: every edge with faces borders at least two. */
export function isClosed(model: Model): boolean {
  return openEdges(model).length === 0;
}

/**
 * Whether the only openings are the face's own rim: a face drawn on or beside a
 * solid, about to be pulled into it. Pulling it must leave a closed model.
 */
export function isClosedExcept(model: Model, faceEdges: readonly Id[]): boolean {
  const rim = new Set(faceEdges);
  return openEdges(model).every((id) => rim.has(id));
}

/** Off-plane tolerance (mm) for a loop to count as flat. */
const FLAT = 0.01;

/**
 * Closes the openings an edit left in a model that was closed before it (call
 * with `wasClosed`): each loop of open edges that lies flat gets a face. Pushing
 * a face through a solid leaves what was attached to it as a shell; this puts the
 * missing cap back so it stays a solid. Loops that are not flat, or branch, stay open.
 */
export function closeOpenings(model: Model, wasClosed: boolean): number {
  if (!wasClosed || openEdges(model).length === 0) return 0;
  // Try it on a copy first: keep the result only if it leaves fewer broken edges and no new ones with three faces.
  const trial = new Model();
  trial.load(model.toData());
  const before = badEdges(trial);
  const done = trial.edit(() => capLoops(trial)).result;
  if (done === 0 || badEdges(trial) >= before || trial.allEdges().some((e) => trial.facesOfEdge(e.id).length > 2)) return 0;
  return capLoops(model);
}

/** Edges that are not shared by exactly two faces (open rims, or three-way joints). */
function badEdges(model: Model): number {
  return model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 1 || model.facesOfEdge(e.id).length > 2).length;
}

function capLoops(model: Model): number {
  const open = openEdges(model);

  // Group the open edges into connected components by shared vertices.
  const at = new Map<Id, Id[]>();
  for (const id of open) {
    const e = model.edge(id);
    for (const v of [e.a, e.b]) (at.get(v) ?? at.set(v, []).get(v)!).push(id);
  }
  const seen = new Set<Id>();
  let closed = 0;
  for (const start of open) {
    if (seen.has(start)) continue;
    const component: Id[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const id = queue.pop()!;
      component.push(id);
      const e = model.edge(id);
      for (const v of [e.a, e.b]) for (const next of at.get(v)!) if (!seen.has(next)) (seen.add(next), queue.push(next));
    }
    // A simple loop: every vertex has exactly two open edges.
    const vertices = new Set<Id>();
    for (const id of component) {
      const e = model.edge(id);
      vertices.add(e.a);
      vertices.add(e.b);
    }
    if (component.length < 3 || [...vertices].some((v) => at.get(v)!.length !== 2)) continue;

    const points = orderLoop(model, component).map((v) => model.position(v));
    const normal = newellNormal(points);
    if (normal.length() < 1e-6) continue;
    normal.normalize();
    if (points.some((p) => Math.abs(p.clone().sub(points[0]).dot(normal)) > FLAT)) continue;
    const plane = canonicalPlane(planeFromPointNormal(points[0], normal));
    // Only the loop itself gets a face: another region that happens to border one of
    // its edges (the mouth of a slot) must not turn into a face as well.
    const frame = planeFrame(plane);
    const outline = points.map((p) => to2D(frame, p));
    const decide: RegionDecision = (sample) => {
      if (pointInPolygon(to2D(frame, sample), outline)) return undefined;
      const existing = model.allFaces().some((f) => samePlane(model.facePlane(f), plane) && faceContainsPoint(model, f, sample));
      return existing ? undefined : null;
    };
    rebuildPlane(model, plane, new Set(component), decide);
    closed++;
  }
  return closed;
}

/** Vertices of a loop of edges, in order. */
function orderLoop(model: Model, edges: Id[]): Id[] {
  const first = model.edge(edges[0]);
  const order = [first.a];
  let current = first.b;
  const used = new Set<Id>([edges[0]]);
  while (current !== first.a) {
    order.push(current);
    const next = edges.find((id) => !used.has(id) && (model.edge(id).a === current || model.edge(id).b === current));
    if (next === undefined) break;
    used.add(next);
    const e = model.edge(next);
    current = e.a === current ? e.b : e.a;
  }
  return order;
}
