# ADR 0013: Restricted coupled resolver

**Status:** Accepted

**Date:** 2026-08-13

## Context

Push 1B must run the electric heater, hot-water store, heat demand, and ambient
loss through the same deterministic timestep path as the electrical model. A
general thermal bus, hydraulic network, or optimisation layer is outside the
current scope.

## Decision

- Select the existing electrical-bus resolver when a runtime model has no
  thermal ports.
- When thermal ports are present, require exactly one serial topology:

  ```text
  electrical bus -> electric heater -> hot-water store -> heat demand
                                        |
                                        +-> ambient boundary
  ```

- Use `createHeatDemandFollowingPolicy` to request heater electrical input equal
  to current heat demand divided by the heater's declared conversion.
- Keep this as a request. The coupled resolver clamps actual heater operation by
  electrical input, heat output, store charge capacity, and heater/store
  temperature compatibility.
- Allocate store discharge up to current useful energy and demand. Allocate
  standing loss to the ambient boundary, then pass the heater's feasible
  electrical input to the existing electrical-bus resolver for residual grid
  balance.
- Make store, demand, and ambient commands resolver-owned. A policy cannot
  independently assign their physical flows.
- Put both signed `powerKw` and non-negative `heatOutputKw` in the heater actual
  command. The heater evaluation verifies their conversion relationship.
- Check both endpoint heat rate and boundary temperatures against every
  allocated thermal connection flow before committing state.

## Consequences

Electrical-only behaviour and results remain unchanged. The coupled path makes
requested, feasible, and actual heater operation visible and produces served
and unmet heat without a second simulation path. Only the named serial topology
is supported; another heater, store, demand, thermal branch, or junction must be
introduced with an explicit resolver decision rather than accidental generic
behaviour.
