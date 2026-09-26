import assert from "node:assert/strict";
import test from "node:test";

import { fuelBurnerDefinition } from
  "../../src/components/thermal/fuel-burner.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function fixture({ efficiency = 0.8 } = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.fuel-burner-test",
      name: "Fuel burner test",
      components: [
        {
          id: "burner",
          policy: { type: "thermal.follow-schedule", settings: {} },
          type: fuelBurnerDefinition.type,
          definitionVersion: fuelBurnerDefinition.version,
          name: "Burner",
          parameters: {
            maximumFuelInputPowerkW: 100,
            efficiency,
            supplyTemperatureC: 100,
            directEmissionsKgCO2PerKWh: 0.184
          },
          initialState: {}
        },
        {
          id: "body",
          type: thermalStoreDefinition.type,
          definitionVersion: thermalStoreDefinition.version,
          name: "Thermal body",
          parameters: {
            maximumMassKg: 1000,
            specificHeatCapacityKjPerKgK: 3.6,
            enthalpyReferenceTemperatureC: 0,
            maximumTemperatureC: 100,
            minimumUsefulTemperatureC: 0,
            maximumHeatInputkW: 80,
            maximumHeatOutputkW: 0
          },
          initialState: { massKg: 1000, containedEnthalpykWh: 50 }
        }
      ],
      informationSources: [{ id: "heat-schedule", name: "Heat schedule", seriesId: "heat", quantity: "heat-rate", unit: "kW" }],
      informationConnections: [
        { id: "info-heat", name: "Heat", from: { sourceId: "heat-schedule", portId: "value" }, to: { componentId: "burner", portId: "policy.request" } }
      ],
      connections: [{
        id: "burner-to-body",
        name: "Burner to body",
        from: { componentId: "burner", portId: "heat-out" },
        to: { componentId: "body", portId: "heat-in" }
      }]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.fuel-burner-test",
      name: "Fuel burner test",
      time: { timeStepSeconds: 3600, stepCount: 1 },
      series: [{ id: "heat", name: "Heat", unit: "kW", data: { kind: "inline", values: [60] } }]
    },
    registry: createComponentRegistry([
      fuelBurnerDefinition,
      thermalStoreDefinition
    ])
  };
}

test("fuel burner converts fuel to store-accepted heat and direct emissions", () => {
  const result = runScenario(fixture());
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  const [step] = result.results.steps;
  assert.deepEqual(step.resolutionPlan.stages, [["body"], ["burner"]]);
  const burner = step.components.find(({ componentId }) => componentId === "burner");
  const body = step.components.find(({ componentId }) => componentId === "body");

  assert.deepEqual(burner.requestedCommand, { heatOutputkW: 60 });
  assert.deepEqual(burner.actualCommand, {
    fuelInputPowerkW: 62.5,
    heatOutputkW: 50,
    directEmissionsKgCO2PerHour: 11.5
  });
  assert.deepEqual(burner.outputs, {
    fuelInputPowerkW: 62.5,
    heatOutputkW: 50,
    directEmissionsKgCO2PerHour: 11.5,
    supplyTemperatureC: 100
  });
  assert.equal(body.outputs.temperatureC, 100);
  assert.equal(step.connections[0].flow.heatFlowkW, 50);
});

test("fuel burner rejects zero conversion efficiency", () => {
  const result = runScenario(fixture({ efficiency: 0 }));
  assert.equal(result.completed, false);
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "thermal.fuel-burner.efficiency"
  ));
});
