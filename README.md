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

## Development

```sh
npm install
npm test
```

Regenerate the new-contract blog-example documents from the preserved legacy
input with `npm run generate:blog-example`.
