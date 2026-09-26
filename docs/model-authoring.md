# Model authoring

This guide is for people and coding agents assembling models from existing
components. JSON specifies the equipment, connections, settings, and scenario.
Component equations and policy algorithms live in JavaScript; adding those is
covered by [Component development](component-development.md).

## Start from an example

Use [PV and battery](../examples/blog-electrical) for an electrical model,
[coupled thermal](../examples/coupled-thermal) for electrical heating, or
[material inventory](../examples/material-inventory-synthetic) for material flow.
The [ladle examples](../examples/ladle-cycle-synthetic) include scheduled and
temperature-led heating. Use `model.json`, not the historical `legacy-model.json`.

For a new study, copy a suitable example into its own directory and keep these
three documents together:

| Document | Contents |
| --- | --- |
| `model.json` | Components, parameters, initial states, physical connections, policy assignments, information sources and connections. |
| `scenario.json` | Timestep duration, number of steps, and input time series. |
| `layout.json` | Component positions; `modelId` must match the model. Only needed for the browser. |

Give a new study distinct document IDs and update references together. A saved
edit intended for the existing browser example must retain its model and
component identities; see [Browser use](#browser-use).

## Assemble the model

1. **Choose registered components.** Read the definitions in
   [electrical](../src/components/electrical),
   [thermal](../src/components/thermal), and
   [material](../src/components/material). Copy the exact `type` and `version`
   into each instance's `type` and `definitionVersion`. Read `parameters`,
   `initialState`, `ports`, and `information` for valid fields, units, defaults,
   and limits. Each instance needs a unique `id`, a `name`, and the
   `parameters` and `initialState` objects, even when empty.
2. **Connect physical ports.** Each connection needs a unique `id`, a `name`,
   and `from`/`to` endpoints containing `componentId` and `portId`. Flow type
   and direction come from the ports. Connect compatible ports and observe
   their allowed connection counts. Keep sources, stores, conversions, and
   losses explicit in the graph.
3. **Choose policies and connect their inputs.** The
   [policy catalogue](../src/policies/definitions.js) declares supported
   component types, required physical ports, inputs, and settings. Assign
   `policy: { type, settings }` and supply every input through
   `informationConnections`, using `policy.<input-name>` as the destination
   port. Match both quantity and unit. Even a policy's own component state
   arrives through a connection. A schedule input uses a named
   `informationSources` entry referring to a scenario series. The accepted
   balancing role `electrical.balance` uses the same policy field and has no
   information inputs; the current runtime permits at most one per model.
4. **Supply a scenario.** Set `time.timeStepSeconds` and `time.stepCount`.
   Every inline series needs exactly `stepCount` values and the units expected
   by its consumer. Series IDs must match component parameters or information
   sources. Rates apply over each timestep; initial states belong at time zero.
   Use inline data to start. External series must be loaded into inline values
   before simulation; neither the runtime nor the browser loader reads CSV
   references automatically.

The [schemas](../src/core/schemas) specify document structure. Component and
policy definitions supply the engineering details that schemas alone cannot
check. Keep the current `schemaVersion` when creating documents in that format;
it is independent of component and application versions.

## Run and inspect

There is currently no general command-line runner. After `npm ci`, paste this
from the repository root to run the supplied PV example through the same API
used by the browser:

```sh
node --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { createComponentRegistry } from "./src/core/component-registry.js";
import { policyDefinitions } from "./src/policies/definitions.js";
import { electricalBatteryDefinition } from "./src/components/electrical/battery.js";
import { electricalBusDefinition } from "./src/components/electrical/bus.js";
import { electricalGridDefinition } from "./src/components/electrical/grid.js";
import { electricalLoadDefinition } from "./src/components/electrical/load.js";
import { electricalPvDefinition } from "./src/components/electrical/pv.js";
import { runScenario } from "./src/runtime/run-scenario.js";

const directory = "./examples/blog-electrical";
const [model, scenario] = await Promise.all(
  ["model", "scenario"].map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}.json`, "utf8")))
);
const registry = createComponentRegistry([
  electricalBatteryDefinition, electricalBusDefinition,
  electricalGridDefinition, electricalLoadDefinition, electricalPvDefinition
], { policies: policyDefinitions });
const run = runScenario({ model, scenario, registry });
console.log(JSON.stringify({
  completed: run.completed,
  stepCount: run.results?.steps.length ?? 0,
  diagnostics: run.diagnostics
}, null, 2));
if (!run.completed) process.exitCode = 1;
JS
```

The supplied example completes 1,440 steps with no diagnostics. For your own
study, change `directory` and register the component definitions it uses.
Policies must also be registered. To try a parameter edit without saving,
insert `model.components.find(({ id }) => id === "pv").parameters.profileMultiplier = 1.2;`
before `runScenario`.

`runScenario` validates the model and scenario, prepares the calculation order,
and checks each timestep. Failures return `completed: false`, `results: null`,
and diagnostics with `code`, `message`, and `path`. Fix the reported input or
model issue and rerun. Completed runs contain `results.initialStates` and
`results.steps`, including component outputs, states, and connection flows.

Check that results meet the intended requirements: successful execution can
include unmet heat demand or unfulfilled discharge. Compare relevant totals
and final states with a simple independent calculation. For changing thermal
states, check timestep sensitivity by reducing the timestep while preserving
the duration and timing of the scenario profiles.

The [PV regression test](../tests/regression/blog-electrical.test.js) shows
result checks. Run it with `node --test tests/regression/blog-electrical.test.js`.
For browser layouts, call `validateLayout(layout, { model })` from
[validate-documents.js](../src/core/validation/validate-documents.js) after
validating the model, and provide a position for each physical component.

## Browser use

**Open model** loads compatible edits into the selected example. It requires
the same model ID and component IDs, types, and definition versions. It retains
that example's scenario and layout; it does not import a new study directory.

To expose a new study in the current browser:

1. Put its model, scenario, and layout in a directory under `examples/`.
2. Add an entry to `EXAMPLES` in [main.js](../src/ui/main.js) with `label`,
   `description`, `root`, `initialComponentId`, and `createKpis`. Use
   `modelFile` if the model filename differs from `model.json`.
   Existing KPI functions expect particular component IDs and outputs; use
   `createKpis: () => []` until suitable summary cards are available.
3. Add the entry's key as an option in `#example-select` in
   [index.html](../index.html). If using a new component definition, register
   it in `definitionRegistry()` as well as in your Node runner.
4. Run `npm start` and select the example. Inspect equations, policy inputs,
   chart/connection highlighting, and parameter previews. For an already
   running server, rebuild with `npm run build` and refresh.

Preserve the study's inputs and the application release or Git commit used for
the run. Keep reviewed reference results with a regression test when adding a
maintained example to the repository. See [AGENTS.md](../AGENTS.md) for the
repository checks.
