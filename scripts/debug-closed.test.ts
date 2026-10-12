import { it } from 'vitest';
import { fuzz } from '../src/kernel/fuzz';
const fmt = (m: any, v: number) => `${v}(${m.position(v).toArray().map((x: number) => x.toFixed(0))})`;
it('closed', () => {
  const f = fuzz(Number(process.env.SEED), 30, { solids: true })!;
  const m = f.model;
  console.log(f.log.join('\n'));
  console.log(f.problems.slice(0, 2).map((p) => `${p.kind}: ${p.detail}`).join('\n'));
  for (const e of m.allEdges()) {
    const faces = m.facesOfEdge(e.id);
    if (faces.length !== 2) console.log(`edge ${e.id} ${fmt(m, e.a)}-${fmt(m, e.b)} faces ${faces.map((id: number) => `${id}[${m.face(id).normal.toArray().map(Math.round)}]`).join(' ')}`);
  }
  for (const face of m.allFaces()) console.log(`face ${face.id} n=${face.normal.toArray().map(Math.round)} ${face.outer.map((v: number) => fmt(m, v)).join(' ')}${face.holes.length ? ' holes ' + face.holes.map((h: number[]) => h.map((v) => fmt(m, v)).join(' ')).join(' / ') : ''}`);
});
