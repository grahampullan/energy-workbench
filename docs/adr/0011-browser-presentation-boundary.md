# ADR 0011: Browser presentation boundary

**Status:** Accepted

**Date:** 2026-08-10

## Context

The first browser slice needs the legacy example's topology, component
inspector, and timestep navigation. It must exercise the new model contracts
and runtime rather than recreate behaviour from the old visual modeller.
`board-box` provides the canvas and box mechanics, but it should not become a
dependency of the model or simulation layers.

## Decision

- Load the committed model, scenario, and layout documents at the browser
  composition boundary.
- Register the same component definitions and call the same `runScenario`
  function used by Node tests.
- Derive graph labels and inspector values from canonical run results through a
  pure presentation helper.
- Generate inspector fields and units from registered component definition
  metadata.
- Allow component movement and resizing as an in-memory layout draft. These
  interactions neither mutate saved documents nor rerun the simulation, and a
  reload restores the committed layout.
- Use the current stable `board-box` package behind one `src/ui` adapter. Its
  objects do not cross into `core`, `runtime`, components, policies, or saved
  documents.
- Bundle the browser entry point only to make the shared AJV-backed validation
  and npm dependencies browser-compatible. Source modules remain the authored
  boundary; generated build output is not committed.
- Treat the old demo's `board-box` version as provenance only. Reusable generic
  canvas changes belong upstream in `board-box`; Energy Workbench behaviour
  remains in this repository.

## Consequences

The initial UI is model-read-only and has no second simulation path or
engineering equations. Timeline changes are cheap projections of one completed
run. Layout interaction is intentionally ephemeral until Apply, Reset, and Save
commands are introduced. Future editing and preview scheduling can replace the
browser coordinator without changing the canvas boundary or canonical result
contract.
