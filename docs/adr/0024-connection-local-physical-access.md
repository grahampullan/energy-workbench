# 0024 — Enforce connection-local physical access

Status: Accepted.

## Context

ADR 0023 limited physical calculations to declared boundary data from connected
ports. Runtime still supplied arbitrary ID lookups, whole endpoint components,
global state, and full preparation inputs. Those APIs could bypass the rule.

## Decision

- Give resolution callbacks immutable connection references containing endpoint
  IDs, port IDs, directions, and roles. Keep runtime endpoint objects private.
- Let each physical port declare the operating-limit and target fields it
  publishes. `getBoundary(connectionId)` returns only those fields from the
  opposite port. Unconnected access fails.
- Permit settled-flow reads only for connected, declared prerequisites.
  Target prerequisites must be local or published through a connected port.
- Give timestep callbacks only their own state and declared scenario profiles.
  Definitions list the profile-selecting parameters in `seriesParameters`.
  Preparation and initialisation receive timing and those profiles, without
  the model or unrelated scenario data.

Runtime performs access checks and data projection. Components retain their
equations and feasibility rules. Policy inputs still arrive exclusively
through information connections.

## Consequences

This completes the physical-access work identified in ADR 0023 and narrows the
preparation API described in ADR 0005. Component extensions must use port
publications and connection IDs in place of global lookups and endpoint objects.
These declarations belong to definitions; saved model and result formats are
unchanged. Existing example results remain unchanged.

The balancing assignment remains in the policy field and catalogue. This is
an accepted representation and requires no migration. It preserves the
behavioural distinction between choosing a target and accepting a conservation
remainder. This supersedes ADR 0023's expectation of separate role storage and
registration.
