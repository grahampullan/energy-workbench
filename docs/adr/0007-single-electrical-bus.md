# ADR 0007: Single electrical bus

**Status:** Accepted

**Date:** 2026-08-04

## Context

The direct source-to-load resolver cannot represent the branching structure of
the legacy electrical demo. A single-port battery also requires an unambiguous
signed-flow convention for bidirectional connections.

## Decision

- Add an `electrical.bus` component with four bidirectional terminals, matching
  the four grid, PV, load, and battery attachments required by Push 1A.
- Sign connection `powerKw` from the persisted `from` endpoint towards `to`.
- Keep directed-port flow non-negative in its declared direction.
- Sign bidirectional-port flow positive for component export and negative for
  component import.
- Resolve one star network in which every electrical connection joins the bus
  to one external component and each bus terminal has at most one connection.
- Balance all fixed external powers together and adjust one controllable
  component within its operating limits to remove the residual.
- Reject zero or multiple buses, bus-to-bus or external-to-external links, and
  multiple controllable components explicitly.

This supersedes the direct-topology restriction in ADR 0006. Its timestep,
evaluation, balance-check, and state-commit contracts remain in force.

## Consequences

The runtime now supports real branching without introducing hidden dispatch
priority. Grid and fixed PV can be added next; battery dispatch will explicitly
extend the policy and resolver before allowing a second controllable component.
