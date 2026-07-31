# ADR 0004: Preview, commands, and history

**Status:** Accepted

**Date:** 2026-07-31

## Context

Direct manipulation should feel disposable while useful engineering changes
remain reproducible. Slider events, undo history, design alternatives, and Git
history serve different purposes.

## Decision

- Preview overrides are temporary and do not mutate project documents.
- Apply changes the working model through a small command layer.
- A saved variant records an intentional alternative; Push 1 variants contain
  parameter overrides only.
- Workbench undo/redo reverses applied commands.
- Git records meaningful study states, branches, and issued versions, not
  slider events.
- Observables only synchronise controls and views. One coordinator schedules
  preview runs.
- The scheduler coalesces input, retains only the latest pending request, and
  rejects stale results.

## Consequences

Exploration stays fast without polluting model or Git history. The final control
value must always be evaluated, and reset/apply/save-as-variant have distinct
semantics.
