# Elevation

SketchUp-style modeller whose differentiator is live, auto-updating 2D drawings (plans, sections, elevations) in a clean modern style. Read `docs/ARCHITECTURE.md` for how it works and why; add new design decisions to its decision log when you make them.

## Commands

- `npm run dev` — dev server (port 5173)
- `npm test` — unit tests (Vitest, `src/**/*.test.ts`)
- `npm run typecheck`, `npm run build`
- `npm run fuzz` — exploratory fuzzing (`SEEDS`, `STEPS`, `SOLIDS=1` env vars)
- `npm run bench` — timings on a grid of small houses (`GRID=6,10,16`); run it after touching the kernel's hot paths

## Rules that keep the model sound

- Model changes only happen inside a journal: user edits go through `doc.run(label, fn)` (one undo step across all models); previews use `model.edit` or `tools/preview.ts` and revert.
- Kernel entities are immutable records; replace them, never mutate.
- Tools think in world coordinates and edit `doc.context.model` in local coordinates (`tools/space.ts`). Picks carry their `placement`; only entities in the context may be edited.
- After moving or creating geometry, call `settle` (or a kernel op that does) so it welds, splits, folds and merges.
- Units are millimetres, Z is up. Lengths shown to users go through `core/units.ts`.
- After any kernel change, run `npm test` and a fuzz run (`SEEDS=300 npm run fuzz`, also with `SOLIDS=1`). Add a regression test for every bug found.

## Dev aids

In the dev server, `window.__elevation` exposes `doc`, `model`, `picker`, `tools`, `loadSample()` (test building) and `validate()`.

## Roadmap side pane (keep it current)

The user follows progress in a live roadmap artifact, not in the terminal log. Treat it as part of the work:

- The data is in `docs/roadmap/roadmap.py` (`DATA`: stats, phases with items, and a short activity log). Each item is `(status, short description, commit)` with status `done | doing | next | later`; each phase has a header (`name`) and a one-line `blurb`.
- Update it whenever something starts, finishes, is dropped or is re-prioritised, and always before ending a turn in which work landed: mark the item `doing` when you start it, `done` with its commit when it lands, and refresh the "Now / Just finished / Known issue / Direction" log lines and the stats (tests passing, decisions logged).
- Descriptions are plain language a non-developer can follow: what the user can now do, not which functions changed.
- Publish: `python3 docs/roadmap/roadmap.py <scratchpad>/roadmap.html`, then publish that file with the Artifact tool to https://claude.ai/artifact/RA2SCFVDcE8cwgbrhi93Td (same file path keeps the URL).
- After a turn, summarise in the chat in a few plain sentences (what was done, what is next); details belong in the commit and the decision log.

