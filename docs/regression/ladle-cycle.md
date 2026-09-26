# Synthetic ladle-cycle reference specification

## Purpose

This public neutral example proves the generic process-energy contracts needed
before a private MHI-informed ladle study. It is not calibrated plant data and
must not be presented as an MHI result.

## Topology

```text
Fuel burner -> Ladle lining
Molten-metal arrival -> Metal in ladle -> Casting process
                         |       |
                         |       +-> Heat transfer -> Ambient
                         +-> Heat transfer -> Ladle lining
Ladle lining -> Heat transfer -> Ambient
```

“Ladle lining” represents the heat-resistant refractory inside the ladle. It
persists between cycles as a fixed-mass `thermal.store`. “Metal in ladle” uses
the same store equation with connected material ports, so it explicitly
tracks mass in, contained mass, mass out, and enthalpy. The baseline retains
a synthetic 300 kg heel. Reduced inflow can empty the ladle: current-step
discharge is reserved before publishing the thermal capacity available for
passive heat exchange. Discharge carries the current-state specific enthalpy.

The metal-to-refractory contact and both environmental losses are separate
`thermal.heat-transfer` instances. Ambient is an instance of
`thermal.constant-temperature`. The burner owns fuel efficiency, delivered
heat, and direct emissions. No fuel-supply component is present because the
example places no constraint on the fuel boundary.

## Scenario and policies

The two-hour cycle uses 120 one-minute explicit-forward steps. Numeric process
mode codes are:

| Code | Mode |
| --- | --- |
| 0 | Idle |
| 1 | Preheat |
| 2 | Setup |
| 3 | Fill |
| 4 | Tap |
| 5 | Hold |

The historical policy follows Heating schedule, which requests 400 kW during
preheating and zero otherwise. Discharge schedule directly requests the metal
outflow rate. Neither schedule-following policy takes a separate permission
input or reads process-mode codes.

The temperature-led policy uses current refractory temperature and thermal
capacity, Heating period's remaining time, the 800 °C requirement, and a 10 K
operating margin to request heat. Remaining time is zero outside the heating
period, switching heating off. Component equations still determine accepted
heat, fuel use and available discharge. Heating period is also available as an
unconnected source in the historical model so the inspector can switch to the
temperature-led policy; only connected sources appear in the viewer.

For the reviewed synthetic fixture, the temperature-led policy reduces fuel
input from 333.3 kWh to 293.9 kWh and direct emissions from 61.3 kgCO2 to
54.1 kgCO2. Its minimum tapped-metal temperature is 1502.8 °C, 52.8 K above
the declared requirement. These figures test software behaviour; they are not
plant predictions.

The material-source inflow profile multiplier defaults to 1 and scales mass
and transported enthalpy together. It does not alter the tapping request:
9.5 kg/s for ten minutes, or 5700 kg. At a multiplier of 0.8, the run receives
4800 kg and reports 5700 kg requested, 4800 kg actually discharged, and 900 kg
unmet. A zero multiplier completes with no discharge and no delivery temperature.

## Regression contract

Tests preserve:

- model, scenario, and layout validity;
- the derived three-stage resolution plan;
- historical and temperature-led trajectories at reviewed checkpoints;
- schedule-following operation independent of process-mode labels;
- total material in, material out, and retained heel;
- reduced and zero inflow, unmet discharge, and the empty-inventory boundary;
- whole-system enthalpy conservation;
- burner efficiency and direct-emissions accounting;
- lower fuel use with a positive delivery-temperature margin; and
- convergence of the delivery result under 60, 30, and 15 second timesteps.

Both policies are available in the browser example picker. They use the same
model, scenario, runtime, topology, chart, KPI, and inspector code paths.
