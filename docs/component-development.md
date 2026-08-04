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

- `policy.request(runtimeModel, stepContext)` returns an object keyed by
  component ID, with commands shaped as `{ powerKw }`.
- Positive command power exports from a component; negative power imports into
  it.
- `getOperatingLimits` returns finite `minimumPowerKw` and `maximumPowerKw`
  values. Clamping a request produces the feasible command; the resolver then
  produces the balance-constrained actual command.
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
terminal has at most one. Branching fixed loads are supported, but only one
controllable component may balance the bus. This avoids treating component
array order as an implicit dispatch policy.

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
