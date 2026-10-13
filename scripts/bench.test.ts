import { it } from 'vitest';
import * as THREE from 'three';
import { Model } from '../src/kernel/Model';
import { pushPull } from '../src/kernel/pushPull';
import { transformVertices, verticesOf } from '../src/kernel/transform';
import { computeDrawing } from '../src/drawing/project';
import { viewSetup } from '../src/drawing/views';
import { DEFAULT_SETTINGS, allViews } from '../src/drawing/settings';
import { validateModel } from '../src/kernel/validate';
import { house, time } from './benchModel';

// Performance benchmark: `npm run bench` (GRID=n, default 2,4,6). Builds a grid of
// n x n small houses (a box with two window recesses each) and times the operations
// that matter while editing: one push/pull, one move, each drawing, validation.
it('benchmark', () => {
  const sizes = (process.env.GRID ?? '2,4,6').split(',').map(Number);
  const rows: string[] = [];
  for (const n of sizes) {
    const m = new Model();
    const [, build] = time(() => {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) house(m, i * 5000, j * 5000);
    });
    const faces = m.faceCount;
    const bounds = m.bounds();
    const views = allViews(DEFAULT_SETTINGS);
    const drawing = (kind: string) => {
      const ref = views.find((x) => x.kind === kind)!;
      return time(() => computeDrawing(m, viewSetup(ref, DEFAULT_SETTINGS, bounds)))[1];
    };
    const shaded = (() => {
      const ref = views.find((x) => x.kind === 'front')!;
      return time(() => computeDrawing(m, viewSetup(ref, DEFAULT_SETTINGS, bounds), { shading: true }))[1];
    })();
    const plan = drawing('plan');
    const elevation = drawing('front');
    const section = drawing('section');
    const [, validate] = time(() => validateModel(m));
    const top = m.allFaces().find((f) => f.normal.z > 0.99)!;
    const [, push] = time(() => m.edit(() => pushPull(m, top.id, 500)).edit.revert());
    const [, move] = time(() => m.edit(() => transformVertices(m, verticesOf(m, [top.id], []), new THREE.Matrix4().makeTranslation(0, 0, 300))).edit.revert());
    rows.push(`${String(n * n).padStart(4)} houses ${String(faces).padStart(6)} faces | build ${(build / 1000).toFixed(1)}s | push/pull ${push.toFixed(0)}ms | move ${move.toFixed(0)}ms | plan ${plan.toFixed(0)}ms | elevation ${elevation.toFixed(0)}ms (shaded ${shaded.toFixed(0)}ms) | section ${section.toFixed(0)}ms | validate ${validate.toFixed(0)}ms`);
    console.log(rows.at(-1));
  }
  console.log('\nBENCH\n' + rows.join('\n'));
}, 1_800_000);
