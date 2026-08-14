# Energy Workbench

An interactive engineering environment for approximate, time-resolved energy
models.

The project is currently building Push 1: a behavioural port of the original
Visual Energy Modeller followed by a simple electrical–thermal extension.

## Project contracts

- [Architecture](ARCHITECTURE.md)
- [Code shape profile](CODE_SHAPE_PROFILE.md)
- [Architecture decisions](docs/adr/README.md)
- [Component development](docs/component-development.md)
- [Legacy electrical regression](docs/regression/blog-electrical.md)
- [Coupled thermal reference](docs/regression/coupled-thermal.md)

JSON Schemas for the initial study documents live in `src/core/schemas`.

The executable runtime supports deterministic fixed-timestep runs on one
four-terminal electrical bus with fixed load and PV profiles, branching,
policy-controlled battery storage and generation, and a residual grid boundary
with import and export limits. It also supports the Push 1B coupled topology:
an electric heater, hot-water store, heat demand, and ambient heat-loss
boundary. The complete 1,440-step legacy electrical example and the short
synthetic coupled-thermal example both run headlessly on the same contracts,
with their reviewed results recorded by regression tests.

The browser workbench can load either committed example through the same
runtime. It presents the saved topology, live electrical and thermal flows, a
definition-driven component inspector, run KPIs, linked flow-rate and
integrated-energy charts, a hot-water store temperature chart, and timestep
scrubbing. Numeric parameter controls create temporary preview runs which can
be reset or applied to the in-memory working model.
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
