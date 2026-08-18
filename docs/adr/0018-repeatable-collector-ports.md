# ADR 0018: Repeatable collector ports

**Status:** Partly superseded by ADR 0020

**Date:** 2026-08-17

## Context

An electrical bus or ambient boundary can have several independent physical
connections at one logical boundary. Numbered placeholder ports impose an
arbitrary maximum, leak diagram layout into the engineering contract, and make
model documents depend on slot allocation.

The individual connection flows must nevertheless remain visible. Aggregating
them before endpoint evaluation would prevent the runtime from checking each
connection independently.

## Decision

- Add optional port `cardinality`, with `one` as the default and `many` for a
  repeatable logical port.
- Reject more than one persisted connection to a `one` port during model
  validation. Do not impose a connection-count limit on a `many` port.
- Keep every persisted and runtime connection distinct even when several
  connections reference the same port ID.
- Require component evaluation to return one flow object for a `one` port, and
  a connection-ID-keyed map of flow objects for a `many` port.
- Make `thermal.ambient-boundary@0.3.0` expose one repeatable incoming
  `heat-in` port.
- Make `electrical.bus@0.3.0` expose one repeatable bidirectional `terminal`
  port.

## Consequences

Collector components have stable, physically meaningful port IDs and no
arbitrary capacity. Component equations may aggregate their connection flows,
but generic connection execution still selects and balances the flow belonging
to each connection ID. Existing ordinary ports retain their previous behaviour
without adding `cardinality` to their definitions.
