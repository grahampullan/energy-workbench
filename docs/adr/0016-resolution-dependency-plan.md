# ADR 0016: Resolution-dependency plan

**Status:** Accepted

**Date:** 2026-08-15

## Context

Component-owned resolution kept governing physics in visible components, but
the runtime discovered calculation order by repeatedly calling every unresolved
component. That was adequate for fixed reference models but could not explain
whether an interactively assembled topology had missing, conflicting, or
cyclic flow determination.

## Decision

- Require every `ComponentDefinition` to provide a `resolution` contract.
- Continue to publish capabilities through `model.getOperatingLimits`; do not
  duplicate its individual field names in dependency metadata.
- Use `resolution.describe` to declare current target and settled-flow
  prerequisites and the connection flows the component determines.
- Build and check the resolution-dependency graph after current capabilities
  and policy roles are known for a timestep.
- Reject missing or multiple connection-flow determiners, absent prerequisites,
  declaration mismatches, and same-step cycles.
- Execute component resolution in topologically ordered stages and retain that
  plan in the timestep result.
- Keep all governing equations in `model.resolve`; declarations contain only
  dependency metadata.

## Consequences

The generic runtime can validate and explain calculation order without knowing
component types or becoming a constraint solver. Dynamic roles such as a
policy-selected balancing component remain supported because declarations are
evaluated against the current operation. Component authors must keep the small
declaration consistent with `model.resolve`, and the runtime checks the flows
actually settled against it.

This supersedes the retry-based order-discovery portion of ADR 0015 with a
checked dependency plan. Its component-ownership and explicit-forward
decisions remain unchanged.
