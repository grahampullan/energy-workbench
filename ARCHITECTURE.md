# Architecture

This is the normative architecture contract for Energy Workbench. Keep it
focused on system boundaries and invariants. API details belong in the
[component guide](docs/component-development.md), example behaviour in
[regression specifications](docs/regression), and decision history
in [ADRs](docs/adr/README.md). Product scope and sequencing belong in the roadmap.

## One model, one runtime

The browser, Node tests, and CLI use the same deterministic simulation:

```text
JSON model + component/policy registry + scenario -> runScenario -> results
```

Engineering calculations are pure and independent of UI, file handling, and
subscriber order. Pass dependencies explicitly; runs own their state and never
mutate persisted inputs. Equivalent inputs must produce equivalent results
across browser and Node execution.

## Source boundaries

| Module | Responsibility |
| --- | --- |
| `src/core` | Plain-data contracts, commands, queries, and validation. |
| `src/components` | Component equations, physical limits, feasibility, state transitions, and public ports. |
| `src/policies` | Requests for an owning component, using connected information inputs and fixed settings. |
| `src/runtime` | Preparation, dependency ordering, connection transfer, consistency checks, state commit, and results. |
| `src/ui` | Presentation, inspectors, previews, and browser file interaction. |
| `src/cli` | Node composition and file I/O. |

Core, components, policies, and runtime contain no environment I/O or UI code.
Components and runtime may import core; component definitions and policies are
registered at composition boundaries. Engineering modules never import UI or
CLI modules. UI and CLI contain no engineering equations or second simulation
path. Runtime contains no component-type branches or model-specific physics.

## Model contracts

Keep three representations distinct:

- `ModelComponent`: persisted JSON instance, parameters, initial state, and
  optional policy assignment.
- `ComponentDefinition`: registered specification and deterministic behaviour.
- `RuntimeComponent`: prepared data and isolated state for one run.

Use qualified engineering names such as `Component`, `Port`, and `Connection`;
avoid an ambiguous exported `Component` class. JSON is the portable format,
IDs are stable, and layout is separate from engineering data. Large time series
belong in external files and must be materialised before simulation.

### Components, connections, policies, and roles

| Abstraction | Responsibility |
| --- | --- |
| Component | Owns its equations, state, capabilities, feasibility, and public ports. |
| Physical port | Declares a flow type, permitted direction, and boundary data needed by its equations. |
| Physical connection | Couples compatible ports; transfers conserved energy or material. |
| Information port | Declares a named value with quantity, unit, and calculation availability. |
| Information connection | Copies a published value to a declared input; transfers no energy or material. |
| Operating policy | Chooses its component's requested operation from connected inputs and fixed settings. |
| Balancing role | Explicitly assigns the physical boundary that accepts the remainder required by conservation. |

Every supply, conversion, loss, store, junction, or balancing component is
explicit and visible in the topology. Its definition owns its equations; the
runtime cannot act as hidden equipment or determine physical allocation from
component order.

Physical resolution may read only declared boundary data from connected ports:
capabilities, prescriptions, targets, and settled flows needed by its equations.
The calculation direction may differ from the flow direction. Physical
adjacency does not grant access to arbitrary state or settings.
Runtime enforces this with immutable port references, explicitly published
boundary fields, and connected flow prerequisites. Component callbacks receive
only their own state and declared scenario profiles.

Every runtime policy input arrives through an information connection, including
its own component's state or capabilities. A policy receives only immutable
input values and settings, never the model, scenario, clock, or global state.
Information connections may join physically non-adjacent components. Output
readers use only their own state, parameters, capabilities, and connected inputs.
Component-owned prescribed profiles remain inputs to that component's equation;
a policy needing a schedule receives it from a named information source.

Information is evaluated before policies from current profiles, start-of-step
state/capabilities, and derived outputs in dependency order. Same-step cycles
are rejected. Current-step settled flows, policy outputs, and proposed next
states cannot feed this stage. There is no implicit delay or event bus. Only a
schedule source may inspect its future entries and publish period information.

A balancing role is physical configuration: it accepts a conservation remainder
within the component's limits. A port cannot have both an independent policy
target and a balancing requirement for the same flow field in one timestep.

## Flow resolution

| Term | Meaning |
| --- | --- |
| Prescribed | Exact operation fixed by scenario, state, or component equation. |
| Target | Desired operation requested by a policy or calculated by a visible junction. |
| Capability | Limits or requirements a component can support at the current timestep. |
| Actual | Operation accepted after physical reconciliation. |

Keep requested, feasible, and actual operation distinct. Components reconcile
targets with capabilities; runtime does not clamp flows using component physics.
For active power, equal minimum and maximum limits prescribe operation. Variable
operation needs a target or an explicitly assigned balancing role.

Each actual flow field must have one clear determination path. Capabilities at
both endpoints are normal; competing prescriptions are over-specified unless
the flow contract defines a shared-potential rule. Missing determination is
under-specified; incompatible capabilities are infeasible. Report structural
errors before resolution and state-dependent failures during the timestep.

Physical connections are ideal, lossless, and non-accumulating. Endpoint flows
must match after direction normalisation. Conversion, storage, splitting,
mixing, and losses belong in visible components. Repeatable ports retain one
flow and balance check per connection; an aggregate cannot replace those checks.
A mismatch is a diagnostic, not a public residual flow field.

Core `FlowType` contracts define exact fields, units, and boundary validation.
The runtime may transfer and check those fields, but cannot interpret arbitrary
feasible regions, choose dispatch priorities, or solve component equations.
Persisted endpoints define the `from`-to-`to` reference. Directed flow is
non-negative in its permitted direction; bidirectional flow may be signed.
Electrical command power is positive for component export and negative for
import. Connection power is positive from `from` towards `to`.

## Time and state

Each step follows one deterministic direction:

```text
current state and capabilities
-> checked information graph -> policy targets and configured balancing roles
-> component-owned capability refinement -> checked resolution plan
-> component resolution and evaluation -> flow checks -> state commit
```

Capabilities are published before policy requests and refined once with the
chosen target. `resolution.describe` declares prerequisites and determined
flows; it contains no governing calculation. Runtime derives acyclic execution
stages, rejects absent or conflicting determiners and prerequisites, and retains
the plan in timestep results. It does not iterate to resolve cycles.

State advances explicitly from current state and actual flows. No current flow
may require a proposed next state. Commit next states only after consistency
checks pass. Integrated totals use the same current-step rectangular sum as
state transitions; user-chosen timestep refinement controls accuracy.

A result step represents `[t(n), t(n+1))`. Prescribed values and settled rates
are held constant over that interval. Initial and resulting states belong at
`t(n)` and `t(n+1)`; straight chart segments between state samples are visual
interpolation only. Units and timestep conventions are explicit and tested.

## Validation and interaction

JSON Schema validates structure; JavaScript validates references, units,
topology, limits, and physical meaning. Reject invalid input clearly.

Parameters remain plain values. Preview overrides are temporary; applying an
edit changes the working model through a validated command. Policy choices,
settings, and input connections change atomically. Saved variants are separate
reproducible documents.

One UI coordinator schedules preview runs and derives graph, chart, KPI, and
diagnostic views from canonical results. Control labels update immediately;
the scheduler retains at most the current run and latest pending request,
always runs the final value, and rejects stale results. Views dispose their
subscriptions; a failing view cannot corrupt run state.

Static equation descriptions belong to component and policy definitions. The
UI renders them without evaluating them, substituting timestep values, or
persisting them in model/results data. Presentation libraries and observables
stay in UI. Unit-display conventions and interaction details are in
[CODE_SHAPE_PROFILE.md](CODE_SHAPE_PROFILE.md#ui-defaults).

## Current scope

The supported flow contracts are active electrical power, directed heat flow,
and directed material mass flow with specific enthalpy. This runtime supports
one electrical balancing role per model. General iterative/acausal solving,
arbitrary constraint languages, and implicit redispatch are outside its scope.

Add abstractions only for a current Push
requirement; do not pre-emptively introduce servers, workers, agents, plugins,
general hooks, equation systems, or optimisation layers.

## Supporting references

- [Component development](docs/component-development.md): API shapes, flow
  fields, component equations, policies, and extension tests.
- [Numerical contract and resolution plan](docs/forward-time-and-resolution-plan.md):
  timestep accounting, dependency analysis, and planned extensions.
- [Regression specifications](docs/regression): example topologies,
  schedules, assumptions, and reviewed results.
- [Code shape profile](CODE_SHAPE_PROFILE.md): repository, UI, and review defaults.
- [ADRs](docs/adr/README.md): decisions and their supersession history.
