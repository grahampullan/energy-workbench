# ADR 0001: Project foundation

**Status:** Accepted

**Date:** 2026-07-31

## Context

Energy Workbench needs a small public foundation for an interactive engineering
application. Premature packaging and deployment choices would make Push 1
harder to understand.

## Decision

- The project is named Energy Workbench and uses the MIT licence.
- Source is modern JavaScript modules.
- Keep one repository with logical `core`, `runtime`, `components`, `ui`, and
  `cli` folders until independent packages are justified.
- The browser is the first workbench surface. Node tests and a small CLI use the
  same engineering runtime.
- The private casting study and its data remain outside this repository.
- Servers, workers, optimisation, agents, and plugins are outside Push 1.

## Consequences

The first implementation remains inspectable and runnable without a build-time
architecture. Later packaging or execution surfaces must preserve the shared
contracts rather than fork them.
