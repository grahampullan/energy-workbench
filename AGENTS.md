# Working in Energy Workbench

Keep changes simple, readable, and local to the code that owns the behaviour.
Preserve unrelated work already present in the working tree.

## Read first

- [README](README.md): purpose, model concepts, and browser use.
- [Architecture](ARCHITECTURE.md): engineering boundaries and runtime contracts.
- [Code shape](CODE_SHAPE.md) and [repository profile](CODE_SHAPE_PROFILE.md):
  implementation, UI, and testing conventions.

For assembling a model from existing components, follow
[Model authoring](docs/model-authoring.md). For new equations, components, or
policy algorithms, use [Component development](docs/component-development.md).
Use current definitions and examples for exact fields and versions; ADRs record
historical decisions and may describe superseded behaviour.

## Where things live

| Location | Purpose |
| --- | --- |
| `examples/` | Model, scenario, and layout JSON; reference results and variants. |
| `src/components/` | Component definitions, equations, limits, ports, and inspector descriptions. |
| `src/policies/definitions.js` | Available policies, required information inputs, and settings. |
| `src/core/` | Registry, JSON schemas, validation, and model commands. |
| `src/runtime/run-scenario.js` | Shared simulation entry point. |
| `src/ui/` | Browser presentation; `main.js` registers definitions and examples. |
| `tests/`, `browser-tests/` | Engineering, regression, and browser checks. |
| `docs/regression/` | Reviewed example behaviour and expected results. |

JSON assembles registered components and policies. New behaviour requires
JavaScript definitions. Keep physical equations in components, policy inputs
explicitly connected, and runtime orchestration generic. Browser and Node runs
must use the same simulation.

## Run and check

Use Node.js 22 and run commands from the repository root:

```sh
npm ci
npm start
```

Open the browser at <http://127.0.0.1:4173>. After browser-code changes,
run `npm run build` and refresh. Generated files in `build/` are ignored by Git.

- Run `npm test` for Node tests and numerical regressions. To focus on one
  example, use `node --test tests/regression/blog-electrical.test.js`.
- For browser changes, run `npm run check` for Node tests, the browser build,
  and Playwright tests. Install the browser once with
  `npx playwright install chromium`, or use an installed Google Chrome with
  `PLAYWRIGHT_CHANNEL=chrome npm run check`.
- For documentation-only changes, check links, run documented examples that
  changed, and use `git diff --check`.

For model changes, run the model itself as well as relevant tests. Check the
intended engineering outcome; a completed run can still report unmet demand.
Review reference results against the equations before changing expected values.

Report what changed, how it was checked, and any remaining limitations.
