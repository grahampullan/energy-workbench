# ADR 0012: Restricted thermal flow and storage

**Status:** Accepted

**Date:** 2026-08-13

## Context

Push 1B must add electrical heating, hot-water storage, standing loss, and a
temperature-constrained heat demand without introducing a general fluid-network
or equation-system abstraction.

## Decision

- Use `thermal.heat-flow` for directed thermal ports.
- Represent every thermal port flow with exactly `heatFlowKw`,
  `sourceTemperatureC`, and `deliveryTemperatureC`.
- Require non-negative directed heat flow and finite temperatures no lower than
  absolute zero. Positive flow cannot be delivered above its source
  temperature. Zero flow still reports both boundary temperatures, but they may
  be in either order.
- Make the source and receiving components enforce temperature availability and
  minimum useful delivery temperature. Connections do not calculate mass flow,
  pressure, mixing, enthalpy transport, or pipe delay.
- Model the electric heater as `Qheat = efficiency * Pelectric`.
- Model the hot-water store as one mixed temperature state using fixed-timestep
  explicit integration:

  ```text
  C * (Tnext - T) / dt = Qcharge - Qdischarge - UA * max(0, T - Tambient)
  ```

  Cap the loss over a coarse timestep so standing loss alone cannot cool the
  store through the ambient boundary.

- Give the store one heat input, one useful heat output, and one ambient-loss
  output. Keep charge heat flow and temperatures, discharge heat flow, and
  ambient temperature as separate fields in its actual command.
- Limit discharge to energy above the minimum useful temperature and report
  served and unmet heat at the demand component.

## Consequences

The first thermal components remain small, deterministic registered definition
objects and can be prepared and tested independently of the browser. Temperature
constraints are explicit in results rather than implied by a scalar heat rate.
The model is intentionally unsuitable for hydraulic or steam-network analysis.
The restricted coupled allocation is specified separately in ADR 0013.
