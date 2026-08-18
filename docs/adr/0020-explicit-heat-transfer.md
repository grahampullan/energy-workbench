# ADR 0020: Explicit passive heat transfer

**Status:** Accepted

**Date:** 2026-08-18

## Context

`thermal.store` owned both energy accumulation and standing loss. That made a
store calculate a physical relationship between itself and another visible
boundary, and the same temperature-driven relationship is also needed between
separate finite bodies such as molten metal and refractory.

## Decision

- Add a stateless, directed `thermal.heat-transfer` component with one required
  `source` connection, one required `sink` connection, and a
  `conductancekWPerK` parameter.
- Determine equal source and sink heat rates from current boundary
  temperatures using `Q = K * max(0, Tsource - Tsink)`.
- Cap transfer so one explicit step cannot cross finite-body equilibrium or
  raise a finite sink above its maximum temperature.
- Require a finite body to publish `temperatureC`, `thermalCapacitykWhPerK`,
  and its maximum temperature. A non-accumulating boundary explicitly publishes
  `fixedTemperatureBoundary: true`.
- Replace the ambient-specific boundary with the reusable
  `thermal.constant-temperature` component. Its prescribed temperature may
  vary between timesteps, but received heat does not alter it. Use an instance
  named “Ambient” when it represents the environment.
- Give `thermal.store` repeatable `passive-heat-in` and `passive-heat-out`
  ports. The store requires those flows to be settled, then includes them in
  its enthalpy balance. Remove its loss coefficient, loss port, loss equation,
  and loss output; version the revised store contract as `0.2.0`.
- Represent ambient loss as
  `store -> heat transfer -> constant temperature (“Ambient”)`. The upstream
  and downstream ideal connections carry the same heat rate.

## Consequences

Component boundaries now match physical ownership: stores accumulate energy,
heat-transfer components determine passive exchange, and a constant-temperature
component fixes a boundary temperature without accumulating heat. The runtime
only derives the dependency order and checks the two connection balances.

The component is directed because `thermal.heat-flow` is directed and
non-negative. A topology must place the expected hotter boundary at `source`.
If a future model requires heat to reverse direction, it needs an explicit
extension to this component and flow contract rather than a negative heat rate.

The batch and coupled examples gain one visible heat-transfer component each.
Their reviewed numerical results remain unchanged. The results chart hides the
component's upstream connection through editor metadata so the same physical
transfer is not plotted twice.
