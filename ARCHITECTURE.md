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
policy request
-> component operating limits
-> resolver allocation
-> actual command
-> component evaluation
-> balance check and state commit
```

Requested, feasible, and actual operation must never be conflated. Policies do
not assign independent physical flows.

For active electrical power commands, positive `powerKw` exports from a
component and negative `powerKw` imports into it. Directed ports report
non-negative flow in their declared direction; bidirectional ports report
positive export and negative import. Connection power is signed from the
persisted `from` endpoint towards `to`.

A fixed component reports equal minimum and maximum operating power and needs
no policy request. A non-grid component with variable limits requires an
explicit policy request. In the single-bus electrical runtime, exactly one grid
boundary is resolver-owned: it receives no policy request and its actual power
removes the residual after all fixed and policy-controlled operation. Positive
grid power imports energy into the model; negative grid power exports it.

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
