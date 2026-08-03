# ADR 0006: Fixed-timestep electrical runtime

**Status:** Accepted

**Date:** 2026-08-03

## Context

The first executable runtime must fix command, state, and balance semantics
without anticipating the full electrical bus and storage resolver.

## Decision

- Run the shared runtime synchronously through
  `runScenario({ model, scenario, policy, registry, options })`.
- Treat active-power command `powerKw` as positive export and negative import.
- Keep policy-requested, limit-clamped feasible, and balance-allocated actual
  commands distinct in results.
- Require component initialisation to return the declared state fields.
- Give each fixed step explicit seconds, hours, elapsed time, current series
  values, and isolated current state.
- Require evaluation to return port flows, declared outputs, proposed next
  state, and diagnostics.
- Treat port flow as non-negative in the port's declared direction and verify
  both ends of each connection against the resolver allocation.
- Commit state only after all component evaluations and connection balances
  pass. A failed run returns diagnostics and no partial results.
- Require external scenario series to be materialised before execution.
- Limit the first resolver to independent direct electrical source-to-fixed-load
  connections. Reject branching topology explicitly.

## Consequences

The source/load slice is deterministic and tests the full runtime order without
pretending to solve buses or storage. Later Push 1A components will introduce a
resolver for branching networks and dispatch while preserving the established
requested/feasible/actual, evaluation, and state-commit boundaries.
