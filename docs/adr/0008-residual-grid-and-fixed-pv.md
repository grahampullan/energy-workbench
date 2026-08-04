# ADR 0008: Residual grid and fixed PV

**Status:** Accepted

**Date:** 2026-08-04

## Context

The single electrical bus needs grid and PV behavior before battery dispatch is
introduced. If both policy and the resolver can choose grid power, balancing
ownership is ambiguous. If the resolver chooses among several variable
components in array order, component order becomes a hidden dispatch policy.

## Decision

- Require exactly one `electrical.grid` boundary in the single-bus runtime.
- Give the resolver sole ownership of grid operation. The grid receives no
  policy request; its requested and feasible commands remain `null`.
- Fix all non-grid component operation first: equal operating limits prescribe
  fixed operation, while variable limits require an explicit policy request and
  produce a clamped feasible command.
- Set actual grid power to the remaining bus residual. Positive grid power is
  import into the model and negative grid power is export.
- Fail the timestep when the residual exceeds the grid import or export limit.
- Model initial `electrical.pv` generation as fixed available power from a
  scenario series. It is not implicitly curtailed.

This supersedes ADR 0007's restriction to one controllable balancing component.
ADR 0007's topology and signed-flow decisions remain in force.

## Consequences

Policy can later request battery operation without competing with the grid for
balancing ownership. The grid then absorbs the remainder deterministically,
independent of component order. A model with excess fixed PV and insufficient
grid export capacity is explicitly infeasible rather than silently curtailed.
