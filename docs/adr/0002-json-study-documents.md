# ADR 0002: JSON study documents

**Status:** Accepted

**Date:** 2026-07-31

## Context

Studies must be portable, reviewable, and useful with external Git. Layout
changes should not obscure engineering changes, and generated results should
not become source data accidentally.

## Decision

- JSON is the canonical format for project documents.
- Large time series may remain in referenced data files.
- Model, scenario, layout, variant, and run provenance are separate documents.
- Engineering objects use stable IDs; names are labels, not references.
- Layout contains no engineering parameters.
- JSON Schema validates structure. JavaScript validates references, component
  contracts, units, topology, limits, and physical plausibility.
- Generated `results/` directories are ignored by Git by default.

## Consequences

Moving a component does not modify the model. Structural and engineering errors
remain distinguishable. Save/reload and deterministic serialization become
part of the Push 1 contract.
