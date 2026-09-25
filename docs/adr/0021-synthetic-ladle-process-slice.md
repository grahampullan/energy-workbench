# ADR 0021: Synthetic ladle process slice

**Status:** Accepted

**Date:** 2026-08-18

## Context

The public Push 2 capability needed to prove separate refractory and molten
metal states, material transfer, fuel use, process modes, and policy comparison
without importing private MHI-informed study data. The runtime also required
every policy to nominate a balancing component even when no residual balance
existed.

## Decision

- Represent refractory and molten metal as separate `thermal.store` instances.
  Connect material ports only on molten metal.
- Use explicit `thermal.heat-transfer` components for metal-to-refractory
  contact and heat loss to a constant-temperature Ambient instance.
- Add `thermal.fuel-burner`. It owns fuel-to-heat efficiency and direct
  emissions and reports fuel use from the heat actually accepted downstream.
  Do not add a fuel flow or supply component until a case has a real fuel
  boundary constraint.
- Allow a heat-source policy target to use `{ heatOutputkW }`; retain the
  existing electrical heater `{ powerkW }` target.
- Require the policy operation to retain `balancingComponentId`, but allow its
  value to be `null` when no residual balancing operation exists.
- Keep process modes in the scenario and operational choices in policy. The
  public example exposes historical and temperature-led policies over the same
  physical model.
- Keep all public inputs neutral and synthetic. Private evidence, assumptions,
  and calibration remain outside the repository.

## Consequences

The browser and headless runtime now exercise one two-body process cycle with
fuel, emissions, material transfer, temperature constraints, and policy
comparison. The component set grows by one physical component rather than by
ladle-specific store types or a generic constraint language.

A future fuel-network constraint requires a deliberate flow-type and component
decision. A future reversible thermal contact also requires an explicit
extension; the current directed heat-transfer contract remains non-negative.
