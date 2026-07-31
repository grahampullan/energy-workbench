# Code Shape

## Purpose

Small, reusable coding defaults. Repo-specific rules belong in
`CODE_SHAPE_PROFILE.md`.

## Default rules

1. Keep behaviour local to the module that owns it.
2. Extract code only for real reuse or when the extraction makes the main flow
   clearer.
3. Compose dependencies at boundaries and pass them explicitly.
4. Prefer shallow abstractions; avoid wrappers that only forward calls.
5. Prefer functions for stateless work. Use classes only for real state or
   lifecycle.
6. Keep helpers narrow and name them by responsibility.
7. Prefer one deterministic path over configurable modes.
8. Change contracts intentionally and update validation, documentation, and
   tests in the same change.
9. Leave the code easier to read locally, not merely more organised on paper.

## Review checks

- Can a new reader find the main path quickly?
- Is each extraction justified by current behaviour or reuse?
- Did indirection decrease or earn its cost?
- Are dependencies, names, and contracts explicit?
- Do tests protect behaviour rather than implementation detail?
