import assert from "node:assert/strict";
import test from "node:test";

import { heatTransferDefinition } from
  "../../src/components/thermal/heat-transfer.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { createComponentRegistry } from "../helpers/registry.js";
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

function parallelFixture({ fixedSink = false, timeStepSeconds = 3600 } = {}) {
  const data = fixture({ conductancekWPerK: 10, timeStepSeconds });
  const contact = structuredClone(data.model.components[1]);
  contact.id = "second-contact";
  data.model.components.push(contact);
  data.model.connections.push(...data.model.connections.map((connection) => ({
    ...connection,
    id: `second-${connection.id}`,
    from: { ...connection.from, componentId: connection.from.componentId === "contact"
      ? contact.id : connection.from.componentId },
    to: { ...connection.to, componentId: connection.to.componentId === "contact"
      ? contact.id : connection.to.componentId }
  })));
  if (fixedSink) {
    data.model.components[2] = {
      id: "cold", name: "Ambient", type: constantTemperatureDefinition.type,
      definitionVersion: constantTemperatureDefinition.version,
      parameters: { temperatureSeriesId: "ambient" }, initialState: {}
    };
    for (const connection of data.model.connections) {
      if (connection.to.componentId === "cold") connection.to.portId = "heat-in";
    }
    data.scenario.series = [{
      id: "ambient", name: "Ambient", unit: "°C",
      data: { kind: "inline", values: [20] }
    }];
  }
  data.registry = createComponentRegistry([
    heatTransferDefinition, thermalStoreDefinition, constantTemperatureDefinition
  ]);
  return data;
}

test("parallel heat paths reject an excessive timestep before committing impossible temperatures", () => {
  for (const fixedSink of [true, false]) {
    const result = runScenario(parallelFixture({ fixedSink }));
    assert.equal(result.completed, false);
    assert.equal(result.results, null);
    const diagnostic = result.diagnostics.find(({ code }) =>
      code === "runtime.thermal-timestep-too-large"
    );
    assert.ok(diagnostic, JSON.stringify(result.diagnostics));
    assert.match(diagnostic.message, /at most 90 seconds; reduce timeStepSeconds/u);
  }
});

test("refined parallel exchange conserves energy and stays within equilibrium bounds", () => {
  for (const fixedSink of [true, false]) {
    const data = parallelFixture({ fixedSink, timeStepSeconds: 90 });
    data.scenario.time.stepCount = 40;
    if (fixedSink) data.scenario.series[0].data.values = Array(40).fill(20);
    const result = runScenario(data);
    assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
    let previousHotTemperature = 80;
    for (const step of result.results.steps) {
      const hotTemperature = component(step, "hot").outputs.temperatureC;
      const coldTemperature = component(step, "cold").outputs.temperatureC;
      assert.ok(hotTemperature >= coldTemperature - 1e-9);
      assert.ok(hotTemperature <= previousHotTemperature + 1e-9);
      const transferredkWh = ["contact", "second-contact"].reduce((sum, id) =>
        sum + component(step, id).outputs.heatFlowkW * 90 / 3600, 0
      );
      assertClose(previousHotTemperature - hotTemperature, transferredkWh);
      if (!fixedSink) assertClose(hotTemperature + coldTemperature, 100);
      previousHotTemperature = hotTemperature;
    }
    data.model.connections.reverse();
    const reordered = runScenario(data);
    assert.equal(reordered.completed, true);
    assert.deepEqual(
      reordered.results.steps.map((step) => component(step, "hot").state),
      result.results.steps.map((step) => component(step, "hot").state)
    );
  }
});
