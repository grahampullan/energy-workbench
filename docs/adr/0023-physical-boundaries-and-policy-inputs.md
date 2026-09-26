# 0023 — Physical boundaries, policy inputs, and balancing roles

Status: Accepted definition; implementation gaps identified below.

Follow-up: [0024](0024-connection-local-physical-access.md) implements physical
access restrictions and supersedes the role-storage migration expectation.

## Context

The PV battery receives generation and demand through information connections.
The grid receives its balancing requirement through the physical calculation.
Representing both as policies obscured why only one needed information inputs.

## Decision

Use the [abstraction definitions in ARCHITECTURE.md](../../ARCHITECTURE.md#components-connections-policies-and-roles):

- Components own physical equations, feasibility, and state.
- Physical connections couple ports and expose the declared boundary data needed
  to resolve their physical exchanges. This does not grant general data access.
- Information connections copy named, typed values with explicit availability.
- Operating policies receive all runtime inputs through information connections
  and return only their own component's requested operation.
- Balancing roles explicitly configure which boundary accepts the conservation
  remainder. They are physical configuration, not operating policies.

Classify a value by its use. Boundary temperature used in a heat-transfer
equation is physical boundary data. Temperature used to choose a heating request
is a policy input and requires an information connection.

In the PV example the battery policy acts first, the battery resolves its limits,
then the bus calculates the grid exchange and the grid checks its limits. The
bus-to-grid dependency needs no additional information connection. An unmet
balancing requirement is infeasible, not permission for implicit redispatch.
The current pre-policy information stage cannot consume that later grid exchange.

## Consequences and implementation status

This clarifies 0022's connection semantics and supersedes its classification of
balancing roles as operating policies. It also supersedes the policy-selected
role terminology in 0015/0016; the component equations and dependency planning
remain applicable.

The existing `electrical.balance` catalogue entry still encodes the role as a
policy. The inspector now separates the Role tab, Physical role explanation,
and role choices from operating policies. Model/API migration remains to be
done; the presentation change does not change saved JSON or simulation results.
Physical resolution helpers also need to enforce connection-local access rather
than expose unrestricted ID lookups and runtime endpoint objects. Policy input
isolation is already enforced.
