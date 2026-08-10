# ADR 0009: Single-port battery storage

**Status:** Accepted

**Date:** 2026-08-04

## Context

The legacy demo represented battery charging and discharging with two directed
ports. A storage device has one electrical boundary, and separate charge and
discharge commands could permit contradictory simultaneous operation. The
legacy state-to-power limit also omitted timestep duration and could discharge
past zero stored energy.

## Decision

- Represent `electrical.battery` with one bidirectional active-power port.
- Use one signed command: positive power discharges to the bus and negative
  power charges from it.
- Require an explicit policy request for battery operation. The residual grid
  balances the bus after the request is clamped.
- Store energy in kWh and declare capacity, terminal charge/discharge limits,
  and separate charging and discharging efficiencies.
- Advance stored energy using:

  ```text
  E_next = E + chargingEfficiency * chargePowerKw * durationHours
             - dischargePowerKw * durationHours / dischargingEfficiency
  ```

- Limit terminal power from both the nameplate power and the energy available
  within the current timestep. Empty batteries cannot discharge and full
  batteries cannot charge.
- Report stored energy and state-of-charge fraction after the completed step.

## Consequences

Charge and discharge are mutually exclusive by construction. Storage behavior
is deterministic under timestep refinement while neither an energy nor power
limit changes the requested operation. The default 5 kWh capacity, 3 kW power
limits, and unit efficiencies preserve the legacy demo's nominal assumptions,
but the corrected energy limit intentionally prevents its final negative state.
