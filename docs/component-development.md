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

  initialState: {},

  ports: [
    {
      id: "electricity-in",
      medium: "electricity.active-power",
      direction: "in"
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
    compile(modelComponent, context) {},
    initialise(runtimeComponent, scenario) {},
    getOperatingLimits(runtimeComponent, stepContext) {},
    evaluate(runtimeComponent, actualCommand, stepContext) {}
  }
};
```

This template illustrates the contract; the first implemented components will
fix the exact return shapes for compile, limits, and evaluation.

## Responsibilities

- Parameter declarations own units, defaults, hard bounds, model validity, and
  useful editor ranges.
- Ports declare compatibility. A connection does not redefine a port's medium
  or direction.
- `validate` checks engineering meaning that JSON Schema cannot express.
- `compile` resolves parameters and precomputes run-local coefficients.
- `initialise` creates state for one run; it does not modify the persisted
  component.
- `getOperatingLimits` reports what is feasible from current state.
- `evaluate` receives the actual allocated command and returns port flows,
  outputs, diagnostics, and proposed next state.
- The runtime checks balances before committing next state.

The policy requests operation. It does not set independent port flows or bypass
component limits.

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
