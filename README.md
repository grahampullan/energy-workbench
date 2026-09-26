# Energy Workbench

An interactive engineering environment for approximate, time-resolved energy
models.

The project has passed its Push 1 gate and now has a public Push 2 synthetic
ladle cycle on the validated electrical–thermal–material foundation.

## Project contracts

- [Architecture](ARCHITECTURE.md)
- [Code shape profile](CODE_SHAPE_PROFILE.md)
- [Architecture decisions](docs/adr/README.md)
- [Project gates and Push 2 status](docs/project-gates.md)
- [Forward-time and topology-resolution plan](docs/forward-time-and-resolution-plan.md)
- [Component development](docs/component-development.md)
- [Legacy electrical regression](docs/regression/blog-electrical.md)
- [Coupled thermal reference](docs/regression/coupled-thermal.md)
- [Batch-heating reference](docs/regression/batch-heating.md)
- [Material-inventory reference](docs/regression/material-inventory.md)
- [Synthetic ladle-cycle reference](docs/regression/ladle-cycle.md)

JSON Schemas for the initial study documents live in `src/core/schemas`.

The executable runtime supports deterministic fixed-timestep runs on an
electrical bus with a repeatable terminal, fixed load and PV profiles,
branching, policy-controlled battery storage and generation, and a residual
grid boundary with import and export limits. It also supports the Push 1B
coupled topology: an electric heater, thermal store, heat demand, and ambient
boundary, with standing loss owned by an explicit `thermal.heat-transfer`
component. Push 2 reuses that same `thermal.store` definition for a fixed-mass
batch, a material inventory, and separate refractory and molten-metal bodies.
The synthetic ladle cycle adds a fuel burner, explicit thermal contacts and
losses, process modes, and historical and temperature-led policies. All five
public model examples run headlessly and in the browser on the same contracts,
with reviewed results recorded by regression tests.

The browser workbench can load any committed example through the same
runtime. **About example**, beside the example selector, opens a concise
description of the selected example's setup and operation. The workbench
presents the saved topology, live electrical, thermal, and material
flows, a definition-driven component inspector, run KPIs, linked power- and
mass-flow charts, integrated-energy results, component temperature charts, and
timestep scrubbing. Scenario inputs are hidden by default and can be overlaid
with **Show scenario inputs**; temperature requirement lines remain visible.
The inspector's **Equations** view shows each component's governing
equations, symbols, and units, together with its relevant
active-policy rules. The **Policy** view shows the selected rule and the source
of every input, with controls to choose a compatible policy, settings and input
connections. Changes are validated and run before they update the working model.
For a balancing component, such as the PV example's grid, a **Role** tab shows
its physical role and the connected source of its power requirement. Its role
is also shown separately from policy rules in **Equations** and from operating
policies in the operation selector.
Selecting a component reveals its information inputs as dashed arrows;
**Show information connections** reveals the full information layer. Schedule
sources appear as named cards. Input buttons trace their sources in the viewer.
These static explanations remain unchanged during
timestep scrubbing. KaTeX, its styles, and its fonts are bundled locally.
Numeric parameter controls create temporary preview runs which can be reset or
applied to the in-memory working model.
Components can also be moved and resized as temporary layout changes;
reloading restores the saved layout. The applied working model can be
downloaded and opened again as JSON, including its policies and information
connections, while a completed preview can be
downloaded separately as a named parameter variant.

## Development

```sh
npm install
npm test
```

Browser regression tests cover all examples and the select, preview,
reset/apply, save, and reload workflow:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively, use an installed Google Chrome with
`PLAYWRIGHT_CHANNEL=chrome npm run test:browser`. `npm run check` runs both the
Node tests and the browser checks, including the browser build.

Start the browser workbench at `http://127.0.0.1:4173`:

```sh
npm start
```

`npm start` creates an ignored browser bundle and then starts the local static
server. Use `npm run build` when only the bundle is needed.

Regenerate the new-contract blog-example documents from the preserved legacy
input with `npm run generate:blog-example`.
