import assert from "node:assert/strict";
import test from "node:test";

import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { ambientBoundaryDefinition } from "../../src/components/thermal/ambient-boundary.js";
import { electricHeaterDefinition } from "../../src/components/thermal/electric-heater.js";
import { heatDemandDefinition } from "../../src/components/thermal/heat-demand.js";
import { hotWaterStoreDefinition } from "../../src/components/thermal/hot-water-store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { createHeatDemandFollowingPolicy } from
  "../../src/policies/heat-demand-following.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  demandValues = [10],
  ambientValues = demandValues.map(() => 20),
  timeStepSeconds = 3600,
  maximumGridImportPowerKw = 200,
  heaterEfficiency = 1,
  heaterMaximumInputPowerKw = 100,
  heaterSupplyTemperatureC = 100,
  storeInitialTemperatureC = 80,
  storeMaximumTemperatureC = 100,
  storeMinimumUsefulTemperatureC = 70,
  storeHeatLossCoefficientKwPerK = 0,
  demandDefinition = heatDemandDefinition,
  policy = createHeatDemandFollowingPolicy({
    heaterComponentId: "heater",
    demandComponentId: "heat-demand"
  })
} = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.coupled-runtime",
      name: "Coupled runtime model",
      components: [
        {
          id: "grid",
          type: electricalGridDefinition.type,
          definitionVersion: electricalGridDefinition.version,
          name: "Grid",
          parameters: {
            maximumImportPowerKw: maximumGridImportPowerKw,
            maximumExportPowerKw: 200
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
          id: "heater",
          type: electricHeaterDefinition.type,
          definitionVersion: electricHeaterDefinition.version,
          name: "Electric heater",
          parameters: {
            maximumElectricalInputPowerKw: heaterMaximumInputPowerKw,
            efficiency: heaterEfficiency,
            supplyTemperatureC: heaterSupplyTemperatureC
          },
          initialState: {}
        },
        {
          id: "store",
          type: hotWaterStoreDefinition.type,
          definitionVersion: hotWaterStoreDefinition.version,
          name: "Hot-water store",
          parameters: {
            volumeM3: 1,
            waterDensityKgPerM3: 1000,
            specificHeatCapacityKjPerKgK: 3.6,
            maximumTemperatureC: storeMaximumTemperatureC,
            heatLossCoefficientKwPerK: storeHeatLossCoefficientKwPerK,
            maximumChargeHeatFlowKw: 100,
            maximumDischargeHeatFlowKw: 100,
            minimumUsefulTemperatureC: storeMinimumUsefulTemperatureC
          },
          initialState: { temperatureC: storeInitialTemperatureC }
        },
        {
          id: "heat-demand",
          type: demandDefinition.type,
          definitionVersion: demandDefinition.version,
          name: "Heat demand",
          parameters: {
            demandSeriesId: "thermal-demand",
            profileMultiplier: 1,
            minimumDeliveryTemperatureC: storeMinimumUsefulTemperatureC
          },
          initialState: {}
        },
        {
          id: "ambient",
          type: ambientBoundaryDefinition.type,
          definitionVersion: ambientBoundaryDefinition.version,
          name: "Ambient",
          parameters: { temperatureSeriesId: "ambient-temperature" },
          initialState: {}
        }
      ],
      connections: [
        {
          id: "grid-to-bus",
          name: "Grid to bus",
          from: { componentId: "grid", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal-1" }
        },
        {
          id: "bus-to-heater",
          name: "Bus to heater",
          from: { componentId: "bus", portId: "terminal-2" },
          to: { componentId: "heater", portId: "electricity-in" }
        },
        {
          id: "heater-to-store",
          name: "Heater to store",
          from: { componentId: "heater", portId: "heat-out" },
          to: { componentId: "store", portId: "heat-in" }
        },
        {
          id: "store-to-demand",
          name: "Store to demand",
          from: { componentId: "store", portId: "heat-out" },
          to: { componentId: "heat-demand", portId: "heat-in" }
        },
        {
          id: "store-to-ambient",
          name: "Store to ambient",
          from: { componentId: "store", portId: "heat-loss" },
          to: { componentId: "ambient", portId: "heat-in" }
        }
      ]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.coupled-runtime",
      name: "Coupled runtime scenario",
      time: { timeStepSeconds, stepCount: demandValues.length },
      series: [
        {
          id: "thermal-demand",
          name: "Thermal demand",
          unit: "kW",
          data: { kind: "inline", values: demandValues }
        },
        {
          id: "ambient-temperature",
          name: "Ambient temperature",
          unit: "°C",
          data: { kind: "inline", values: ambientValues }
        }
      ]
    },
    policy,
    registry: createComponentRegistry([
      electricalBusDefinition,
      electricalGridDefinition,
      ambientBoundaryDefinition,
      electricHeaterDefinition,
      demandDefinition,
      hotWaterStoreDefinition
    ])
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("coupled runtime follows demand and balances electrical and thermal connections", () => {
  const fixture = createFixture();
  const originalModel = structuredClone(fixture.model);
  const originalScenario = structuredClone(fixture.scenario);
  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(fixture.model, originalModel);
  assert.deepEqual(fixture.scenario, originalScenario);
  const step = result.results.steps[0];
  const [grid, bus, heater, store, demand, ambient] = step.components;

  assert.deepEqual(heater.requestedCommand, { powerKw: -10 });
  assert.deepEqual(heater.feasibleCommand, {
    powerKw: -10,
    heatOutputKw: 10
  });
  assert.deepEqual(heater.actualCommand, {
    powerKw: -10,
    heatOutputKw: 10
  });
  assert.deepEqual(heater.outputs, {
    electricalInputPowerKw: 10,
    heatOutputKw: 10,
    supplyTemperatureC: 100
  });
  assert.deepEqual(grid.actualCommand, { powerKw: 10 });
  assert.equal(bus.outputs.balanceResidualPowerKw, 0);

  assert.equal(store.requestedCommand, null);
  assert.equal(store.feasibleCommand, null);
  assert.deepEqual(store.actualCommand, {
    chargeHeatFlowKw: 10,
    chargeSourceTemperatureC: 100,
    chargeDeliveryTemperatureC: 100,
    dischargeHeatFlowKw: 10,
    ambientTemperatureC: 20
  });
  assert.deepEqual(store.outputs, {
    chargeHeatFlowKw: 10,
    dischargeHeatFlowKw: 10,
    heatLossKw: 0,
    netHeatFlowKw: 0,
    temperatureC: 80,
    usableEnergyKwh: 10,
    deliveryTemperatureMarginK: 10
  });
  assert.equal(demand.outputs.servedHeatFlowKw, 10);
  assert.equal(demand.outputs.unmetHeatFlowKw, 0);
  assert.equal(ambient.outputs.receivedHeatFlowKw, 0);

  assert.deepEqual(step.connections, [
    {
      connectionId: "grid-to-bus",
      medium: "electricity.active-power",
      powerKw: 10,
      residualPowerKw: 0
    },
    {
      connectionId: "bus-to-heater",
      medium: "electricity.active-power",
      powerKw: 10,
      residualPowerKw: 0
    },
    {
      connectionId: "heater-to-store",
      medium: "thermal.heat-flow",
      heatFlowKw: 10,
      sourceTemperatureC: 100,
      deliveryTemperatureC: 100,
      residualHeatFlowKw: 0
    },
    {
      connectionId: "store-to-demand",
      medium: "thermal.heat-flow",
      heatFlowKw: 10,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 80,
      residualHeatFlowKw: 0
    },
    {
      connectionId: "store-to-ambient",
      medium: "thermal.heat-flow",
      heatFlowKw: 0,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 20,
      residualHeatFlowKw: 0
    }
  ]);
  assert.deepEqual(runScenario(fixture), result);
});

test("coupled runtime reports unmet heat until the store reaches useful temperature", () => {
  const result = runScenario(createFixture({
    demandValues: [10, 10],
    storeInitialTemperatureC: 65
  }));

  assert.equal(result.completed, true);
  assert.deepEqual(diagnosticCodes(result), [
    "thermal.heat-demand.unmet-heat",
    "thermal.heat-demand.unmet-heat"
  ]);
  const [first, second] = result.results.steps;
  assert.equal(first.components[3].state.temperatureC, 75);
  assert.equal(first.components[4].outputs.servedHeatFlowKw, 0);
  assert.equal(first.components[4].outputs.unmetHeatFlowKw, 10);
  assert.equal(second.components[3].actualCommand.dischargeHeatFlowKw, 5);
  assert.equal(second.components[3].state.temperatureC, 80);
  assert.equal(second.components[4].outputs.servedHeatFlowKw, 5);
  assert.equal(second.components[4].outputs.unmetHeatFlowKw, 5);
});

test("coupled runtime allocates standing loss and conserves store energy", () => {
  const result = runScenario(createFixture({
    demandValues: [4],
    storeHeatLossCoefficientKwPerK: 0.1
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  const store = step.components[3];
  assert.equal(store.actualCommand.chargeHeatFlowKw, 4);
  assert.equal(store.actualCommand.dischargeHeatFlowKw, 4);
  assert.equal(store.outputs.heatLossKw, 6);
  assert.equal(store.outputs.netHeatFlowKw, -6);
  assert.equal(store.state.temperatureC, 74);
  assert.equal(step.components[5].outputs.receivedHeatFlowKw, 6);
  assert.equal(step.connections[4].heatFlowKw, 6);
});

test("heat-demand-following policy converts requested heat through heater efficiency", () => {
  const result = runScenario(createFixture({
    demandValues: [8],
    heaterEfficiency: 0.8
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  assert.deepEqual(step.components[2].requestedCommand, { powerKw: -10 });
  assert.deepEqual(step.components[2].actualCommand, {
    powerKw: -10,
    heatOutputKw: 8
  });
  assert.deepEqual(step.components[0].actualCommand, { powerKw: 10 });
});

test("coupled resolver clamps heater operation at the store supply-temperature boundary", () => {
  const result = runScenario(createFixture({
    demandValues: [0],
    heaterEfficiency: 0.8,
    heaterSupplyTemperatureC: 85,
    policy: { request: () => ({ heater: { powerKw: -100 } }) }
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  assert.deepEqual(step.components[2].requestedCommand, { powerKw: -100 });
  assert.deepEqual(step.components[2].feasibleCommand, {
    powerKw: -6.25,
    heatOutputKw: 5
  });
  assert.deepEqual(step.components[0].actualCommand, { powerKw: 6.25 });
  assert.equal(step.components[3].state.temperatureC, 85);
  assert.equal(step.connections[2].heatFlowKw, 5);
});

test("coupled runtime preserves electrical grid infeasibility", () => {
  const result = runScenario(createFixture({
    demandValues: [10],
    maximumGridImportPowerKw: 4
  }));

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.electrical-balance-infeasible"));
});

test("coupled runtime rejects incomplete thermal topology", () => {
  const fixture = createFixture();
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => connection.id !== "store-to-ambient"
  );
  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.unsupported-thermal-topology"));
});

test("coupled connection balance checks component-evaluated thermal flows", () => {
  const imbalancedDemand = {
    ...heatDemandDefinition,
    version: "0.2.0",
    model: {
      ...heatDemandDefinition.model,
      evaluate(runtimeComponent, actualCommand, stepContext) {
        const evaluation = heatDemandDefinition.model.evaluate(
          runtimeComponent,
          actualCommand,
          stepContext
        );
        return {
          ...evaluation,
          portFlows: {
            "heat-in": {
              ...evaluation.portFlows["heat-in"],
              heatFlowKw: evaluation.portFlows["heat-in"].heatFlowKw + 1
            }
          }
        };
      }
    }
  };
  const result = runScenario(createFixture({ demandDefinition: imbalancedDemand }));

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.connection-balance"));
});

test("heat-demand-following policy validates its component contract", () => {
  assert.throws(
    () => createHeatDemandFollowingPolicy(),
    /heaterComponentId must be a non-empty string/u
  );

  const result = runScenario(createFixture({
    policy: createHeatDemandFollowingPolicy({
      heaterComponentId: "store",
      demandComponentId: "heat-demand"
    })
  }));
  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.policy-failed"));
});
