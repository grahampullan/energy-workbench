# ADR 0015: Component-owned resolution

**Status:** Partly superseded by ADR 0016

**Date:** 2026-08-13

## Context

The electrical-bus and coupled-model resolvers made invisible runtime code the
source of bus, grid, heater, and store behaviour. That split component physics
across two places and selected whole-model algorithms by component type.

## Decision

- Require each `ComponentDefinition.model` to implement `resolve` as well as
  preparation, limits, evaluation, and state behaviour.
- Have policy return `{ targets, balancingComponentId }`. Policy chooses intent
  and roles; components enforce feasibility.
- Let `resolve` return `{ feasibleCommand, actualCommand, connectionFlows }`, or
  `null` while waiting for an upstream connection flow.
- Revisit unresolved components only until this finite dataflow stops making
  progress. Do not add numerical iteration or a general constraint solver.
- Permit one component to settle each connection. Treat a second settlement as
  over-specification, then verify both evaluated endpoint flows against the
  settled flow.
- Keep the electrical conservation equation in the visible bus, the coupled
  thermal equation in the store, conversion in the heater, and capability
  checks in the selected balancing component.
- Keep runtime orchestration independent of component type and remove the
  electrical-bus, coupled-model, and whole-model resolver modules.

## Consequences

The existing electrical and thermal results remain unchanged, but component
definitions are now the only source of governing physics. A new topology is
introduced through visible components and their contracts, not a runtime
solver branch. Unsupported or cyclic dependencies fail explicitly.

This supersedes ADR 0013 and the model-specific resolver or automatic-grid
ownership portions of ADRs 0003, 0006–0008, 0010, and 0014. Their remaining
document, flow-type, sign, timestep, and requested/feasible/actual decisions
still apply.
