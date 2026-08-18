# Architecture decision records

ADRs record durable implementation decisions. The product roadmap owns product
scope and sequencing; `ARCHITECTURE.md` owns the current architecture contract.

Keep ADRs short. Add one when a decision changes module boundaries, persisted
contracts, extension contracts, or runtime semantics. Supersede an old ADR
rather than rewriting its history.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-project-foundation.md) | Project foundation | Accepted |
| [0002](0002-json-study-documents.md) | JSON study documents | Accepted |
| [0003](0003-component-and-runtime-contract.md) | Component and runtime contract | Partly superseded by 0015 |
| [0004](0004-preview-commands-and-history.md) | Preview, commands, and history | Accepted |
| [0005](0005-runtime-preparation.md) | Runtime preparation | Accepted |
| [0006](0006-fixed-timestep-electrical-runtime.md) | Fixed-timestep electrical runtime | Partly superseded by 0015 |
| [0007](0007-single-electrical-bus.md) | Single electrical bus | Partly superseded by 0015 and 0018 |
| [0008](0008-residual-grid-and-fixed-pv.md) | Residual grid and fixed PV | Partly superseded by 0015 |
| [0009](0009-single-port-battery.md) | Single-port battery storage | Accepted |
| [0010](0010-self-consumption-dispatch.md) | Self-consumption dispatch | Partly superseded by 0015 |
| [0011](0011-browser-presentation-boundary.md) | Browser presentation boundary | Accepted |
| [0012](0012-restricted-thermal-flow.md) | Restricted thermal flow and storage | Partly superseded by 0019 and 0020 |
| [0013](0013-restricted-coupled-resolver.md) | Restricted coupled resolver | Superseded by 0015 |
| [0014](0014-flow-type-and-connection-result-contract.md) | Flow type and connection-result contract | Partly superseded by 0015 |
| [0015](0015-component-owned-resolution.md) | Component-owned resolution | Partly superseded by 0016 |
| [0016](0016-resolution-dependency-plan.md) | Resolution-dependency plan | Accepted |
| [0017](0017-material-mass-and-enthalpy-flow.md) | Material mass and enthalpy flow | Partly superseded by 0019 |
| [0018](0018-repeatable-collector-ports.md) | Repeatable collector ports | Partly superseded by 0020 |
| [0019](0019-unified-thermal-store.md) | Unified thermal store | Partly superseded by 0020 |
| [0020](0020-explicit-heat-transfer.md) | Explicit passive heat transfer | Accepted |
