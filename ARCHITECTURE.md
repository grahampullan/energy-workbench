# Architecture

## Purpose

This is the normative architecture contract for Energy Workbench. The roadmap
explains product scope and sequence; this file defines the ground rules for new
code.

## Core idea

Energy Workbench has one semantic model and one deterministic simulation
runtime. The browser, Node tests, and CLI call the same runtime.

```text
JSON project + component registry + scenario + policy
                         |
                         v
                    runScenario
                         |
                         v
             states, flows, outputs, KPIs
```

UI and file handling sit outside the engineering calculation.

## Source boundaries

### `src/core`

- Owns project contracts, commands, queries, and validation.
- Contains pure, deterministic logic.
- Performs no browser, filesystem, network, process, or environment I/O.

### `src/runtime`

- Prepares a validated model and runs fixed-timestep simulations.
- Owns operating-limit resolution, balance checks, state advancement, and
  results.
- May import `core`; it receives the component registry explicitly.
- Contains no UI or file I/O.

### `src/components`

- Owns registered `ComponentDefinition` objects and their engineering
  equations.
- May import pure helpers from `core`.
- Contains no UI, file I/O, or runtime-specific presentation logic.

### `src/ui`

- Owns the graph, inspectors, preview controls, charts, KPIs, and browser file
  interaction.
- May call `core` commands and the shared runtime.
- Must not contain engineering equations or a second simulation path.

### `src/cli`

- Is a thin Node composition and file-I/O boundary.
- Loads inputs, calls the shared core/runtime, and writes results.
- Must not contain engineering equations or a second simulation path.

Nothing imports `ui` or `cli`. Tests may import any public module.

## Model contracts

Keep these representations distinct:

- `ModelComponent`: persisted JSON instance with parameters and initial state.
- `ComponentDefinition`: registered specification and deterministic behaviour.
- `RuntimeComponent`: prepared, run-specific data and state allocation.

Use the engineering vocabulary `Component`, `Port`, and `Connection`, qualified
in code where needed. Do not export an ambiguous bare `Component` class.

A component step follows one direction:

```text
component operating limits
-> policy request
-> resolver allocation
-> actual command
-> component evaluation
-> balance check and state commit
```

Requested, feasible, and actual operation must never be conflated. Policies do
not assign independent physical flows. A policy receives a read-only snapshot
of current component operating limits, so it can coordinate operation without
duplicating component equations. The resolver still clamps requests and owns
physical balance.

### Flow types and connections

A small central `FlowType` contract owns the exact fields, units, and boundary
validation for each kind of flow. The current types are
`electricity.active-power` and `thermal.heat-flow`. Their prefixes imply the
broad engineering domain; do not store a separate `domain` or `medium` field.
This is a fixed core contract, not a plugin system or generic physics engine.

Keep ownership precise:

| Owner | Stored contract |
| --- | --- |
| `ModelComponent` | Identity, definition version, parameter values, and initial state |
| `ComponentDefinition` | Ports, parameter/state/output specifications, equations, validation, and editor metadata |
| Port | `{ id, flowType, direction }`, where direction is `in`, `out`, or `bidirectional` |
| Persisted connection | Identity, name, and `from`/`to` component-port references only |
| Runtime connection | Resolved endpoints and the `flowType` derived from their ports |
| Runtime connection result | `{ connectionId, flowType, flow }` |
| Layout/UI | Link geometry, selection, highlighting, and other presentation state |

A connection is ideal, lossless, and non-accumulating. Both endpoint flows must
match after direction normalisation. Conversion, loss, storage, splitting, and
mixing belong in explicit components and resolvers. A mismatch produces a
`runtime.connection-balance` diagnostic; it is not returned as a public
residual field.

The persisted `from` and `to` endpoints define the connection's reference
orientation. Static port direction defines permitted flow. Directed ports
report non-negative flow in their declared direction. A bidirectional port may
report a signed value. For active electrical power commands, positive
`powerkW` exports from a component and negative `powerkW` imports into it.
Connection `powerkW` is positive from `from` towards `to`. For example, a
battery-to-bus connection is positive while discharging and negative while
charging.

Every active-power flow has exactly:

```text
powerkW
```

Every directed thermal heat flow has exactly:

```text
heatFlowkW
sourceTemperatureC
deliveryTemperatureC
```

Heat flow is non-negative in the declared direction. For positive flow,
delivery temperature cannot exceed source temperature. The connected
components own source-temperature availability and minimum useful delivery
temperature; a connection adds no fluid equations. This restricted contract
does not represent mass flow, pressure, mixing, enthalpy transport, or pipe
delay.

The hot-water store actual command keeps its independently allocated boundary
conditions explicit: charge heat flow and its source/delivery temperatures,
discharge heat flow, and ambient temperature. Its temperature state advances
by explicit integration over `durationHours`; it does not hide a second flow
allocation inside the component.

The Push 1B coupled resolver supports one deliberately fixed thermal topology:

```text
electrical bus -> electric heater -> hot-water store -> heat demand
                                      |
                                      +-> ambient boundary
```

The policy requests signed electrical input for the heater. The resolver then
allocates useful store discharge, clamps heater/store charge by current power,
capacity, and temperature limits, allocates standing loss to ambient, and calls
the existing electrical-bus resolver with the heater's feasible input. Store,
demand, and ambient commands are resolver-owned and do not receive independent
policy requests. Thermal connection results contain the allocated heat flow and
both boundary temperatures inside their `flow` object. Thermal branching
requires a future explicit resolver; it is not inferred from component order or
treated as a general junction problem.

A fixed component reports equal minimum and maximum operating power and needs
no policy request. A non-grid component with variable limits requires an
explicit policy request. In the single-bus electrical runtime, exactly one grid
boundary is resolver-owned: it receives no policy request and its actual power
balances all fixed and policy-controlled operation. Positive grid power imports
energy into the model; negative grid power exports it.

## Data and state rules

- JSON is the canonical portable project format; large time series stay in
  external data files.
- IDs are stable. Layout is stored separately from engineering data.
- JSON Schema checks document structure. JavaScript validators check references,
  units, topology, limits, and physical plausibility.
- Model parameters are plain values. Units and timestep conventions are
  explicit and tested.
- A run does not mutate the persisted model.
- Preview overrides are temporary. Apply changes the working model through a
  command. A saved variant is a separate reproducible state.

## Interactive run rules

The UI sends preview overrides to a coalescing scheduler, which calls the shared
runtime and publishes results to graph, chart, KPI, and diagnostic views.

- Labels update immediately when a control changes.
- The scheduler retains at most the current run and latest pending request.
- The final control value is always run.
- Stale results never replace newer results.
- `Observable` is UI plumbing only; engineering correctness cannot depend on
  subscriber order.
- Views unsubscribe when disposed, and a failing view cannot corrupt run state.

## Scope rule

Add abstractions only for a current Push requirement. Do not introduce a server,
general hook system, general equation system, optimisation layer, worker, agent,
or plugin architecture in anticipation of later pushes.

## Review checks

- Is there still one model and one simulation path?
- Is engineering logic pure and outside UI/CLI code?
- Are model, definition, and runtime representations kept distinct?
- Are requested, feasible, and actual values unambiguous?
- Are dependencies explicit and imports within the source boundaries?
- Are preview changes temporary and persisted changes command-driven?
- Will the same inputs produce equivalent browser and Node results?
