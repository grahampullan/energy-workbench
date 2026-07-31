# Code Shape Profile

## Purpose

Repo-specific coding defaults for Energy Workbench. Use `ARCHITECTURE.md` for
system boundaries and `CODE_SHAPE.md` for general defaults.

## Precedence

1. Product requirements and the current roadmap
2. `ARCHITECTURE.md`
3. `CODE_SHAPE_PROFILE.md`
4. `CODE_SHAPE.md`

## Repository defaults

1. Use modern JavaScript modules. Keep public contracts as plain data and
   functions.
2. Prefer functions. Use classes or closures only when they represent real
   state or lifecycle.
3. Component extensions are registered `ComponentDefinition` objects, not
   subclasses or general hooks.
4. Pass registries, scenarios, policies, clocks, and other dependencies
   explicitly. Compose them at the browser, CLI, or test boundary.
5. Keep feature behaviour in its owning module. Avoid forwarding wrappers and
   broad barrel files; a small registry or composition module is fine.
6. Make engineering units obvious in schemas, names, and tests. Prefer names
   such as `powerKw`, `energyKwh`, `durationHours`, and `temperatureC` over
   context-dependent `value` fields.
7. Use JSON Schema once for structural validity and JavaScript once for
   engineering validity. Reject invalid input clearly; do not silently repair
   it.
8. Keep `core`, `runtime`, and component calculations deterministic. Time,
   randomness, environment values, and I/O must not be hidden inputs.
9. Keep runtime state local to a run. Component evaluation must not mutate the
   persisted model or depend on UI state.
10. Keep domain results separate from presentation state. Graph labels, chart
    series, and inspector controls derive from canonical run results.

## UI defaults

- Model parameters remain plain values; observables only synchronise controls
  and result views.
- One coordinator turns preview changes into run requests.
- Slider and numeric controls share one parameter binding.
- Dispose subscriptions explicitly.
- Do not duplicate component metadata or equations in inspectors; generate
  controls from the component definition where practical.

## Test defaults

- Put a focused test beside every engineering equation, limit, and state
  transition.
- Test units, conservation, boundary conditions, and invalid inputs.
- Test deterministic repeatability and timestep refinement where relevant.
- Test browser/Node equivalence at the shared runtime boundary.
- Test the interaction path: select, preview, reset/apply, save, and reload.

## Review checks

- Is the main model-to-result path easy to follow?
- Is a new abstraction justified by current use?
- Are dependencies and units explicit?
- Is validation owned in one place for each concern?
- Is engineering behaviour independent of UI and I/O?
- Do tests state the physical assumption being protected?
