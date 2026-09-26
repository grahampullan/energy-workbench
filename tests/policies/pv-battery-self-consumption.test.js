import assert from "node:assert/strict";
import test from "node:test";

import { electricalBatteryDefinition } from "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalPvDefinition } from "../../src/components/electrical/pv.js";
import { electricalSourceDefinition } from "../../src/components/electrical/source.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  demandValues = [2, 1, 5, 5],
  generationValues = [5, 5, 0, 0],
  loadProfileMultiplier = 1,
  pvProfileMultiplier = 1,
  storedEnergykWh = 0
} = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.pv-battery-self-consumption",
      name: "PV battery self-consumption model",
      components: [
        {
          id: "grid",
          policy: { type: "electrical.balance", settings: {} },
          type: electricalGridDefinition.type,
          definitionVersion: electricalGridDefinition.version,
          name: "Grid",
          parameters: {
            maximumImportPowerkW: 100,
            maximumExportPowerkW: 100
          },
          initialState: {}
        },
        {
          id: "bus",
          type: electricalBusDefinition.type,
          definitionVersion: electricalBusDefinition.version,
          name: "Electrical bus",
          parameters: {},
          initialState: {}
        },
        {
          id: "pv",
          type: electricalPvDefinition.type,
          definitionVersion: electricalPvDefinition.version,
          name: "Solar PV",
          parameters: {
            generationSeriesId: "solar-generation",
            profileMultiplier: pvProfileMultiplier
          },
          initialState: {}
        },
        {
          id: "load",
          type: electricalLoadDefinition.type,
          definitionVersion: electricalLoadDefinition.version,
          name: "Load",
          parameters: {
            demandSeriesId: "demand",
            profileMultiplier: loadProfileMultiplier
          },
          initialState: {}
        },
        {
          id: "battery",
          policy: { type: "electrical.self-consumption", settings: {} },
          type: electricalBatteryDefinition.type,
          definitionVersion: electricalBatteryDefinition.version,
          name: "Battery",
          parameters: {
            capacitykWh: 5,
            maximumChargePowerkW: 3,
            maximumDischargePowerkW: 3,
            chargingEfficiency: 1,
            dischargingEfficiency: 1
          },
          initialState: { storedEnergykWh }
        }
      ],
      informationConnections: [
        { id: "info-pv", name: "Solar power", from: { componentId: "pv", portId: "power" }, to: { componentId: "battery", portId: "policy.generation" } },
        { id: "info-demand", name: "Demand", from: { componentId: "load", portId: "demand" }, to: { componentId: "battery", portId: "policy.demand" } }
      ],
      connections: [
        {
          id: "grid-to-bus",
          name: "Grid to bus",
          from: { componentId: "grid", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal" }
        },
        {
          id: "pv-to-bus",
          name: "PV to bus",
          from: { componentId: "pv", portId: "electricity-out" },
          to: { componentId: "bus", portId: "terminal" }
        },
        {
          id: "bus-to-load",
          name: "Bus to load",
          from: { componentId: "bus", portId: "terminal" },
          to: { componentId: "load", portId: "electricity-in" }
        },
        {
          id: "battery-to-bus",
          name: "Battery to bus",
          from: { componentId: "battery", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal" }
        }
      ]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.pv-battery-self-consumption",
      name: "PV battery self-consumption scenario",
      time: {
        timeStepSeconds: 3600,
        stepCount: demandValues.length
      },
      series: [
        {
          id: "demand",
          name: "Demand",
          unit: "kW",
          data: { kind: "inline", values: demandValues }
        },
        {
          id: "solar-generation",
          name: "Solar generation",
          unit: "kW",
          data: { kind: "inline", values: generationValues }
        }
      ]
    },
    registry: createComponentRegistry([
      electricalBatteryDefinition,
      electricalBusDefinition,
      electricalGridDefinition,
      electricalLoadDefinition,
      electricalPvDefinition,
      electricalSourceDefinition
    ])
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("self-consumption dispatch uses battery before residual grid exchange", () => {
  const fixture = createFixture();

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  const batterySteps = result.results.steps.map((step) => step.components[4]);
  const gridSteps = result.results.steps.map((step) => step.components[0]);
  assert.deepEqual(
    batterySteps.map((component) => component.requestedCommand.powerkW),
    [-3, -4, 5, 5]
  );
  assert.deepEqual(
    batterySteps.map((component) => component.feasibleCommand.powerkW),
    [-3, -2, 3, 2]
  );
  assert.deepEqual(
    batterySteps.map((component) => component.actualCommand.powerkW),
    [-3, -2, 3, 2]
  );
  assert.deepEqual(
    batterySteps.map((component) => component.state.storedEnergykWh),
    [3, 5, 2, 0]
  );
  assert.deepEqual(
    gridSteps.map((component) => component.actualCommand.powerkW),
    [0, -2, 2, 3]
  );
  assert.deepEqual(
    result.results.steps.map((step) => step.connections[3].flow.powerkW),
    [-3, -2, 3, 2]
  );
  assert.deepEqual(runScenario(fixture), result);
});

test("dispatch consumes fixed component limits including profile multipliers", () => {
  const result = runScenario(createFixture({
    demandValues: [2],
    generationValues: [6],
    loadProfileMultiplier: 2,
    pvProfileMultiplier: 0.5,
    storedEnergykWh: 2
  }));

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.steps[0].components[4].requestedCommand, {
    powerkW: 1
  });
  assert.deepEqual(result.results.steps[0].components[0].actualCommand, {
    powerkW: 0
  });
});

test("runtime gives policies only immutable connected values and settings", () => {
  const fixture = createFixture({ demandValues: [2], generationValues: [5] });
  let received;
  const policies = fixture.registry.listPolicies().map((definition) => definition.type === "electrical.self-consumption"
    ? { ...definition, request(...args) { received = args; return definition.request(...args); } } : definition);
  fixture.registry = createComponentRegistry(fixture.registry.list(), { policies });
  const result = runScenario(fixture);
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.equal(received.length, 2);
  assert.deepEqual(received, [{ generation: 5, demand: 2 }, {}]);
  assert.ok(received.every(Object.isFrozen));
  assert.throws(() => { received[0].generation = 100; }, TypeError);
});

test("self-consumption holds equal generation and demand and rejects invalid input powers", () => {
  const { registry } = createFixture();
  const policy = registry.getPolicy("electrical.self-consumption");
  assert.deepEqual(policy.request({ generation: 2, demand: 2 }), { powerkW: 0 });
  assert.deepEqual(policy.request({ generation: 0, demand: 0 }), { powerkW: 0 });
  for (const field of ["generation", "demand"]) {
    for (const value of [-1, NaN, Infinity]) {
      assert.throws(() => policy.request({ generation: 2, demand: 2, [field]: value }), RangeError);
    }
  }
});

test("self-consumption requires a compatible component and explicit information source", () => {
  const wrongBattery = createFixture();
  wrongBattery.model.components[0].policy = { type: "electrical.self-consumption", settings: {} };
  assert.ok(diagnosticCodes(runScenario(wrongBattery)).includes("model.incompatible-policy"));
  const missing = createFixture();
  missing.model.informationConnections.pop();
  assert.ok(diagnosticCodes(runScenario(missing)).includes("model.missing-policy-input"));
  const variable = createFixture();
  variable.model.components[2] = { id: "pv", name: "Variable source", type: electricalSourceDefinition.type,
    definitionVersion: electricalSourceDefinition.version, parameters: { maximumPowerkW: 10 }, initialState: {} };
  assert.ok(diagnosticCodes(runScenario(variable)).includes("model.information-source-port"));
});
