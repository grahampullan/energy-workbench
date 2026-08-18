import assert from "node:assert/strict";
import test from "node:test";

import { heatTransferDefinition } from
  "../../src/components/thermal/heat-transfer.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function store(id, temperatureC) {
  return {
    id,
    type: thermalStoreDefinition.type,
    definitionVersion: thermalStoreDefinition.version,
    name: id,
    parameters: {
      maximumMassKg: 1000,
      specificHeatCapacityKjPerKgK: 3.6,
      enthalpyReferenceTemperatureC: 0,
      maximumTemperatureC: 200,
      minimumUsefulTemperatureC: 0,
      maximumHeatInputkW: 0,
      maximumHeatOutputkW: 0
    },
    initialState: {
      massKg: 1000,
      containedEnthalpykWh: temperatureC
    }
  };
}

function fixture({ conductancekWPerK = 0.1, timeStepSeconds = 3600 } = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.heat-transfer",
      name: "Two finite thermal bodies",
      components: [
        store("hot", 80),
        {
          id: "contact",
          type: heatTransferDefinition.type,
          definitionVersion: heatTransferDefinition.version,
          name: "Thermal contact",
          parameters: { conductancekWPerK },
          initialState: {}
        },
        store("cold", 20)
      ],
      connections: [
        {
          id: "hot-to-contact",
          name: "Hot body to contact",
          from: { componentId: "hot", portId: "passive-heat-out" },
          to: { componentId: "contact", portId: "source" }
        },
        {
          id: "contact-to-cold",
          name: "Contact to cold body",
          from: { componentId: "contact", portId: "sink" },
          to: { componentId: "cold", portId: "passive-heat-in" }
        }
      ]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.heat-transfer",
      name: "One explicit step",
      time: { timeStepSeconds, stepCount: 1 },
      series: []
    },
    policy: {
      request: () => ({
        targets: {},
        balancingComponentId: "hot"
      })
    },
    registry: createComponentRegistry([
      heatTransferDefinition,
      thermalStoreDefinition
    ])
  };
}

function component(step, id) {
  return step.components.find((candidate) => candidate.componentId === id);
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance);
}

test("heat transfer owns equal passive flows between two finite bodies", () => {
  const result = runScenario(fixture());

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  const step = result.results.steps[0];
  assert.deepEqual(step.resolutionPlan.stages, [
    ["contact"],
    ["hot", "cold"]
  ]);
  assert.equal(component(step, "contact").outputs.heatFlowkW, 6);
  assertClose(component(step, "hot").outputs.temperatureC, 74);
  assertClose(component(step, "cold").outputs.temperatureC, 26);
  assert.equal(step.connections[0].flow.heatFlowkW, 6);
  assert.equal(step.connections[1].flow.heatFlowkW, 6);
});

test("heat transfer caps a coarse explicit step at thermal equilibrium", () => {
  const result = runScenario(fixture({ conductancekWPerK: 10 }));

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  const step = result.results.steps[0];
  assert.equal(component(step, "contact").outputs.heatFlowkW, 30);
  assert.equal(component(step, "hot").outputs.temperatureC, 50);
  assert.equal(component(step, "cold").outputs.temperatureC, 50);
});

test("heat-transfer conductance must be finite and non-negative", () => {
  const result = runScenario(fixture({ conductancekWPerK: -1 }));

  assert.equal(result.completed, false);
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "thermal.heat-transfer.conductance"
  ));
});
