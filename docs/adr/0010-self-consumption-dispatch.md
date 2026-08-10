# ADR 0010: Self-consumption dispatch

**Status:** Accepted

**Date:** 2026-08-04

## Context

The PV-battery policy needs current fixed PV and load power to choose battery
operation. Recalculating those values from series and component parameters
inside the policy would duplicate component equations. Calling component
behavior directly from the policy would also bypass the runtime's error and
contract handling.

## Decision

- Evaluate component operating limits once at the start of each timestep,
  before requesting policy operation.
- Pass policies a detached, read-only
  `policyContext.operatingLimitsByComponentId` snapshot.
- Keep requested, feasible, and actual operation distinct. A policy can inspect
  limits, but the resolver still clamps requests and owns bus balance.
- Add `createPvBatterySelfConsumptionPolicy({ batteryComponentId })`.
- Require every component other than the bus, grid, and target battery to have
  fixed operation for this policy.
- Sum those fixed powers and request the opposite signed power from the
  battery. The residual grid absorbs any battery power or energy shortfall.

This supersedes ADR 0003's policy-before-limits evaluation order. Its component
ownership and requested/feasible/actual contracts remain in force.

## Consequences

The policy reproduces the legacy priority without containing PV, load, battery,
or grid equations: fixed generation serves fixed demand, surplus charges before
grid export, and the battery discharges before grid import. Existing policies
that accept only the first two request arguments remain compatible in
JavaScript. Adding another controllable device requires a new explicit dispatch
policy rather than relying on component order.
