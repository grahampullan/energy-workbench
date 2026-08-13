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

JSON Schemas for the initial study documents live in `src/core/schemas`.

The executable runtime currently supports deterministic fixed-timestep runs on
one four-terminal electrical bus with fixed load and PV profiles, branching,
policy-controlled battery storage and generation, and a residual grid boundary
with import and export limits. The PV-battery self-consumption policy reproduces
the legacy dispatch priority. The complete 1,440-step legacy example and its
double-PV and double-capacity variants now run headlessly on the new contracts,
with corrected battery state boundaries recorded by regression tests.

The browser workbench loads that committed example through the same runtime. It
presents the saved topology, live connection powers, a definition-driven
component inspector, linked directional-power and integrated-energy charts, and
timestep scrubbing. Numeric parameter controls create temporary preview runs
which can be reset or applied to the in-memory working model. Components can
also be moved and resized as temporary layout changes; reloading restores the
saved layout. The applied working model can be downloaded and opened again as
JSON, while a completed preview can be downloaded separately as a named
parameter variant.

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
