# Coupled thermal reference specification

## Purpose

This public synthetic example is the Push 1B architectural reference. It proves
that the same fixed-timestep runtime can resolve an electrical supply and a
stateful thermal service without reducing both domains to an untyped scalar
flow.

It is intentionally smaller than the later batch-heating study. It has no
process modes, schedule optimisation, CSV import, or industrial calibration.

## Example model

The model in `examples/coupled-thermal` has five components:

```text
Grid -> Electric heater -> Thermal store named “Hot-water store” -> Heat demand
                           |
                           +----------------> Ambient
```

The first connection carries `electricity.active-power`. The remaining three
carry `thermal.heat-flow`, including source and delivery temperatures.
The store-to-ambient connection represents standing heat loss, so its direction
is from the store to the ambient boundary.

The synthetic duty cycle has 12 half-hour steps. The store starts at 80 °C and
has an exact 10 kWh/K thermal capacity, a 70 °C useful-delivery threshold, an
80 kW charge limit, and a 120 kW discharge limit. The heater is 90% efficient
and supplies heat at 90 °C. Ambient temperature and heat demand are inline
scenario series.

Select **Coupled thermal** in the browser workbench to inspect the same run.
The topology distinguishes thermal connections, the chart includes both flow
types, and the component inspector exposes store temperature and served and
unmet heat at the selected timestep.

## Operating policy

The demand-following policy asks the heater for enough electrical input to
match the current thermal demand after conversion efficiency. The store,
heater, and balancing grid then resolve their own feasible and actual operation
in topology order.

The policy is deliberately simple. It does not preheat the store or optimise
across future timesteps. This keeps policy intent separate from physical
feasibility and makes constrained operation easy to inspect.

## Engineering contract

The reference case exercises:

- Electrical-to-thermal conversion, with heater heat equal to electrical input
  multiplied by efficiency.
- Store mass and contained-enthalpy state, with temperature derived after heat
  input, output, and standing loss.
- Positive standing loss during idle timesteps.
- The store heat-input limit when requested heat exceeds 80 kW.
- The store heat-output limit at the first 150 kW peak.
- The stored usable-energy limit as temperature approaches the 70 °C service
  threshold.
- Served and unmet heat as explicit demand outputs.

Unmet-heat diagnostics at steps 4, 5, 6, and 10 are expected warnings. They do
not make the run fail.

## Reviewed result fixture

`expected-results.json` records the complete 12-step series and integrated
energy summary produced by the headless runtime. Each current-step flow is
multiplied by the step duration, consistently with the component state update.
Timestep refinement controls integration accuracy.

The regression checks three independent balances:

```text
grid import = heater electrical input
heater heat output = heater electrical input × efficiency
store energy change = heat input - heat output - standing loss
```

It also checks that total demand equals served plus unmet heat. These values are
locked by `tests/regression/coupled-thermal.test.js`.
