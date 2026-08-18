# Material-inventory reference specification

## Purpose

This public synthetic example proves the minimum material-flow contract needed
before the private ladle model. It tests a stateful inventory without
introducing refractory, phase, composition, or process-mode models.

## Example model

The model in `examples/material-inventory-synthetic` is:

```text
Material source -> Heated material inventory -> Material sink
                                  ^
                                  |
Grid -> Electric heater ---------+
```

The source prescribes material flow at 100 kJ/kg. The 120 kg inventory has a
constant specific heat capacity of 1 kJ/kgK and a 0 °C enthalpy reference. The
policy requests heater power and inventory outflow. The inventory limits
outflow to its start-of-step available mass, determines the outgoing specific
enthalpy, and accepts the heater's thermal flow. The existing heater then
determines electrical demand, which the grid balances.

## Engineering contract

The inventory stores only mass in kg and contained enthalpy in kWh. For a
timestep of `dt` seconds:

```text
massNext = mass + (massIn - massOut) * dt
enthalpyNext = enthalpy
             + (enthalpyIn + heatIn - enthalpyOut) * dt / 3600
temperature = referenceTemperature
            + containedEnthalpy * 3600 / (mass * specificHeatCapacity)
```

Outflow uses start-of-step specific enthalpy, consistent with explicit-forward
integration. Empty inventory has zero contained enthalpy and reports the
reference temperature.

## Reviewed result fixture

The 160 six-second steps cover the same sixteen-minute run and contain short,
separate square pulses for material inflow, heater power, and material outflow.
They fill the inventory with 120 kg, add 0.333333 kWh of heat while holding,
then empty it. Temperature progresses from 100 °C to 110 °C before the
inventory returns to zero mass and zero contained enthalpy. A separate
regression requests excessive outflow and checks that it is limited to
start-of-step available mass.

`tests/regression/material-inventory.test.js` locks the dependency stages,
reviewed state checkpoints, mass balance, enthalpy balance, outflow limit,
absence of cumulative transfer state, and aligned three-second timestep
refinement.

Select **Material inventory** in the browser workbench to inspect the same run.
The topology distinguishes material connections and labels mass flow with
specific enthalpy. The results panel compares prescribed and actual mass flow,
plots transported enthalpy with the other energy flows, and plots the derived
inventory temperature without adding temperature as stored state.
