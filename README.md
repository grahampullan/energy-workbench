# Energy Workbench

Explore electricity, heat, and material flows over time. Adjust component
parameters and operating rules, inspect the equations, and compare the results.
The browser and Node tests share one deterministic simulation, with explicit
timesteps and checks on energy and material balances.

## Getting started

Use Node.js 22, the version used for testing, and npm. From the repository root:

```sh
npm ci
npm start
```

Open [the workbench](http://127.0.0.1:4173). It starts with the PV and battery
example. `npm start` builds the browser bundle and starts a local static server.

## Explore a model

1. Choose an **Example**. **About example** explains its setup and operation.
2. Select a component in **Model**. The inspector shows its **Controls**,
   **Equations**, and **Policy** or **Role**.
3. Change a parameter to preview its effect. **Reset preview** restores the
   working model; **Apply** keeps the change in the current session.
4. In **Results**, choose a quantity and scrub the chart to select a timestep.
   Hover over a chart line or model connection to highlight its flow and components.
5. **Save model** downloads the applied model as JSON. **Open model** reloads a
   model compatible with the selected example's component layout. **Save variant**
   downloads preview parameter changes as a separate JSON document.

Solid connections carry energy or material. Dashed connections supply policy
inputs; selecting a component reveals them. **Show information connections**
reveals them all. The inspector lets you edit a policy and its inputs together.

Policies request operation; components enforce physical limits. A balancing
role, such as the grid's, supplies or absorbs the remaining power required.

Scenario-input curves are hidden until **Show scenario inputs** is enabled.
Temperature requirement lines remain visible. Component and schedule cards can
be moved; layout changes are temporary and reset when the page reloads.

## Examples

Six examples are available. The links describe their models and reviewed
regression results. The process examples use synthetic data.

| Example | What it shows |
| --- | --- |
| [PV and battery](docs/regression/blog-electrical.md) | A battery stores surplus solar power and covers shortfalls; the grid balances the remainder. |
| [Coupled thermal](docs/regression/coupled-thermal.md) | An electric heater and hot-water store supply changing heat demand, with losses and unmet demand reported. |
| [Batch heating](docs/regression/batch-heating.md) | A power schedule heats a fixed batch, with a check on its final temperature. |
| [Material inventory](docs/regression/material-inventory.md) | Material enters, is heated, and leaves a store; discharge is limited to available inventory. |
| [Ladle · historical](docs/regression/ladle-cycle.md) | A fixed burner schedule preheats a ladle before molten-metal arrival, holding, and discharge. |
| [Ladle · temperature-led](docs/regression/ladle-cycle.md) | The burner responds to lining temperature and time remaining, allowing fuel use to be compared with the fixed schedule. |

## Development and checks

```sh
npm test                         # Node tests and numerical regressions
npx playwright install chromium # Browser setup, after installing dependencies
npm run check                    # Node tests, browser build, and browser tests
```

To use an installed Google Chrome instead of Playwright's Chromium:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run check
```

`npm run test:browser` builds and runs just the browser checks. They cover all
examples and the select, preview, reset/apply, save, and reload workflow.

After changing browser code, run `npm run build` and refresh the page. Generated
bundles are ignored by Git. `npm run generate:blog-example` regenerates the
electrical example from its preserved legacy inputs.

## Versioning

- **Application:** [package.json](package.json) identifies a release, tagged as
  `vX.Y.Z`. During `0.x` development, minor releases introduce
  features or changed contracts; patch releases contain compatible corrections.
  Versions advance at release milestones, not on every commit.
- **Documents:** `schemaVersion` identifies the JSON format and changes with its
  contract, independently of the application version.
- **Components:** models pin an exact `definitionVersion`. Engineering contract
  changes require coordinated definition and model updates; internal refactoring
  and presentation changes do not. See [definition versions and saved-model
  updates](docs/component-development.md#definition-versions).

Record a study's model, scenario, any variant, and application release or Git
commit together. Component versions alone do not identify the whole simulation.

## Project contracts

- [Architecture](ARCHITECTURE.md): system boundaries and invariants.
- [Code shape](CODE_SHAPE.md) and [repository profile](CODE_SHAPE_PROFILE.md):
  simplicity, ownership, UI, and testing conventions.
- [Component development](docs/component-development.md): equations, ports,
  information inputs, policies, and extension tests.
- [JSON schemas](src/core/schemas): persisted document formats.
- [Time and resolution](docs/forward-time-and-resolution-plan.md): numerical
  conventions, dependency ordering, and planned extensions.
- [Architecture decisions](docs/adr/README.md): decision history.
- [Project gates](docs/project-gates.md): evaluation status and development scope.

The [example specifications](#examples) define the reviewed engineering behaviour.
Current models support electrical power, directed heat transfer, and material
flow with enthalpy, with one electrical balancing role per model. They use
explicit timestep calculations; general iterative solving and optimisation are
outside the current scope.
