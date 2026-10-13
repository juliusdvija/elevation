import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel, guessUnit, meshSize, parseObj, UNITS } from '../src/io/obj';
import { validateModel } from '../src/kernel/validate';

// Imports a real OBJ and reports what came out: OBJ=path/to/file.obj [MTL=file.mtl] OBJ=file.obj npm run import-check
it('imports a real OBJ', () => {
  const path = process.env.OBJ;
  if (!path) return;
  const mtlPath = process.env.MTL ?? path.replace(/\.obj$/i, '.mtl');
  let mtl: string | undefined;
  try { mtl = readFileSync(mtlPath, 'utf8'); } catch { /* none */ }
  let t = performance.now();
  const mesh = parseObj(readFileSync(path, 'utf8'), mtl);
  console.log(`parsed ${mesh.positions.length} vertices, ${mesh.faces.length} polygons in ${(performance.now() - t).toFixed(0)} ms; size`, meshSize(mesh).map(Math.round));
  const unit = guessUnit(mesh);
  console.log('unit', unit);
  t = performance.now();
  const model = buildModel(mesh, { scale: UNITS.find((u) => u.id === unit)!.mm, yUp: true });
  console.log(`built ${model.faceCount} faces, ${model.edgeCount} edges, ${model.vertexCount} vertices in ${(performance.now() - t).toFixed(0)} ms`);
  const bad = model.allEdges().filter((e) => model.facesOfEdge(e.id).length === 1).length;
  const three = model.allEdges().filter((e) => model.facesOfEdge(e.id).length > 2).length;
  console.log('open edges', bad, 'edges with >2 faces', three, 'painted', model.allFaces().filter((f) => f.color).length);
  const problems = validateModel(model);
  const kinds = new Map<string, number>();
  for (const p of problems) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  console.log('validate:', problems.length, Object.fromEntries(kinds));
}, 600_000);
