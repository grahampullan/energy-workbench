# ADR 0019: Unified thermal store

**Status:** Accepted

**Date:** 2026-08-18

## Context

The hot-water store, fixed-mass batch, and heated material inventory used the
same well-mixed sensible-heat balance but exposed separate component types,
state names, and output names. Extending that pattern to refractory, molten
metal, molten salt, and tanks would create equipment-specific types without
introducing different governing physics.

## Decision

- Use one `thermal.store` definition for a well-mixed, constant-property body.
- Store mass and contained enthalpy as state. Derive temperature from specific
  heat capacity and an enthalpy-reference temperature.
- Always expose optional material input and output ports, a repeatable heat
  input, and optional useful-heat and heat-loss outputs.
- Infer closed versus flowing storage from material-port connections. Do not
  add an equipment mode or `allowMassFlow` parameter.
- Put equipment meaning in the instance name. A hot-water tank, refractory,
  molten-metal inventory, or batch may share the definition when its equations
  fit this contract.
- Retire `thermal.hot-water-store`, `process.batch-thermal-mass`, and
  `process.heated-material-inventory` without compatibility aliases. Migrate
  the public examples and reviewed tests to the unified definition.

## Consequences

One component owns material transfer, heat transfer, loss, capacity, and
explicit-forward mass and enthalpy updates. A fixed-mass instance leaves its
material ports unconnected; a material inventory connects them. A positive
heat-loss coefficient requires a visible loss connection.

The definition does not represent stratification, variable properties, phase
change, composition, pressure, or multiple materials. Those needs require a
new governing contract or a deliberate later version, not more equipment-name
aliases or mode flags.
