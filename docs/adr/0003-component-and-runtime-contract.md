# ADR 0003: Component and runtime contract

**Status:** Accepted

**Date:** 2026-07-31

## Context

The runtime must support electrical storage, conversion, and thermal storage
without becoming a general equation or hook system.

## Decision

- Persist component instances as plain `ModelComponent` JSON objects.
- Register reusable engineering behaviour as plain `ComponentDefinition`
  objects.
- Compile each instance into a run-local `RuntimeComponent`.
- Definitions declare parameters, state, ports, outputs, editor hints,
  validation, and deterministic model behaviour.
- The public extension contract is an object, not a subclass hierarchy or
  general hook system.
- Each step follows requested operation, current operating limits, resolver
  allocation, actual command, evaluation, balance check, then state commit.
- Browser and Node call the same deterministic `runScenario` function.
- The fixed timestep, units, balance tolerances, and integration convention are
  explicit inputs or documented contracts.

## Consequences

Policies cannot assign physically independent flows, and components remain
responsible for their own limits and conversion relationships. Component
calculations contain no UI or I/O dependencies.
