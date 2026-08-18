# Component development

A component extension is one registered `ComponentDefinition` object plus
focused tests. Keep the public contract declarative and deterministic; classes
or closures may be private implementation details.

## Definition shape

```js
export const exampleComponentDefinition = {
  type: "domain.example",
  version: "0.2.0",
  name: "Example",

  parameters: {
    ratedPowerkW: {
      unit: "kW",
      default: 100,
      hardBounds: { minimum: 0 },
      validityRange: { minimum: 10, maximum: 500 },
      editor: { minimum: 0, maximum: 500, step: 5 }
    }
  },

  initialState: {
    generatedEnergykWh: {
      unit: "kWh",
      default: 0
    }
  },

  ports: [
    {
      id: "electricity-out",
      flowType: "electricity.active-power",
      direction: "out"
    }
  ],

  outputs: {
    powerkW: { unit: "kW" }
  },

  editor: {
    groups: [
      { id: "rating", label: "Rating", parameters: ["ratedPowerkW"] }
    ]
  },

  validate(modelComponent, context) {},

  resolution: {
    describe(runtimeComponent, context) {
      const [connection] = context.connections;
      return {
        requires: {
          targets: [runtimeComponent.id],
          connectionFlows: []
        },
        determines: [connection.id]
      };
    }
  },

  model: {
    prepare(modelComponent, context) {
      return { conversionFactor: 1 };
    },
    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },
    getOperatingLimits(runtimeComponent) {
      return {
        minimumPowerkW: 0,
        maximumPowerkW: runtimeComponent.parameters.ratedPowerkW
      };
    },
    resolve(runtimeComponent, resolutionContext) {
      const [connection] = resolutionContext.connections;
      const powerkW = Math.min(
        resolutionContext.operatingLimits.maximumPowerkW,
        Math.max(
          resolutionContext.operatingLimits.minimumPowerkW,
          resolutionContext.target.powerkW
        )
      );
      return {
        feasibleCommand: { powerkW },
        actualCommand: { powerkW },
        connectionFlows: {
          [connection.id]: { powerkW }
        }
      };
    },
    evaluate(runtimeComponent, actualCommand, stepContext) {
      return {
        portFlows: {
          "electricity-out": { powerkW: actualCommand.powerkW }
        },
        outputs: { powerkW: actualCommand.powerkW },
        nextState: {
          generatedEnergykWh:
            stepContext.state.generatedEnergykWh +
            actualCommand.powerkW * stepContext.durationHours
        },
        diagnostics: []
      };
    }
  }
};
```

This template illustrates the active-electrical-power contract established by
the first runtime slice.

## Responsibilities

- Parameter declarations own units, defaults, hard bounds, model validity, and
  useful editor ranges.
- Initial-state declarations own units and defaults. Component validation owns
  state constraints that depend on parameters or other state fields.
- Ports declare compatibility through `flowType` and permitted direction. A
  connection stores only endpoint references and does not duplicate either.
- A port accepts one connection by default. Set `cardinality: "many"` only when
  the component physically represents a collector whose one logical boundary
  can accept any number of independent connections.
- `validate` checks engineering meaning that JSON Schema cannot express. It
  returns an array of `{ severity, code, message, path }` diagnostics, or
  `undefined` when there are none; omitted severity means `error`.
- `prepare` receives a detached `ModelComponent` with parameter and
  initial-state defaults filled. It returns a JSON-compatible plain object,
  stored as `RuntimeComponent.modelData`, for run-local coefficients and other
  component-owned prepared data.
- `initialise` creates state for one run; it does not modify the persisted
  component.
- `getOperatingLimits` reports what is feasible from current state.
- `getOperatingLimits` publishes capabilities. `resolution.describe` declares
  the targets and already-settled connection flows needed for current
  resolution, plus the connection flows this component determines. It contains
  no governing calculation.
- `resolve` owns the component's physical reconciliation. It returns
  `{ feasibleCommand, actualCommand, connectionFlows }`, or `null` when it is
  waiting for a connected component to settle a flow.
- `evaluate` receives the actual allocated command and returns port flows,
  outputs, diagnostics, and proposed next state.
- The runtime checks balances before committing next state.

The policy requests operation. It does not set independent port flows or bypass
component limits.

## Runtime preparation

`prepareRuntimeModel({ model, scenario, registry })` is the deterministic
boundary between persisted study documents and runtime objects. It:

- validates detached model and scenario snapshots;
- resolves exact component definitions, defaults, ports, and connections; and
- calls each definition's `model.prepare` function.

A successful result contains `{ prepared: true, runtimeModel, diagnostics }`.
Validation or component-contract failures contain
`{ prepared: false, runtimeModel: null, diagnostics }`. Model-validity warnings
do not prevent preparation.

Preparation does not mutate inputs, load external series, initialise timestep
state, cache work, generate code, or simulate. Those responsibilities remain at
their explicit boundaries.

## Fixed-timestep execution

`runScenario({ model, scenario, policy, registry, options })` prepares the model,
initialises isolated state, and runs every scenario step synchronously.

Each step uses only current state, current materialised scenario values,
component parameters, and current policy targets to determine actual flows.
Components then advance their state explicitly to the next time level. A
current flow must not depend on a proposed next state. Integrated rate totals
use the same current-step rectangular sum; timestep refinement controls
accuracy.

In browser presentation, step `n` is labelled as the interval
`[t(n), t(n+1))`. Commands, prescribed inputs, and connection rates apply
during that interval. Component state is labelled at the timestep end. Rate
plots use zero-order-hold steps and extend through the run's final boundary;
calculated state plots may connect boundary samples with straight visual
segments.

- The runtime evaluates every component's current operating limits once before
  requesting policy operation.
- `policy.request(runtimeModel, stepContext, policyContext)` returns
  `{ targets, balancingComponentId }`. Targets are keyed by component ID. The
  balancing component is explicit and must not also receive a target.
- `policyContext.operatingLimitsByComponentId` is a read-only plain-object
  snapshot. Policies may use it to coordinate components without repeating
  component equations.
- The runtime checks each component's resolution declaration after the policy
  request, rejects missing or conflicting flow ownership and same-step cycles,
  and executes the resulting stages in dependency order.
- Positive command power exports from a component; negative power imports into
  it.
- For an active-power component, `getOperatingLimits` includes finite
  `minimumPowerkW` and `maximumPowerkW` values. Equal values prescribe fixed
  operation and need no policy request. Thermal components return the explicit
  heat-rate, temperature, and state-dependent capabilities required by their
  connected components.
- `stepContext` contains `stepIndex`, `timeStepSeconds`, `durationHours`,
  `elapsedSeconds`, current `seriesValues`, and isolated component state.
- `evaluate` returns `{ portFlows, outputs, nextState, diagnostics }`. A normal
  port value is one flow object. A `many` port value is an object keyed by the
  IDs of every connection attached to that port, with one flow object per
  connection. Electrical directed-port flow is non-negative in the declared
  direction. Bidirectional port flow is signed: positive export and negative
  import.
- The runtime commits all proposed next states only after every connection has
  passed its balance check.
- External series must be loaded and materialised before calling `runScenario`.

Each connection result has the shape
`{ connectionId, flowType, flow }`. For active power, `flow` is exactly
`{ powerkW }`; its value is signed from the persisted `from` endpoint towards
`to`. Endpoint mismatch is a `runtime.connection-balance` diagnostic, not a
result field.

Each timestep result also contains `resolutionPlan`. Its `stages` are arrays
of component IDs that can resolve at the same dependency depth. The full plan
returned by `prepareResolutionPlan` also exposes each component's prerequisites
and determined connections for diagnostics.

The current `electrical.bus` has one repeatable bidirectional `terminal` port.
It waits for its non-balancing connection flows, applies its own conservation
equation, and settles the connection to the policy's `balancingComponentId`.
The balancing component then checks that residual against its own limits. A
grid is one possible balancing component; it is not selected automatically.
Positive grid power is import into the model; negative grid power is export.
The grid limits can make a timestep infeasible.

The current `electrical.pv` is prescribed by its scenario series: equal limits
make all available generation actual generation. Curtailment would require an
explicit controllable-component contract and policy target.

### Restricted thermal ports

A directed `thermal.heat-flow` port reports a `flow` object containing exactly:

```js
{
  heatFlowkW,
  sourceTemperatureC,
  deliveryTemperatureC
}
```

`heatFlowkW` is non-negative in the declared direction. All three values are
finite, temperatures are in °C and no lower than absolute zero, and positive
flow cannot have a delivery temperature above its source temperature. A zero
flow still carries boundary temperatures, which may be in either order.

Components own temperature constraints. For example, the heater declares its
supply temperature, the thermal store requires incoming heat to be hot enough
to heat it, and the demand reports heat below its minimum delivery temperature
as unmet. Thermal connections do not infer mass flow, pressure, mixing, or pipe
delay.

The constant-temperature component exposes one repeatable incoming `heat-in`
port. Every physical loss connection references that port but retains its own
settled thermal flow and endpoint balance check; the boundary reports their sum
as `receivedHeatFlowkW`. Its prescribed temperature may vary between timesteps,
but received heat does not change it. Use an instance named “Ambient” for the
environment. Do not add an aggregation component solely to combine heat losses
before this boundary.

### Material mass and enthalpy flow

A directed `material.mass-flow` port reports exactly:

```js
{
  massFlowKgPerSecond,
  specificEnthalpyKjPerKg
}
```

Mass flow is finite and non-negative in the declared direction. Specific
enthalpy is finite; its reference state belongs to the component model. The
transported enthalpy rate is
`massFlowKgPerSecond * specificEnthalpyKjPerKg` in kW. Do not duplicate
temperature on this connection or infer composition, pressure, phase, or
mixing in generic connection execution.

`thermal.store` has optional `material-in` and `material-out` ports, repeatable
`heat-in`, `passive-heat-in`, and `passive-heat-out` ports, and an optional
`heat-out` port. The ports always exist; their connections determine whether an
instance is a closed fixed-mass thermal body or a flowing material inventory.
Do not add an equipment-specific mode flag.

The store keeps only mass and contained enthalpy as state. It derives
temperature using constant specific heat capacity and an enthalpy-reference
temperature. Start-of-step mass and specific enthalpy limit and characterise
outflow. An empty store has zero contained enthalpy and reports its reference
temperature. Its explicit update is:

```text
massNext = mass + (massIn - massOut) * dtSeconds
enthalpyNext = enthalpy
             + (enthalpyIn + activeHeatIn + passiveHeatIn
                - enthalpyOut - activeHeatOut - passiveHeatOut)
               * durationHours
```

`thermal.heat-transfer` owns passive temperature-driven transfer between two
visible boundaries:

```text
Q = K * max(0, Tsource - Tsink)
```

It requires one source connection and one sink connection. A finite source or
sink publishes current temperature and thermal capacity; a fixed-temperature
boundary publishes that role explicitly. Over a coarse timestep, transfer is
capped at finite-body equilibrium and at the sink maximum temperature. Connect
a store's `passive-heat-out` to the transfer's `source`, then connect the
transfer's `sink` to another store's `passive-heat-in` or to a
constant-temperature boundary. The store
accounts for settled passive heat but does not calculate `K * ΔT`.

The current definition represents one well-mixed material with constant
specific heat capacity and no phase change or stratification. An equipment
name such as “hot-water tank”, “refractory”, or “molten-metal inventory” belongs
to the component instance when these equations are suitable.

### Coupled reference model

The Push 1B reference model is:

```text
grid -> electric heater -> thermal store (hot-water instance) -> heat demand
                           |
                           +-> heat transfer -> constant temperature (“Ambient”)
```

`createHeatDemandFollowingPolicy({ heaterComponentId, demandComponentId,
balancingComponentId })`
requests heater electrical input from the current heat demand and the heater's
declared conversion. Component resolution then follows the visible topology:

1. the heat-transfer component settles passive source and sink flows from the
   current store and prescribed Ambient temperatures;
2. the store settles charge, useful discharge, and temperature limits while
   accounting for the settled passive flow;
3. the heater applies its conversion equation to the accepted heat flow;
4. the policy-selected grid checks and accepts the heater's electrical flow.

The heater's requested command is `{ powerkW }`. Its feasible and actual
commands also contain `heatOutputkW`, making the cross-domain allocation
explicit. Store, demand, and constant-temperature operation follows their component-owned
equations. Every thermal
connection is checked for matching heat rate, source temperature, and delivery
temperature before state is committed.

This is not a thermal bus. Thermal branches require a visible junction
component that owns their allocation or mixing equation.

### Battery storage

`electrical.battery` has one bidirectional active-power port and one signed
command. Positive battery power discharges to the bus; negative battery power
charges from it. This prevents simultaneous charge and discharge commands.

For charge power `Pc = max(0, -powerkW)`, discharge power
`Pd = max(0, powerkW)`, and timestep `dt` in hours, stored energy advances as:

```text
E_next = E + chargingEfficiency * Pc * dt
           - Pd * dt / dischargingEfficiency
```

The operating limits convert remaining stored energy and capacity into terminal
power for the current timestep:

```text
minimumPowerkW = -min(maximumChargePowerkW,
                      (capacitykWh - E) / chargingEfficiency / dt)

maximumPowerkW =  min(maximumDischargePowerkW,
                      E * dischargingEfficiency / dt)
```

The battery therefore requires an explicit policy target unless it is selected
as the balancing component. The battery clamps the target against its own power
and energy limits. Stored-energy outputs describe the end of the completed
timestep, matching the committed next state.

### PV-battery self-consumption policy

`createPvBatterySelfConsumptionPolicy({ batteryComponentId,
balancingComponentId })` implements the
Push 1A priority without knowing PV or load equations. It sums the fixed
operating power of every component other than the bus, grid, and target battery,
then requests the opposite power from the battery:

```text
battery request = -(fixed generation + fixed demand)
```

The battery clamps that target to its own power and energy limits. The visible
bus sends any remainder to the named balancing component. This means surplus
serves fixed demand, charges the battery, then exports; a deficit uses fixed
generation, discharges the battery, then imports. The policy rejects any
additional variable component because dispatch priority for multiple
controllable devices must be explicit.

## Definition checklist

Document and test:

- Type ID and definition version.
- Equations and sign conventions.
- Parameter, state, port, and output units.
- Hard bounds and intended validity range.
- Initial-state meaning.
- Requested command and operating-limit meaning.
- State integration and fixed-timestep assumptions.
- Conservation or balance relationship.
- Boundary behavior and diagnostics.

Keep calculations pure. Do not read files, environment values, clocks, random
values, browser state, or global registries from component behaviour. Receive
all dependencies through the supplied context.

## Minimum tests

- Defaults and engineering validation.
- Each hard limit and important validity warning.
- Zero, nominal, and maximum operation.
- State transitions at lower and upper bounds.
- Port-flow and conversion balance.
- Deterministic repeatability.
- Timestep refinement for stateful components.
- Output variables distinct from internal state.
