# ADR 0014: Flow-type and connection-result contract

**Status:** Accepted

**Date:** 2026-08-13

## Context

The first electrical and thermal slices used `medium` on ports and flattened
domain-specific fields onto connection results. Extending that pattern would
duplicate domain information, leave ownership unclear, and make each result
consumer branch on a different shape. Connection residual fields also exposed
an internal balance check as if it were a physical result.

## Decision

- Define the supported flow types centrally. Each `FlowType` specifies its ID,
  exact fields, units, and boundary validation. This remains a small fixed core
  contract, not a dynamic registry or generic solver.
- Use `flowType`, not `medium`. The prefix of a flow-type ID implies its broad
  domain; do not store a separate domain.
- A component definition port declares `{ id, flowType, direction }`.
  `direction` is one of `in`, `out`, or `bidirectional` and describes permitted
  flow.
- A persisted connection stores identity, name, and `from`/`to` endpoint
  references only. Runtime preparation derives its `flowType` from the ports and
  validation requires both ports to agree.
- A runtime connection result is always
  `{ connectionId, flowType, flow }`. The `flow` object has exactly the fields
  declared by its flow type.
- Treat connections as ideal, lossless, and non-accumulating. Endpoint values
  must agree after direction normalisation. Report disagreement with a
  `runtime.connection-balance` diagnostic; do not publish a residual result.
- Use `from` to `to` as the signed connection reference. Active power may be
  signed on bidirectional ports: a battery-to-bus connection is positive while
  discharging and negative while charging. Directed thermal flow remains
  non-negative.
- Keep electrical and thermal allocation in explicit domain resolvers. A common
  result envelope does not imply a generic physics engine.
- Preserve SI symbol casing in identifiers: `powerkW`, `heatFlowkW`,
  `energykWh`, and `heatLossCoefficientkWPerK`; never `Kw`, `KW`, or `Kwh`.
- Publish the changed built-in component contracts as version `0.2.0`.

## Consequences

Components own parameters, state, equations, and port-reported flows; ports own
flow compatibility and permitted direction; persisted connections own only
topology; runtime results own resolved values. Consumers can inspect one stable
connection envelope while domain resolvers remain straightforward and
purpose-specific.

This ADR supersedes the `medium`, watt-identifier casing, and flattened
connection-result wording in ADRs 0012 and 0013. Those records remain unchanged
as history.
