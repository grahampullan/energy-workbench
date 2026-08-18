# ADR 0017: Material mass and enthalpy flow

**Status:** Partly superseded by ADR 0019

**Date:** 2026-08-15

## Context

The private ladle study needs mass to enter and leave a stateful molten-metal
inventory. Treating that transfer as heat alone would hide transported energy
and make fill and empty operation impossible to balance.

## Decision

- Add the directed `material.mass-flow` type with exactly
  `massFlowKgPerSecond` and `specificEnthalpyKjPerKg`.
- Calculate transported enthalpy rate as their product; do not duplicate
  temperature on the connection.
- Keep mass and contained enthalpy as inventory state. Derive temperature from
  those states and component-owned thermophysical parameters.
- Transfer process heat through a separate `thermal.heat-flow` port.
- Determine outflow from start-of-step inventory state and advance state by
  explicit forward integration.
- Keep material properties and process equations in visible components; do not
  add a material ontology or generic material-network solver.

## Consequences

Connections can check both mass rate and transported-energy agreement while
remaining small and typed. Reference enthalpy must be consistent across
connected material components. Composition, phase change, pressure, mixing,
and property variation require later explicit component contracts rather than
implicit connection behaviour.
