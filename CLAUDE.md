# Elevation

SketchUp-style modeller whose differentiator is live, auto-updating 2D drawings (plans, sections, elevations) in a clean modern style. Read `docs/ARCHITECTURE.md` for how it works and why; add new design decisions to its decision log when you make them.

## Commands

- `npm run dev` — dev server (port 5173)
- `npm test` — unit tests (Vitest, `src/**/*.test.ts`)
- `npm run typecheck`, `npm run build`
- `npm run fuzz` — exploratory fuzzing (`SEEDS`, `STEPS`, `SOLIDS=1` env vars)

## Rules that keep the model sound

- Model changes only happen inside a journal: user edits go through `doc.run(label, fn)` (one undo step across all models); previews use `model.edit` or `tools/preview.ts` and revert.
- Kernel entities are immutable records; replace them, never mutate.
- Tools think in world coordinates and edit `doc.context.model` in local coordinates (`tools/space.ts`). Picks carry their `placement`; only entities in the context may be edited.
- After moving or creating geometry, call `settle` (or a kernel op that does) so it welds, splits, folds and merges.
- Units are millimetres, Z is up. Lengths shown to users go through `core/units.ts`.
- After any kernel change, run `npm test` and a fuzz run (`SEEDS=300 npm run fuzz`, also with `SOLIDS=1`). Add a regression test for every bug found.

## Dev aids

In the dev server, `window.__elevation` exposes `doc`, `model`, `picker`, `tools`, `loadSample()` (test building) and `validate()`.
