# Energy Workbench

An interactive engineering environment for approximate, time-resolved energy
models.

The project has passed its Push 1 gate and is building Push 2 batch-heating
models on the validated electrical–thermal foundation.

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

JSON Schemas for the initial study documents live in `src/core/schemas`.

The executable runtime supports deterministic fixed-timestep runs on an
electrical bus with a repeatable terminal, fixed load and PV profiles,
branching, policy-controlled battery storage and generation, and a residual
grid boundary with import and export limits. It also supports the Push 1B
coupled topology: an electric heater, thermal store, heat demand, and ambient
boundary, with standing loss owned by an explicit `thermal.heat-transfer`
component. Push 2 reuses that same `thermal.store` definition for a fixed-mass
batch with a required final temperature and for an inventory that transports
mass and enthalpy. All four public examples run headlessly and in the browser
on the same contracts, with reviewed results recorded by regression tests.

The browser workbench can load any committed example through the same
runtime. It presents the saved topology, live electrical, thermal, and material
flows, a definition-driven component inspector, run KPIs, linked power- and
mass-flow charts, integrated-energy results, component temperature charts, and
timestep scrubbing. Numeric parameter controls create temporary preview runs
which can be reset or applied to the in-memory working model.
Components can also be moved and resized as temporary layout changes;
reloading restores the saved layout. The applied working model can be
downloaded and opened again as JSON, while a completed preview can be
downloaded separately as a named parameter variant.

## Development

```sh
npm install
npm test
```

Start the browser workbench at `http://127.0.0.1:4173`:

```sh
npm start
```

`npm start` creates an ignored browser bundle and then starts the local static
server. Use `npm run build` when only the bundle is needed.

Regenerate the new-contract blog-example documents from the preserved legacy
input with `npm run generate:blog-example`.
