# 0022 — Component policies with explicit information connections

Status: Accepted.

## Context

Example policies received the whole runtime model, every capability and state,
and all scenario series. Their hidden dependencies made policies difficult to
reuse or explain in the inspector. Physical adjacency alone cannot express the
heat-demand-to-heater dependency across a store.

## Decision

Persist the policy type and settings on its component. Register a small set of
reusable policy functions at the application boundary. Each function receives
only immutable named input values and settings, and returns its own component's
operating target. A balancing role is an explicit component policy assignment.

Every runtime policy input, including own-component information, arrives by an
explicit information connection. Physical connections retain their conservation
and feasibility semantics. Information connections reference public typed
outputs and inputs, check quantity and unit, and permit output fan-out without
physical splitting. The component owns the calculation of its public outputs.

Named schedule sources bind scenario series to value or period outputs. A
period source publishes permission and time remaining in the matching period;
only that source can inspect the future schedule. Policies cannot inspect the
scenario or other component objects.

Evaluate the acyclic information graph before policy requests, using current
schedule values and start-of-step state/capabilities. Keep the existing physical
resolution graph after policy targets and capability refinement. Reject missing
inputs, incompatible quantities, duplicate sources and same-step cycles.
Current settled flows and next states are not information outputs in this slice.

Solar PV and load publish non-negative generation and demand directly to the
battery's policy inputs. The battery policy requests demand minus generation.
The physical bus and grid balance the remainder after battery feasibility.
Information connections do not have to follow physical connections through the
bus. No global scan or equation moves into the runtime.

The viewer reveals information routes for selected components or all routes
through a toggle. Multiple inputs between the same endpoints share a labelled
route; the inspector traces each input individually. Schedule sources are named
cards. Policy selection, settings and wiring are edited in one validated model
command and preserved in saved model JSON.

## Consequences

All six example choices use the connected policy contract and preserve their
reviewed physical results. The temperature-led ladle has its own complete model
configuration, sharing the physical topology, layout and scenario. Policies no
longer interpret example-specific phase codes.

This replaces the whole-model policy API in 0006/0010/0013 and the example-policy
composition in 0021. It leaves component-owned physics and physical resolution
ordering unchanged. External callers must migrate to component policy
assignments and register policy definitions. There is no legacy global-policy
execution path. The current single electrical balancing role remains a physical
runtime limitation; this change adds no iterative solver or implicit delays.
