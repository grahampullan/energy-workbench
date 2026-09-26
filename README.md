# Energy Workbench

Energy Workbench helps you understand how an energy system behaves over time
and explore how equipment choices and operating decisions affect it. It brings
electricity, heat, and material flows into one interactive model, with the
equations and operating rules visible alongside the results.

## How it works

A model is a graph: components are its nodes, and connections are its links.
The graph shows both where energy and material move and what information is
used to make operating decisions.

- **Components** represent equipment such as solar panels, batteries, heaters,
  and thermal stores. Each defines its own equations and physical limits and
  keeps track of quantities such as stored energy, mass, or temperature.
- **Physical links** carry electricity, heat, or material between component
  ports. They appear as solid lines.
- **Information links** carry values used by policies, such as available solar
  power, temperature, or a schedule. They appear as dashed arrows and can connect
  components that have no physical link.
- **Policies** choose how a component should operate using its connected
  information inputs and settings. A battery policy might request charging when
  solar power exceeds demand. The battery's physical limits determine how much
  it can actually accept.

A scenario supplies inputs that change with time, such as solar power and heat
demand. The simulation advances through timesteps, calculates flows, checks
energy and material balances, and updates component states. The model diagram
and charts show the results together, so you can follow a flow through the
system and see how it changes over time.

### Checking and running a model

Before a run, the workbench checks that components and ports exist, links are
compatible, and required policy inputs are connected. It also checks that the
information needed by policies can be calculated without circular dependencies.

At each timestep it then:

1. **Reads inputs and chooses operation.** Current scenario inputs and existing
   component states supply information to policies, which request operation.
2. **Builds a calculation order.** Each component declares which flows it
   calculates and which flows or targets it needs first. Every physical link
   must have exactly one component responsible for calculating its flow, all
   required targets must be available, and the calculations must have an order
   without circular dependencies. Missing or competing flow calculations are
   reported as errors.
3. **Calculates flows and checks them.** Components enforce their physical
   limits. Both ends of each connection must agree on the flow.
4. **Advances the state.** Stored energy, mass, and other states are updated
   only after the checks pass.

The physical graph may contain loops; the calculations within a timestep must
have a clear order. Feedback using an existing state, such as a battery's
charge, is allowed. The runtime does not solve simultaneous circular
dependencies by iteration.

A valid calculation order does not guarantee that every operating condition is
feasible. Running the scenario checks feasibility as inputs and states change.

## Try it

Use Node.js 22, the version used for testing, and npm. From the repository root:

```sh
npm ci
npm start
```

Open [the workbench](http://127.0.0.1:4173). It starts with the PV and battery
example.

1. Choose an **Example**. **About example** explains its setup and operation.
2. Select a component in **Model**. The inspector shows its **Controls**,
   **Equations**, and **Policy** or **Role**.
3. Change a parameter to preview its effect. **Reset preview** restores the
   working model; **Apply** keeps the change in the current session.
4. In **Results**, choose a quantity and scrub the chart to select a timestep.
   Hover over a chart line or model connection to highlight its flow and components.
5. Enable **Show information connections** to see all policy inputs, or select
   a component to see the inputs relevant to it.

**Save model** downloads your applied model as JSON. **Open model** reloads a
model compatible with the selected example's component layout.

### Examples

Six examples are available. The process examples use synthetic data.

| Example | What it shows |
| --- | --- |
| [PV and battery](docs/regression/blog-electrical.md) | A battery stores surplus solar power and covers shortfalls; the grid balances the remainder. |
| [Coupled thermal](docs/regression/coupled-thermal.md) | An electric heater and hot-water store supply changing heat demand, with losses and unmet demand reported. |
| [Batch heating](docs/regression/batch-heating.md) | A power schedule heats a fixed batch, with a check on its final temperature. |
| [Material inventory](docs/regression/material-inventory.md) | Material enters, is heated, and leaves a store; discharge is limited to available inventory. |
| [Ladle · historical](docs/regression/ladle-cycle.md) | A fixed burner schedule preheats a ladle before molten-metal arrival, holding, and discharge. |
| [Ladle · temperature-led](docs/regression/ladle-cycle.md) | The burner responds to lining temperature and time remaining, allowing fuel use to be compared with the fixed schedule. |
