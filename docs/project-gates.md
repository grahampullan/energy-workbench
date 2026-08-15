# Project gates

## Gate 1 — passed

**Decision date:** 14 August 2026

**Decision:** Push 1 provides a sound foundation for starting Push 2.

The internal review found that:

- Parameter changes, reruns, topology updates, charts, KPIs, and diagnostics
  feel immediate and understandable.
- The electrical and restricted thermal component contracts remain small.
- Requested, feasible, and actual operation have distinct meanings.
- Browser and Node execution use the same deterministic runtime and reviewed
  regression results.
- Preview, reset, apply, variants, model save, and model reload provide a
  reproducible path from exploration to a working model.
- The component-development guide records the current extension contract.

Two proposed checks were deferred:

- Detailed performance instrumentation was not added because the reference
  workbench is acceptably responsive in use. Add measurement if visible
  latency returns or models become materially larger.
- A second-person component implementation has not yet been observed. Use the
  first independent component contribution as that test.

Neither deferral blocks Push 2.

## Gate 2 — not yet evaluated

Gate 2 is the external practitioner evaluation at the end of Push 2. The
project is now working **towards Gate 2**; Gate 2 has not passed.

Push 2 keeps the repository boundary explicit:

- Public repository: reusable process-energy components and a neutral
  synthetic batch-heating example.
- Private study: the MHI-informed casting and ladle data, assumptions, and
  study model.

## First Push 2 slice

**Status:** Implemented headlessly and in the browser workbench.

The first slice is one deterministic heating cycle:

```text
Grid -> Electric heater -> One-node batch thermal mass -> Ambient
```

Add one process component for a lumped thermal mass with temperature state,
heat input, standing heat loss, and a required final-temperature margin. Reuse
the existing grid, electric heater, ambient boundary, runtime, and thermal-flow
contract. Drive it with a small inline synthetic schedule and a fixed
historical heating policy.

The reviewed fixture and tests show:

- electrical and thermal energy balance;
- the full batch-temperature trajectory;
- input energy for the cycle;
- final delivery-temperature margin; and
- an explicit warning when the required temperature is missed.

The browser uses the same runtime result and adds editable component
parameters, batch KPIs, selected-timestep diagnostics, and the required
temperature line on the temperature chart.

CSV input, multiple thermal nodes, calibration, uncertainty, burner fuel,
emissions, policy comparison, and the private ladle model follow later. They
are not prerequisites for proving the first process component.
