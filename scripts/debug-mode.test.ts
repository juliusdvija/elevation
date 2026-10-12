import { it } from 'vitest';
import * as THREE from 'three';
import { fuzz } from '../src/kernel/fuzz';
import { faceInteriorPoint } from '../src/kernel/faces';
import { pointInsideSolid } from '../src/kernel/solid';
const fmt = (m: any, v: number) => `${v}(${m.position(v).toArray().map((x: number) => x.toFixed(0))})`;
it('mode', () => {
  fuzz(4, 30, { solids: true, inspect: (m, step) => {
    if (step !== 2) return;
    for (const f of m.allFaces()) console.log(`face ${f.id} n=${f.normal.toArray().map(Math.round)} ${f.outer.map((v: number) => fmt(m, v)).join(' ')}${f.holes.length ? ' HOLES' : ''}`);
    const face48 = m.face(48);
    const c = faceInteriorPoint(m, face48)!;
    console.log('center of 48', c.toArray().map(Math.round), 'inside ahead', pointInsideSolid(m, c.clone().addScaledVector(face48.normal, 1)), 'behind', pointInsideSolid(m, c.clone().addScaledVector(face48.normal, -1)));
  } });
});
