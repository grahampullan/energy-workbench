# Batch-heating reference specification

## Purpose

This public synthetic example is the first Push 2 model. It establishes the
smallest useful batch-heating process before any private industrial data,
process modes, CSV import, calibration, or optimisation are added.

## Example model

The model in `examples/batch-heating-synthetic` has four visible components:

```text
Grid -> Electric heater -> Batch thermal mass
                              |
                              +------------> Ambient
```

The cycle has 16 quarter-hour steps. It includes one idle hour, 2.75 hours at
50 kW electrical heater input, and one final unpowered quarter-hour. The heater
is 90% efficient and supplies heat at 150 °C. The batch starts at 20 °C, has
an exact 1 kWh/K thermal capacity, loses 0.1 kW/K above ambient, and must finish
at or above 120 °C.

## Responsibility split

The scheduled-heating policy publishes the requested electrical input for the
heater. It does not calculate temperature or heat loss.

The batch component is the source of truth for its governing physics. It
decides how much offered heat it can accept, calculates heat loss, advances its
temperature state, and reports the margin to the required final temperature.
The heater applies its own conversion efficiency and the grid balances the
resulting electrical flow.

## Engineering contract

The reference fixture locks the complete temperature, heat-input, heat-loss,
and required-temperature-margin series. It also checks:

```text
grid import = heater electrical input
heater heat output = heater electrical input × efficiency
batch heat input = heater heat output
batch energy change = heat input - heat loss
```

The reviewed run reaches 126.65074437800698 °C, 6.650744378006976 K above
the requirement. Raising the requirement to 135 °C produces an explicit
final-step warning without making the otherwise valid run fail.

Reported energy totals multiply each current-step flow by the step duration,
consistently with explicit-forward component state updates. Timestep
refinement controls integration accuracy.
