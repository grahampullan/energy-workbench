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
one four-terminal electrical bus with branching fixed loads and one
controllable balancing component. Storage, full dispatch, and the complete
legacy example follow in later Push 1A slices.

## Development

```sh
npm install
npm test
```
