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

- Prepares a validated model, determines execution order, and orchestrates
  fixed-timestep simulations.
- Owns generic connection transfer, consistency checks, state commit, and run
  results.
- Does not contain component equations, dispatch rules, or model-specific
  solvers selected by component type.
- May import `core`; it receives the component registry explicitly.
- Contains no UI or file I/O.

### `src/components`

- Owns registered `ComponentDefinition` objects as the sole source of truth for
  component constraints, physical feasibility, governing equations, port
  behaviour, and state transitions.
- A visible junction component owns its conservation, splitting, or mixing
  equation.
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
component constraints and capabilities
-> policy targets, priorities, and operating roles
-> checked resolution-dependency plan
-> component resolution of feasible and actual operation
-> typed connection transfer and consistency checks
-> component evaluation and state commit
```

Requested, feasible, and actual operation must never be conflated. A policy
receives a read-only snapshot of current component constraints so it can choose
targets, priorities, schedules, and explicit balancing roles without
duplicating component equations. Each component definition resolves its own
physical feasibility and produces its actual port behaviour. The runtime
coordinates these calls but does not clamp operation using knowledge of a
component's physics.

Every component publishes its current capabilities through
`getOperatingLimits`. Its `resolution.describe` function identifies the policy
targets and settled connection flows required before resolution, plus the
connection flows it alone determines. This is dependency metadata, not a
second implementation of the component equation.

After current-step capabilities and policy roles are known, the runtime checks
those declarations, derives an acyclic sequence of resolution stages, and
executes components in that order. It rejects missing or conflicting flow
determiners, absent prerequisites, and same-step cycles before resolving
physics. The resulting plan is included with the timestep result so a UI or
diagnostic report can explain the order.

Every component that supplies, consumes, stores, converts, distributes, mixes,
or balances energy is explicit and visible in the topology. A runtime helper
must not act as an invisible energy component. The runtime may reject an
unsupported dependency or topology, but it must not implement that topology's
governing equations.

### Boundary resolution and well-posedness

Do not use the old visual-modeller word `constraint` as a complete port state.
Use these terms precisely:

| Term | Meaning |
| --- | --- |
| Prescribed | An exact operation fixed by scenario input, component state, or a component equation rather than selected by policy |
| Target | Desired operation selected by policy or calculated by an explicit visible junction; it remains subject to component feasibility |
| Capability | Flow-type-specific limits or requirements that a component can physically support at the current timestep |
| Actual | Operation accepted by the component after applying its physics to the prescription or target and connected boundary information |

A capability is not an actual flow. It may be a simple interval, a temperature
requirement, or a coupled relationship between several ports. The owning
component calculates and interprets the physical relationship. Do not encode
arbitrary feasible regions for a generic runtime solver.

A connection is well-posed when every field of its actual flow has one clear
determination path:

- One endpoint or component equation may prescribe a field.
- A target may be reconciled with capabilities published by both endpoints.
- A visible multiport component may determine fields through its governing
  equation, such as an electrical bus calculating one balancing-terminal
  target from its other terminal powers.

Capabilities at both ends of a connection are normal. For example, a heater
may offer `0–80 kW` at `90 °C` while a store can accept `0–60 kW` above a
minimum delivery temperature. Two independent prescriptions for the same
field are over-specified unless the `FlowType` contract explicitly defines a
shared-potential rule. Capabilities with neither a target, prescription, nor
component equation are under-specified. Non-overlapping capabilities are
infeasible.

Preparation reports structurally knowable over-specification,
under-specification, and unsupported dependency cycles. Timestep execution
reports incompatibility that depends on current state or scenario values. The
user chooses the components, connections, and policy; component and flow-type
contracts provide the boundary semantics. The user does not manually assign
`target`, `variable`, and `max` states to every connection endpoint.

### Flow types and connections

A small central `FlowType` contract owns the exact fields, units, and boundary
validation for each kind of flow. The current types are
`electricity.active-power`, `thermal.heat-flow`, and `material.mass-flow`.
Their prefixes imply the broad engineering domain; do not store a separate
`domain` or `medium` field. This is a fixed core contract, not a plugin system
or generic physics engine.

Keep ownership precise:

| Owner | Stored contract |
| --- | --- |
| `ModelComponent` | Identity, definition version, parameter values, and initial state |
| `ComponentDefinition` | Ports, parameter/state/output specifications, equations, validation, and editor metadata |
| Port | `{ id, flowType, direction, cardinality? }`, where direction is `in`, `out`, or `bidirectional`, and cardinality is `one` by default or explicitly `many` |
| Persisted connection | Identity, name, and `from`/`to` component-port references only |
| Runtime connection | Resolved endpoints and the `flowType` derived from their ports |
| Runtime connection result | `{ connectionId, flowType, flow }` |
| Layout/UI | Link geometry, selection, highlighting, and other presentation state |

A connection is ideal, lossless, and non-accumulating. Both endpoint flows must
match after direction normalisation. Conversion, loss, storage, splitting, and
mixing belong in explicit components whose definitions own the corresponding
equations. A mismatch produces a
`runtime.connection-balance` diagnostic; it is not returned as a public
residual field.

Generic connection execution may transfer boundary declarations, normalise
direction, apply the small compatibility operations defined by the relevant
`FlowType`, and verify final endpoint agreement. It must not interpret
component-specific capability data, choose dispatch priority, solve a
multiport component equation, or iterate an unknown cycle. A more complex
relationship requires an explicit component. A topology requiring a general
iterative or acausal equation solve is outside the current scope and fails
explicitly.

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

Every directed material mass flow has exactly:

```text
massFlowKgPerSecond
specificEnthalpyKjPerKg
```

Mass flow is non-negative in the declared direction. Specific enthalpy is
finite and may be negative because its reference state is component-defined.
Their product is the transported enthalpy rate in kW. The connection carries
no duplicated temperature, composition, pressure, or phase model; a component
that needs those properties must own and expose their governing relationship.

The `thermal.store` component owns `massKg` and `containedEnthalpykWh`. It can
represent a fixed-mass thermal body, such as a hot-water tank or refractory,
or a flowing material inventory. Material transfer is enabled by connecting
its material ports, not by selecting another component type or setting a mode
flag. It determines outgoing material from its current state, accepts and
delivers heat through separate thermal ports, and advances both states
explicitly:

```text
massNext = mass + (massIn - massOut) * dtSeconds
enthalpyNext = enthalpy
             + (enthalpyIn + heatIn
                - enthalpyOut - heatOut - heatLoss) * dtSeconds / 3600
```

Temperature is derived from contained mass, contained enthalpy, specific heat
capacity, and the component's enthalpy-reference temperature. Cumulative mass
and energy transfers are result integrations, not component state.

Temperature is a derived output rather than an independent state. The current
store assumes one well-mixed material, constant specific heat capacity, no
phase change, and no stratification. Its instance name describes the equipment;
the component type describes the governing equation. The store owns the joint
feasibility of material transfer, heat input and output, ambient loss,
temperature, and capacity constraints. The runtime must not repeat or
partially reimplement that equation.

Most ports accept one connection. A physical collector component may instead
declare a repeatable `many` port. Persisted connections then share that stable
port ID, while runtime evaluation keeps their flows separate by connection ID;
the generic connection check never balances an aggregate in place of an
individual connection.

The ambient boundary has one repeatable incoming `heat-in` port and reports the
aggregate heat received across its independently checked connections. The
electrical bus similarly has one repeatable bidirectional `terminal` port and
owns the power balance across its independently checked connections. Neither
component has an arbitrary connection-count limit, and neither requires
numbered placeholder ports.

The Push 1B reference model uses one deliberately fixed thermal topology:

```text
grid -> electric heater -> thermal store (hot-water instance) -> heat demand
                           |
                           +-> ambient boundary
```

The grid, heater, store, demand, and ambient boundary own their respective
equations. The policy chooses operational targets and explicitly identifies
the grid as the balancing component. The runtime orders the component
calculations and transfers their typed port flows; it must not use a whole-model
coupled resolver. Thermal branching requires a visible junction component with
an explicit component-owned allocation or mixing contract; it is not inferred
from component order.

A fixed component reports equal minimum and maximum operating power and needs
no policy target. A component with variable limits requires an explicit policy
target unless the policy nominates it as the balancing component. A balancing
component must be visible, connected to the operation it balances, and
physically able to accept the residual. Where a branching electrical bus is
present, the bus owns only its terminal power-conservation equation; it does
not intrinsically select a grid or any other component to balance. A grid is
one possible balancing component. Positive grid power imports energy into the
model; negative grid power exports it.

## Data and state rules

- JSON is the canonical portable project format; large time series stay in
  external data files.
- IDs are stable. Layout is stored separately from engineering data.
- JSON Schema checks document structure. JavaScript validators check references,
  units, topology, limits, and physical plausibility.
- Model parameters are plain values. Units and timestep conventions are
  explicit and tested.
- State advances explicitly from current-time state and actual flow. No
  current timestep may require a proposed next state to determine its actual
  flow.
- Integrated rate totals use the same current-step rectangular sum as state
  transitions. Timestep refinement, chosen by the user, controls integration
  accuracy.
- A result step represents `[t(n), t(n+1))`. Prescribed values and settled
  rates are zero-order-held over that interval and plotted as stepped lines.
  Initial and resulting states belong at `t(n)` and `t(n+1)` respectively;
  straight chart segments between state samples are presentation only.
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
or plugin architecture in anticipation of later pushes. In particular, do not
turn prescribed values, targets, and capabilities into a general constraint
language.

## Review checks

- Is there still one model and one simulation path?
- Is engineering logic pure and outside UI/CLI code?
- Is every governing equation and physical constraint owned by its visible
  component definition?
- Does the runtime avoid component-type branches and model-specific physics?
- Are balancing components and other operational roles chosen explicitly by
  policy?
- Does each connection field have exactly one clear determination path, with
  endpoint capabilities treated as feasibility rather than competing actual
  values?
- Are over-specified, under-specified, cyclic, and state-dependent infeasible
  cases rejected explicitly?
- Are model, definition, and runtime representations kept distinct?
- Are requested, feasible, and actual values unambiguous?
- Are dependencies explicit and imports within the source boundaries?
- Are preview changes temporary and persisted changes command-driven?
- Will the same inputs produce equivalent browser and Node results?
