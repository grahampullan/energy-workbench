# ADR 0005: Runtime preparation

**Status:** Accepted

**Date:** 2026-08-03

## Context

The term "compile" suggests source-code translation and obscures the small,
deterministic transformation needed between study JSON and runtime objects.

## Decision

- Name the boundary `prepareRuntimeModel` and the phase runtime preparation.
- Name the component hook `ComponentDefinition.model.prepare`.
- Validate detached model and scenario snapshots before preparing components.
- Fill declared parameter and initial-state defaults, resolve exact definitions
  and connections, and keep component-owned prepared data in
  `RuntimeComponent.modelData`.
- Require `model.prepare` to return a JSON-compatible plain object.
- Return diagnostics for invalid input or component-contract failures.
- Keep file loading, state initialisation, caching, code generation, and
  simulation outside runtime preparation.

This supersedes the compilation terminology in ADR 0003; its separation of
`ModelComponent`, `ComponentDefinition`, and `RuntimeComponent` remains in
force.

## Consequences

Preparation is a small, synchronous, browser/Node-equivalent operation. The
persisted documents remain unchanged, and each run receives isolated prepared
data and resolved connections.
