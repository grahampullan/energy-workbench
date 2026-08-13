# Blog electrical regression specification

## Purpose

This document captures the original Visual Energy Modeller example that defines
Push 1A interaction parity. It records what the old demo did, not the
architecture to copy.

The preserved input and headless results are in
`examples/blog-electrical/legacy-model.json` and
`examples/blog-electrical/legacy-expected-results.json`.

## Provenance

| Source | Preserved revision |
| --- | --- |
| `visual-modeller-energy` | tag `blog-demo-2024`, commit `5a1bb8415ce0e006f95c72fe183ba0abf826eeae` |
| `visual-modeller-core` | tag `blog-demo-2024`, commit `3368981528de63178aed9d145c565252aa54a754` |
| `board-box` | tag `v0.2.43`, commit `448ca9b4d7f0532b6bb95e506c823bb00838e63b` |

`board-box` 0.2.43 is the version pinned by the tagged
`visual-modeller-core` lockfile. The example is
`examples/domestic-solar/PV-battery.json` from `visual-modeller-energy`.

Original published artifacts:

- [Blog post](https://grahampullan.github.io/viz/2024/09/22/Visual-energy-modeller.html)
- [Interaction recording](https://grahampullan.github.io/assets/images/energy-modeller-1.mp4)
- [Reference image](https://grahampullan.github.io/assets/images/energy-modeller-1.png)
- [Published model](https://grahampullan.github.io/assets/data/visualmodeller1/PV-battery.json)

The 15 MB recording is referenced rather than duplicated in this repository.

## Example model

The model represents one day at one-minute resolution:

- 1,440 steps.
- 60 seconds per step.
- Link power in watts.
- Integrated link energy in kilowatt-hours.

The topology contains six nodes:

```text
Solar PV ----> Controller ----> Load
Grid Supply -> Controller ----> Grid Export
Battery <----> Controller
```

The Controller applies this deterministic priority:

- Surplus serves the constrained load, then charges the battery, then exports.
- Deficit uses constrained solar, then the battery, then grid supply.

Six logged link series are shown: solar supply, battery discharge, grid supply,
load, battery charge, and grid export.

The legacy JSON is intentionally retained in its original schema. It uses names
as references, combines layout with engineering data, and contains mutable
run-state values. It is evidence for the port, not the new project format.

## Interaction contract

The original browser experience has three visible panels:

1. Model structure: colored node boxes, sockets, and directed links.
2. Logs: power-versus-step lines or integrated-energy bars.
3. Node inspector: generated sliders for the selected node's state.

Required legacy behaviour:

- Clicking a node selects it and populates the inspector.
- The Load and Solar PV `socketMultiplier` sliders scale their prescribed
  profiles.
- Battery capacity is directly adjustable.
- A slider label changes during the input event.
- Every input event changes the model, reruns it synchronously, clears the old
  logs, and redraws the results.
- Hovering a graph link emphasizes its corresponding line or bar.
- Hovering a line or bar emphasizes its corresponding graph link.
- The line/bar control switches between time series and trapezoidally
  integrated daily energy.

Push 1A preserves the immediacy, selection, linked highlighting, and live result
updates. It deliberately adds numeric inputs, preview/reset/apply, stable IDs,
explicit units, and a coalescing latest-value-wins scheduler. It does not need
to preserve the old run-on-every-event implementation.

## Numeric reference

The tagged bundle was run headlessly with Node 22.22.0. The result fixture
contains the baseline plus the two changes demonstrated by the product story:

- Double the Solar PV `socketMultiplier` from 1 to 2.
- Double battery capacity from 5 to 10 kWh.

For each case the fixture records daily integrated energy, extrema, nine
time-series checkpoints, final battery charge, and maximum instantaneous
balance residual.

The legacy battery finishes slightly below zero charge. Its state-to-power
limit omits the timestep when converting remaining energy to allowable power,
so the last discharge step can overshoot. This is a captured legacy defect, not
target behaviour. The new runtime must enforce its stated battery limits and
document any resulting numerical difference from the old output.

## New-contract headless port

The Push 1A engineering model now lives in:

- `examples/blog-electrical/model.json`
- `examples/blog-electrical/scenario.json`
- `examples/blog-electrical/layout.json`
- `examples/blog-electrical/variant-double-pv.json`
- `examples/blog-electrical/variant-double-battery-capacity.json`
- `examples/blog-electrical/expected-results.json`

`scripts/generate-blog-electrical-example.js` deterministically extracts both
1,440-value legacy profiles and converts watts to kilowatts. It deliberately
starts the new battery at zero stored energy; the negative `charge` retained in
the legacy JSON is mutable post-run state, not a reusable initial condition.

All three cases complete through the shared runtime. Every preserved minimum,
maximum, and nine-point power checkpoint matches the legacy result after unit
conversion. Maximum bus residual is `2.23e-16 kW` or lower.

The remaining daily-energy differences are intentional corrections at battery
boundaries:

| Case | Quantity | Legacy kWh | New kWh |
| --- | --- | ---: | ---: |
| Baseline | Battery discharge | 5.007289 | 5.000000 |
| Baseline | Grid import | 7.341660 | 7.348949 |
| Baseline | Battery charge | 5.005396 | 5.000000 |
| Baseline | Grid export | 0.078430 | 0.083827 |
| Double PV | Battery discharge | 5.005415 | 5.000000 |
| Double PV | Grid import | 6.426265 | 6.431681 |
| Double PV | Battery charge | 5.042798 | 5.000000 |
| Double PV | Grid export | 8.576847 | 8.619645 |
| Double capacity | Battery discharge | 5.085524 | 5.083827 |
| Double capacity | Grid import | 7.263425 | 7.265123 |

PV and load energy are unchanged. The new battery finishes at exactly
`0 kWh` in every case rather than overshooting below zero. The corrected
expected values are locked by `tests/regression/blog-electrical.test.js`.

## Push 1A acceptance checklist

- The new example has stable IDs and separate engineering and layout data.
- The prescribed load and solar profiles match the captured input.
- Browser and Node call the same deterministic runtime and return equivalent
  results.
- Baseline and changed-case differences from the legacy fixture are either
  within the chosen tolerance or explained by an explicit corrected contract.
- Selecting a component opens the generated parameter inspector.
- Slider and numeric controls show a changed value immediately.
- Rapid input is coalesced, the released value is evaluated, and stale results
  cannot replace newer results.
- Graph, power chart, and integrated-energy view update together.
- Graph/result highlighting works in both directions.
- Preview can be reset or applied, and the applied model saves and reloads.
