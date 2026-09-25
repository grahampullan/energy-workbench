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
4. Keep every governing equation, physical constraint, feasibility rule, port
   relationship, and state transition in its owning component definition. Do
   not duplicate component physics in policies or runtime modules.
5. Keep policies limited to operating targets, priorities, schedules, and
   explicit roles such as the visible component that accepts residual flow.
6. Keep runtime code generic: prepare inputs, order component work, transfer
   typed connection flows, check consistency, commit states, and collect
   results. Do not select whole-model solvers or branch on component type to
   implement physics.
7. Use `prescribed`, `target`, `capability`, and `actual` precisely. Do not
   represent a whole port with the old `constraint`, `target`, `variable`, and
   `max` state machine.
8. Publish capabilities through `getOperatingLimits`. Keep component resolution
   declarations limited to required targets, required settled flows, and
   determined connection flows. Governing equations remain in the component's
   `model.resolve` function.
9. Keep boundary compatibility small and flow-type-specific. Do not create an
   arbitrary feasible-region format, generic constraint language, or implicit
   iterative solver.
10. Pass registries, scenarios, policies, clocks, and other dependencies
   explicitly. Compose them at the browser, CLI, or test boundary.
11. Keep feature behaviour in its owning module. Avoid forwarding wrappers and
   broad barrel files; a small registry or composition module is fine.
12. Make engineering units obvious in schemas, names, and tests. Prefer names
   such as `powerkW`, `energykWh`, `durationHours`, and `temperatureC` over
   context-dependent `value` fields. Preserve SI symbol casing inside
   identifiers: use `kW` and `kWh`, never `Kw`, `KW`, or `Kwh`.
13. Use JSON Schema once for structural validity and JavaScript once for
   engineering validity. Reject invalid input clearly; do not silently repair
   it.
14. Keep `core`, `runtime`, and component calculations deterministic. Time,
   randomness, environment values, and I/O must not be hidden inputs.
15. Keep runtime state local to a run. Component evaluation must not mutate the
   persisted model or depend on UI state.
16. Keep domain results separate from presentation state. Graph labels, chart
    series, and inspector controls derive from canonical run results.

## UI defaults

- Model parameters remain plain values; observables only synchronise controls
  and result views.
- One coordinator turns preview changes into run requests.
- Slider and numeric controls share one parameter binding.
- Dispose subscriptions explicitly.
- Do not duplicate component metadata or equations in inspectors; generate
  controls from the component definition where practical.
- Keep canonical values and units unchanged in models and runtime results. Use
  the shared UI engineering formatter for significant figures, readable SI
  units, chart axes, and accessible value text; never round a non-zero value to
  zero. Editable controls retain their underlying numeric value.
- Use D3 selections, keyed data joins, scales, axes, and shape generators for
  SVG charts and graphical overlays. Keep D3 within `src/ui` and derive its
  input data from canonical run results.
- Draw topology connections as solid lines. Assign connection identity from
  Tableau 10 in stable model order, and reuse that exact colour for the
  connection's Results series. Hover emphasis is shared between Model and
  Results and changes weight or background, not the identity colour.
- Keep Results quantities conceptually separate: Power and integrated Energy
  contain electrical and thermal connections; Mass contains material
  connections. Do not present transported material enthalpy as ordinary power.
  A future enthalpy-balance view must show its relationship to stored-enthalpy
  change explicitly.
- Continue to use board-box for topology mechanics. Use ordinary DOM APIs for
  semantic interface elements such as forms, buttons, and inspectors.
- Lay out topology inputs such as power, fuel, and material towards the left
  and process outputs towards the right. Place hotter thermal components
  qualitatively higher and use a wide ambient boundary along the bottom so
  heat-loss connections descend into it. This is visual meaning, not a scaled
  temperature axis.
- Coalesce continuous drag, resize, scrub, and chart rendering to one animation
  frame. Preview scheduling must still preserve the latest pending value.

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
- Is component physics present only in the owning component definition?
- Is runtime orchestration independent of specific component types and model
  topologies?
- Does every connection field have a clear source of determination without a
  generic constraint solver?
- Are dual capabilities distinguished from conflicting dual prescriptions?
- Is engineering behaviour independent of UI and I/O?
- Do tests state the physical assumption being protected?
