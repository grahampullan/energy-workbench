# Architecture

## Purpose

This is the normative architecture contract for Energy Workbench. The roadmap
explains product scope and sequence; this file defines the ground rules for new
code.

## Core idea

Energy Workbench has one semantic model and one deterministic simulation
runtime. The browser, Node tests, and CLI call the same runtime.

```text
JSON model (including policies and information connections) + registry + scenario
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

The inspector renders static mathematical explanations supplied by component
definitions and active policies. Component `explanation` metadata describes
governing equations; each selected policy definition supplies its `explanation`.
These descriptions are plain data, not executable expressions, and are not
persisted in model documents or run results. Policy choices, settings, and
information connections are persisted in the model. KaTeX belongs only to the
UI rendering layer. Equation rendering
does not calculate timestep values or participate in simulation.

Displayed equations use a consistent unit convention: energy in kJ, power in
kW, time in seconds, and heat capacity in kJ/K. Their symbol legends describe
these equation units; they need not match the storage units of runtime fields
or editable parameters. Show the governing relationships without numerical
unit-conversion factors. This convention changes explanation metadata only,
not canonical model values, information-port units, or runtime calculations.

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

### Components, connections, policies, and roles

These terms describe separate responsibilities:

| Abstraction | Responsibility |
| --- | --- |
| Component | Owns its physical equations, state, capabilities, feasibility checks, and public ports. |
| Physical port | Declares a physical exchange, its flow type, permitted direction, and the boundary data needed to resolve it. |
| Physical connection | Couples two compatible physical ports. Their actual flows must agree, including reference direction; the connection transfers no unaccounted energy or material. |
| Information port | Declares a named value with a quantity, unit, and defined availability in the calculation. |
| Information connection | Copies a published value to a declared input. It transfers no energy or material and may connect physically non-adjacent components. |
| Operating policy | Chooses its component's requested operation from explicitly connected information inputs and fixed settings. |
| Balancing role | Explicit configuration assigning which physical boundary accepts the remainder required by conservation. It makes no operating decision. |

A policy chooses a request. Component equations determine feasible and actual
operation. A balancing role identifies which boundary the physical calculation
determines. One port must not have both an independent policy target and a
balancing requirement for the same flow field in the same timestep.

Physical connections also provide **boundary data**: the capabilities,
prescriptions, targets, and settled flows required by the connected components'
physical equations. These data belong to the declared physical port contract.
Their calculation direction need not match the connection's reference
orientation or the direction of energy flow. A physical connection is not a
general channel for reading another component's state or settings.

For each external value, classify its use, not just its quantity:

- Resolving a physical exchange uses the boundary data of the component's
  connected physical ports. A junction can combine its own terminal data through
  its equation; it cannot inspect unrelated equipment.
- Choosing a requested operation uses an explicit information input to the
  policy, even when the source is the controlled component itself or a physical
  neighbour. Physical connectivity does not grant a policy access to that data.
- Component-owned prescribed profiles remain inputs to that component's
  equation. A policy that needs a schedule receives it through an information
  connection from a named schedule source.

For example, a heat-transfer component reads the two connected boundary
temperatures to calculate heat flow. A heating policy reads a temperature
through an information connection to decide how much heat to request. The
temperature may be numerically identical in both cases; the two uses have
different contracts.

The PV example makes the separation explicit:

1. PV and load publish generation and demand directly to the battery's policy
   inputs. The policy requests `demand - generation`.
2. The battery applies its own power and stored-energy limits.
3. The bus applies conservation to its settled physical terminal flows and
   determines the required grid exchange.
4. The grid, assigned the balancing role, accepts that exchange if its limits
   permit it. Otherwise the physical calculation reports infeasibility; no
   hidden policy redispatches the other components.

The bus-to-grid requirement is therefore physical boundary data. It needs no
additional information connection. A grid policy choosing operation from, for
example, a price signal would require an explicit information input and a
different valid assignment of the remaining physical degrees of freedom.

Information connections do not imply an event bus or arbitrary evaluation order.
The current runtime evaluates them before policy requests, using current
profiles and start-of-step state/capabilities. The grid remainder is available
only after battery resolution. Exposing it to a policy would require an
explicitly supported later stage or delay; adding a dashed connection alone
cannot make it available earlier. Same-step cycles are rejected.

**Current implementation boundaries.** `electrical.balance` currently stores
the balancing role in the policy field. The inspector distinguishes it in a
Role tab and a Physical role explanation, and groups role choices separately
from operating policies. The persisted encoding remains a mismatch with the
definitions above, not a zero-input operating policy. Separating role storage
and registration requires a model/API migration that has not yet been
implemented. Policy functions already receive only connected values and
settings. Physical resolution still exposes ID-based lookup helpers and runtime
endpoint objects; these should be narrowed to declared, connection-local
boundary access. Existing helper availability is not permission for new code to
read arbitrary model data.

A component step follows one direction:

```text
component constraints and capabilities
-> checked information-dependency plan and named input values
-> component policy targets, with configured balancing roles
-> component capabilities refined for those targets
-> checked resolution-dependency plan
-> component resolution of feasible and actual operation
-> typed connection transfer and consistency checks
-> component evaluation and state commit
```

Requested, feasible, and actual operation must never be conflated. A policy
receives only its explicitly connected information inputs and its
configured settings. It has no access to the model, scenario, clock, global
state, component objects, or a global capability map. Even its own component
capabilities must arrive through information connections. Each component
definition resolves its own
physical feasibility and produces its actual port behaviour. The runtime
coordinates these calls but does not clamp operation using knowledge of a
component's physics.

Every component publishes its current capabilities through
`getOperatingLimits`. The runtime calls it once for current boundary capabilities
and component-owned information outputs and again with the component's chosen
target as a third argument,
before preparing the resolution plan. This is one deterministic refinement,
not an iterative solve. The component owns how its target affects its coupled
capabilities. A material store reserves the feasible current-step withdrawal
before publishing the thermal capacity available for heat exchange; withdrawn
mass cannot also supply heat during the same explicit step.
Its `resolution.describe` function identifies the policy
targets and settled connection flows required before resolution, plus the
connection flows it alone determines. This is dependency metadata, not a
second implementation of the component equation.

After current-step capabilities, policy targets, and configured roles are known,
the runtime checks
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

### Component policies and information connections

A `ModelComponent` may persist `policy: { type, settings }`. Reusable policy
functions are registered at the application boundary through
`createComponentRegistry(definitions, { policies })`. Each definition declares
compatible component types, required physical ports, typed named inputs,
settings, a simple description and equations. `request(inputs, settings)`
returns only the owning component's target. The current `electrical.balance`
registration is the role-encoding exception described above: it returns no
target, and the owning component participates in the physical balance.

Physical connections retain their existing meaning. The model separately
stores `informationConnections`, each with identity, name, and `from`/`to`
references to named information ports. A component definition's `information`
section owns its public `inputs` and `outputs`. Policy input ports are named
`policy.<input-id>` on the controlled component. Information types declare both
quantity and unit: active power and heat rate are distinct even though both
use kW. Inputs accept one source unless explicitly declared many; outputs may
feed multiple consumers. Copying information transfers no energy or material.

Named `informationSources` bind scenario series to schedule outputs. A value
schedule publishes its typed value and an always-enabled permission. A period
schedule declares an integer `activeValue` and publishes permission and time
remaining in the contiguous matching period. Only the schedule source reads
future schedule entries. Its policy consumers receive scalar input values.
These sources are scenario boundaries shown as labelled input cards in the
viewer; they are not physical equipment or energy components.

All information in this slice is available before policy requests: current
scenario inputs, start-of-step state/capabilities, and derived information
outputs. The runtime checks the information graph and evaluates it in dependency
order. An output reader receives only its own state, parameters, capabilities
and connected information inputs. It never receives other components or a
model-wide lookup. Same-step information cycles, missing inputs, invalid
references, incompatible quantities/units and duplicate input sources fail
explicitly. Reading one's own start-of-step state into a policy input is valid.
Current-step settled flows, policy outputs and next states are not information
sources in this version. There is no implicit previous-step delay or event bus.

In the PV example, solar generation and load demand connect directly to the
battery's policy inputs. Both are non-negative powers. The policy requests
demand minus generation; the battery resolves its own feasibility, then the
physical bus and grid balance the remainder. Information connections need not
follow the physical route through the bus. Additional controlled equipment
requires explicit input wiring and an appropriate calculation order.
The thermal example explicitly connects requested heat demand across the store
to the heater policy. Schedule-following heat and discharge policies each take
one rate input; zero means off. They require no separate permission or process
mode. In the temperature-led ladle, the Heating period source supplies time
remaining, with zero outside the period. That one input defines when heating
can occur and its deadline; the policy calculates the requested heating power.
Process-mode codes remain in the source configuration, outside policy code.

The viewer shows physical connections normally, selected component information
inputs and their upstream dependencies on selection, or all information
connections via a toggle. The inspector lists input sources and can trace them
in the viewer. Policy edits update the model atomically with their settings and
connections, validate and run before application, and survive save/reopen.

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
| `ModelComponent` | Identity, definition version, parameters, initial state, and optional policy assignment |
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
             + (enthalpyIn + activeHeatIn + passiveHeatIn
                - enthalpyOut - activeHeatOut - passiveHeatOut)
               * dtSeconds / 3600
```

Temperature is derived from contained mass, contained enthalpy, specific heat
capacity, and the component's enthalpy-reference temperature. Cumulative mass
and energy transfers are result integrations, not component state.

Temperature is a derived output rather than an independent state. The current
store assumes one well-mixed material, constant specific heat capacity, no
phase change, and no stratification. Its instance name describes the equipment;
the component type describes the governing equation. The store owns the joint
feasibility of material transfer, active heat input and output, passive settled
heat flows, temperature, and capacity constraints. It does not own the physical
relationship that determines passive transfer to another body or boundary.

`thermal.heat-transfer` is a stateless, directed two-boundary component. It
determines equal source and sink heat flow from current boundary temperatures:

```text
Q = K * max(0, Tsource - Tsink)
```

Each connected finite body publishes `temperatureC`,
`thermalCapacitykWhPerK`, and its maximum temperature. A fixed-temperature
boundary instead publishes `fixedTemperatureBoundary: true`. The transfer is
capped so one explicit step cannot cross finite-body thermal equilibrium or
raise the sink above its maximum temperature. The source store accounts for
the settled flow on `passive-heat-out`; a finite sink accounts for it on
`passive-heat-in`; a constant-temperature boundary absorbs it without state.
The runtime must not repeat or partially reimplement either component equation.

Most ports accept one connection. A physical collector component may instead
declare a repeatable `many` port. Persisted connections then share that stable
port ID, while runtime evaluation keeps their flows separate by connection ID;
the generic connection check never balances an aggregate in place of an
individual connection.

The constant-temperature component has one repeatable incoming `heat-in` port
and reports the aggregate heat received across its independently checked
connections. It is an imposed boundary: its prescribed temperature may vary
between timesteps, but received heat does not change it. An instance named
“Ambient” represents the environment. The
electrical bus similarly has one repeatable bidirectional `terminal` port and
owns the power balance across its independently checked connections. Neither
component has an arbitrary connection-count limit, and neither requires
numbered placeholder ports.

The Push 1B reference model uses one deliberately fixed thermal topology:

```text
grid -> electric heater -> thermal store (hot-water instance) -> heat demand
                           |
                           +-> heat transfer -> constant temperature (“Ambient”)
```

The grid, heater, store, heat-transfer, demand, and constant-temperature
components own their respective equations. Policies choose operational targets;
the model explicitly assigns the grid the balancing role. The runtime orders
the component calculations and transfers their typed port flows; it must not use a whole-model
coupled resolver. Thermal branching requires a visible junction component with
an explicit component-owned allocation or mixing contract; it is not inferred
from component order.

A fixed component reports equal minimum and maximum operating power and needs
no policy target. A component with variable limits requires an explicit policy
target unless it is assigned the balancing role. Currently that role is encoded
as an `electrical.balance` policy assignment. The runtime derives its internal
`balancingComponentId` from
that assignment, or uses null when none is assigned. This slice supports one
electrical balancing role per model; multiple independent networks require an
explicit extension of the physical resolution contract.
Where residual balancing is required, the balancing component must be visible,
connected to the operation it balances, and physically able to accept it.
Where a branching electrical bus is
present, the bus owns only its terminal power-conservation equation; it does
not intrinsically select a grid or any other component to balance. A grid is
one possible balancing component. Positive grid power imports energy into the
model; negative grid power exports it.

The public Push 2 ladle cycle uses the same component contracts:

```text
Fuel burner -> Ladle lining
Molten-metal arrival -> Metal in ladle -> Casting process
                         |       |
                         |       +-> Heat transfer -> Ambient
                         +-> Heat transfer -> Ladle lining
Ladle lining -> Heat transfer -> Ambient
```

The refractory lining and molten metal are separate `thermal.store` instances.
The molten-metal instance alone connects material ports. The generic
`thermal.fuel-burner` owns fuel-to-heat efficiency and direct emissions; the
receiving store owns how much requested heat it can accept. The model does not
add a fuel-network component because this slice has no fuel-supply constraint.
Historical and temperature-led policies target the same visible components;
neither policy changes their governing equations.

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
- Are balancing roles configured explicitly and distinguished from operating
  policies?
- Does physical resolution use only declared boundary data from connected ports,
  while every runtime policy input arrives through an information connection?
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
