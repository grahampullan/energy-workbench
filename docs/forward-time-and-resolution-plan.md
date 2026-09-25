# Forward-time integration and topology-resolution plan

**Status:** Implemented for the current electrical, thermal, and material-flow
components; future flow types must extend the same small contract

**Date:** 18 August 2026

## Purpose

This plan records how Energy Workbench should advance state, determine flows in
an interactively assembled topology, and grow from the current batch-heating
example towards the private ladle study. It guides future work without
describing unimplemented behaviour as current architecture.

## Numerical contract

Energy Workbench uses explicit forward time integration. At time level `n`,
the runtime works only with current state, current scenario values, component
parameters, and current policy targets:

```text
state(n)
  -> capabilities(n)
  -> targets(n)
  -> actual flows(n)
  -> state(n+1)
```

No component may require `state(n+1)` to determine a flow at time level `n`.
A state transition therefore has the form:

```text
state(n+1) = state(n) + rate(n) * timestep
```

Reported energy and material totals must use the same current-step rectangular
sum as the state transitions. Prescribed values and resolved rates are held
constant over `[t(n), t(n+1))` and plotted as stepped intervals through the
final timestep boundary. States are plotted at their time boundaries; straight
lines between state points are visual interpolation only. The user is
responsible for choosing a sufficiently fine timestep; component tests should
check timestep refinement where it matters.

The preserved Visual Energy Modeller fixture remains historical evidence of
its trapezoidal chart integration. New Energy Workbench results should follow
the explicit-forward contract consistently.

## Resolution vocabulary

Use the existing terms precisely:

- **Prescribed:** fixed by the scenario.
- **Target:** requested by the policy.
- **Capability:** feasible operation published from current component state
  and parameters.
- **Actual:** the resolved operation and connection flow.

For dependency analysis, component definitions use two small contracts:

- **Publishes:** `getOperatingLimits` returns capabilities available from
  current state.
- **Requires:** prescribed values, targets, capabilities, or actual flows that
  must be available before the component can resolve.
- **Determines:** actual connection flows for which the component is the sole
  owner.

Because every component publishes operating limits before policy and
resolution, `resolution.describe` only needs to enumerate required policy
targets, required settled connection flows, and determined connection flows.
It does not repeat individual capability field names.

`Settled` describes an actual connection flow after its determining component
has produced it. These declarations belong to reusable component definitions,
not to component instances placed by the user. They describe dependencies;
the governing calculations remain in the component definition.

## Resolution-dependency graph

Physical flow direction does not necessarily give calculation order. A store
accepts heat in the physical direction of flow, but its current acceptance
capability may need to be known before a heat pump determines its output.

Runtime-model preparation resolves the topology. At each timestep, once the
current capabilities and selected policy roles are available, resolution-plan
preparation derives a dependency graph from:

```text
model topology
+ component resolution declarations
+ current policy roles
= resolution-dependency graph
```

Current states, parameters, prescribed values, and policy targets are roots.
State transitions lead only to the next time level and do not form part of the
same-time algebraic graph. The remaining operations can be topologically
ordered when the model is supported.

The analysis should report:

- a missing determiner for a connection flow;
- more than one determiner for a connection flow;
- a required policy target that is absent;
- incompatible port types or directions;
- an unavailable prerequisite; and
- a genuine same-timestep algebraic cycle.

A remaining cycle must be rejected, broken explicitly by a previous-timestep
state, or contained inside one component with a specific local solution. It
must not cause the generic runtime to become an implicit whole-model solver.

The checked graph now supplies the component execution stages. A component
returning `null` in its planned stage, or settling flows different from its
declaration, is a component-contract failure. Plans are retained in timestep
results so the interactive modeller can explain execution order in component
and connection terms.

## Heat-recovery acceptance topology

This later topology is a useful design test:

```text
Ladle -> Heat exchanger -> Heat pump -> Thermal store
                                  ^
                                  |
                           Electrical supply
```

At one time level, current ladle and store states publish source and sink
capabilities. Electrical supply publishes its capability, and policy publishes
the heat-pump target. The heat pump then determines its source heat,
electricity, and delivered heat. Actual extraction propagates back through the
heat exchanger while delivered heat and electrical demand propagate to their
destinations. Each stateful component advances only after all current flows
are settled and checked.

This topology now has a definition-level acceptance test. The test proves that
the heat pump can resolve first from current capabilities and its policy target,
followed by the heat exchanger and connected supplies/stores, without creating
a same-timestep cycle. It does not implement heat-recovery, heat-pump, or
broader thermal-storage physics; those remain conditional Push 3 scope.

## Material-inventory proof

The public headless proof is:

```text
Material source -> Thermal store (heated inventory) -> Material sink
```

The inventory conserves:

- incoming mass;
- contained mass;
- outgoing mass;
- incoming and outgoing enthalpy;
- contained enthalpy; and
- heat transferred through separate thermal ports.

The material connection contains exactly mass flow in kg/s and specific
enthalpy in kJ/kg. Temperature is derived from material inventory and
enthalpy. Cumulative mass in and out are integrated results rather than
additional stored states. The reviewed fixture tests fill, hold, heat, empty,
outflow limiting, conservation, dependency order, and aligned timestep
refinement.

## Ladle component direction

The refractory lining and molten metal should be separate stateful component
instances because they have different lifecycles:

- The refractory persists and has approximately fixed mass.
- The molten-metal inventory is filled, held, and emptied.

Both can use `thermal.store` while the shared constant-property, well-mixed
equation remains adequate. The refractory instance leaves its material ports
unconnected; the molten-metal instance connects them for filling and tapping.
An explicit `thermal.heat-transfer` instance between them owns directed
metal-to-refractory heat exchange from current-time temperatures and thermal
capacities. Its two ideal connections carry equal settled thermal flow; the
stores account for that flow in their separate enthalpy states. The model must
not hide tapping as an unexplained temperature reset or treat material transfer
as an ordinary thermal-flow connection. If a later case requires heat to
reverse direction, that boundary contract must be extended deliberately rather
than represented by a negative directed heat flow.

The public neutral ladle cycle implements this topology with explicit heat
losses to a constant-temperature Ambient boundary. A generic fuel burner
preheats the refractory and reports fuel input and direct emissions. A
historical schedule and a temperature-led policy operate the same physical
model. The latter uses current refractory capability and remaining preheat
time to target the required temperature plus a declared margin.

The public repository contains only the smallest reusable physical component
set with neutral synthetic tests. Private MHI-informed data, assumptions,
calibration, and the named ladle study remain outside the repository.

## Delivery sequence

1. Reconcile charts, KPIs, fixtures, and documentation with explicit-forward
   rectangular accounting, then test, build, and commit the current
   batch-heating UI slice.
2. Add the minimal resolution declarations and derive a checked resolution
   plan for all existing examples. **Complete.**
3. Prove material mass and enthalpy conservation headlessly through fill,
   hold, and empty operation. **Complete.**
4. Add refractory and molten-metal `thermal.store` instances around the shared
   `thermal.heat-transfer`, with timestep-refinement tests. Extend the component
   set only if these governing equations prove insufficient. **Complete.**
5. Add fuel, burner, process modes, policy comparisons, and the private ladle
   UI required for External Gate 2. **Public generic capability complete;
   private study and practitioner evaluation remain.**
6. Use the later heat-exchanger, heat-pump, and store topology to test the
   dependency design before undertaking conditional Push 3 implementation.
   **Dependency acceptance test complete; equipment implementation deferred.**

The dependency declarations and material-flow contract should remain as small
as the examples permit. Do not introduce a generic constraint language,
implicit network solver, or material ontology in anticipation of future work.
