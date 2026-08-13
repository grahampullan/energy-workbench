# Component development

A component extension is one registered `ComponentDefinition` object plus
focused tests. Keep the public contract declarative and deterministic; classes
or closures may be private implementation details.

## Definition shape

```js
export const exampleComponentDefinition = {
  type: "domain.example",
  version: "0.1.0",
  name: "Example",

  parameters: {
    ratedPowerKw: {
      unit: "kW",
      default: 100,
      hardBounds: { minimum: 0 },
      validityRange: { minimum: 10, maximum: 500 },
      editor: { minimum: 0, maximum: 500, step: 5 }
    }
  },

  initialState: {
    generatedEnergyKwh: {
      unit: "kWh",
      default: 0
    }
  },

  ports: [
    {
      id: "electricity-out",
      medium: "electricity.active-power",
      direction: "out"
    }
  ],

  outputs: {
    powerKw: { unit: "kW" }
  },

  editor: {
    groups: [
      { id: "rating", label: "Rating", parameters: ["ratedPowerKw"] }
    ]
  },

  validate(modelComponent, context) {},

  model: {
    prepare(modelComponent, context) {
      return { conversionFactor: 1 };
    },
    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },
    getOperatingLimits(runtimeComponent) {
      return {
        minimumPowerKw: 0,
        maximumPowerKw: runtimeComponent.parameters.ratedPowerKw
      };
    },
    evaluate(runtimeComponent, actualCommand, stepContext) {
      return {
        portFlows: {
          "electricity-out": { powerKw: actualCommand.powerKw }
        },
        outputs: { powerKw: actualCommand.powerKw },
        nextState: {
          generatedEnergyKwh:
            stepContext.state.generatedEnergyKwh +
            actualCommand.powerKw * stepContext.durationHours
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
- Ports declare compatibility. A connection does not redefine a port's medium
  or direction.
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

- The runtime evaluates every component's current operating limits once before
  requesting policy operation.
- `policy.request(runtimeModel, stepContext, policyContext)` returns an object
  keyed by non-grid controllable component ID, with commands shaped as
  `{ powerKw }`.
- `policyContext.operatingLimitsByComponentId` is a read-only plain-object
  snapshot. Policies may use it to coordinate components without repeating
  component equations.
- Positive command power exports from a component; negative power imports into
  it.
- For an active-power component, `getOperatingLimits` includes finite
  `minimumPowerKw` and `maximumPowerKw` values. Equal values prescribe fixed
  operation and need no policy request. Thermal components return the explicit
  heat-rate, temperature, and state-dependent limits required by their current
  resolver.
- `stepContext` contains `stepIndex`, `timeStepSeconds`, `durationHours`,
  `elapsedSeconds`, current `seriesValues`, and isolated component state.
- `evaluate` returns `{ portFlows, outputs, nextState, diagnostics }`. Electrical
  directed-port flow is non-negative in the declared direction. Bidirectional
  port flow is signed: positive export and negative import.
- The runtime commits all proposed next states only after every connection has
  passed its balance check.
- External series must be loaded and materialised before calling `runScenario`.

Connection `powerKw` is signed from its persisted `from` endpoint towards `to`.
The current resolver accepts one `electrical.bus` with four bidirectional
terminals. Each external component has one electrical connection, and each bus
terminal has at most one. Exactly one `electrical.grid` is the residual
boundary: its requested and feasible commands are `null`, and the resolver sets
its actual command after fixed and explicitly policy-controlled operation.
Positive grid power is import into the model; negative grid power is export.
The grid limits can make a timestep infeasible. This keeps balancing separate
from policy and avoids treating component array order as dispatch priority.

The current `electrical.pv` is prescribed by its scenario series: equal limits
make all available generation actual generation. Curtailment is not inferred by
the resolver; it would require an explicit controllable-component contract.

### Restricted thermal ports

A directed `thermal.heat-flow` port reports exactly:

```js
{
  heatFlowKw,
  sourceTemperatureC,
  deliveryTemperatureC
}
```

`heatFlowKw` is non-negative in the declared direction. All three values are
finite, temperatures are in °C and no lower than absolute zero, and positive
flow cannot have a delivery temperature above its source temperature. A zero
flow still carries boundary temperatures, which may be in either order.

Components own temperature constraints. For example, the heater declares its
supply temperature, the hot-water store requires incoming heat to be hot enough
to charge it, and the demand reports heat below its minimum delivery temperature
as unmet. Thermal connections do not infer mass flow, pressure, mixing, or pipe
delay.

The hot-water store has separate `heat-in`, `heat-out`, and `heat-loss` ports.
Its actual command names charge heat flow and temperatures, discharge heat flow,
and ambient temperature separately. Its mixed temperature state uses explicit
integration over `stepContext.durationHours`:

```text
C * (Tnext - T) / dt = Qcharge - Qdischarge - Qloss
Qloss = UA * max(0, T - Tambient)
```

Over a coarse timestep, loss is capped at the energy available above ambient so
standing loss alone cannot cool the store through the ambient boundary.

### Restricted coupled runtime

`runScenario` keeps the electrical-only path for models without thermal ports.
For Push 1B it also recognises exactly:

```text
electrical bus -> electric heater -> hot-water store -> heat demand
                                      |
                                      +-> ambient boundary
```

`createHeatDemandFollowingPolicy({ heaterComponentId, demandComponentId })`
requests heater electrical input from the current heat demand and the heater's
declared conversion. The coupled resolver then:

1. allocates useful store discharge up to demand;
2. clamps heater output by electrical, store-capacity, and temperature limits;
3. allocates standing loss to ambient; and
4. passes feasible heater input to the electrical-bus resolver for grid balance.

The heater's requested command is `{ powerKw }`. Its feasible and actual
commands also contain `heatOutputKw`, making the cross-domain allocation
explicit. Store, demand, and ambient commands are resolver-owned. Every thermal
connection is checked for matching heat rate, source temperature, and delivery
temperature before state is committed.

This is a serial service resolver, not a thermal bus. Additional stores,
demands, heaters, branches, or junctions require an explicit new topology and
allocation contract.

### Battery storage

`electrical.battery` has one bidirectional active-power port and one signed
command. Positive battery power discharges to the bus; negative battery power
charges from it. This prevents simultaneous charge and discharge commands.

For charge power `Pc = max(0, -powerKw)`, discharge power
`Pd = max(0, powerKw)`, and timestep `dt` in hours, stored energy advances as:

```text
E_next = E + chargingEfficiency * Pc * dt
           - Pd * dt / dischargingEfficiency
```

The operating limits convert remaining stored energy and capacity into terminal
power for the current timestep:

```text
minimumPowerKw = -min(maximumChargePowerKw,
                      (capacityKwh - E) / chargingEfficiency / dt)

maximumPowerKw =  min(maximumDischargePowerKw,
                      E * dischargingEfficiency / dt)
```

The battery therefore requires an explicit policy request. The grid balances
the remainder after that request is clamped. Stored-energy outputs describe the
end of the completed timestep, matching the committed next state.

### PV-battery self-consumption policy

`createPvBatterySelfConsumptionPolicy({ batteryComponentId })` implements the
Push 1A priority without knowing PV or load equations. It sums the fixed
operating power of every component other than the bus, grid, and target battery,
then requests the opposite power from the battery:

```text
battery request = -(fixed generation + fixed demand)
```

The resolver clamps that request to battery power and energy limits. The grid
then balances any remainder. This means surplus serves fixed demand, charges
the battery, then exports; a deficit uses fixed generation, discharges the
battery, then imports. The policy rejects any additional variable component,
because dispatch priority for multiple controllable devices must be explicit.

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
