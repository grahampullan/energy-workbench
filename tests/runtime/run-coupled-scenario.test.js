import assert from "node:assert/strict";
import test from "node:test";

import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { electricHeaterDefinition } from "../../src/components/thermal/electric-heater.js";
import { heatDemandDefinition } from "../../src/components/thermal/heat-demand.js";
import { heatTransferDefinition } from
  "../../src/components/thermal/heat-transfer.js";
import { thermalStoreDefinition } from "../../src/components/thermal/store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { createHeatDemandFollowingPolicy } from
  "../../src/policies/heat-demand-following.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  demandValues = [10],
  ambientValues = demandValues.map(() => 20),
  timeStepSeconds = 3600,
  maximumGridImportPowerkW = 200,
  heaterEfficiency = 1,
  heaterMaximumInputPowerkW = 100,
  heaterSupplyTemperatureC = 100,
  storeInitialTemperatureC = 80,
  storeMaximumTemperatureC = 100,
  storeMinimumUsefulTemperatureC = 70,
  heatTransferConductancekWPerK = 0,
  demandDefinition = heatDemandDefinition,
  policy = createHeatDemandFollowingPolicy({
    heaterComponentId: "heater",
    demandComponentId: "heat-demand",
    balancingComponentId: "grid"
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
            maximumImportPowerkW: maximumGridImportPowerkW,
            maximumExportPowerkW: 200
          },
          initialState: {}
        },
        {
          id: "heater",
          type: electricHeaterDefinition.type,
          definitionVersion: electricHeaterDefinition.version,
          name: "Electric heater",
          parameters: {
            maximumElectricalInputPowerkW: heaterMaximumInputPowerkW,
            efficiency: heaterEfficiency,
            supplyTemperatureC: heaterSupplyTemperatureC
          },
          initialState: {}
        },
        {
          id: "store",
          type: thermalStoreDefinition.type,
          definitionVersion: thermalStoreDefinition.version,
          name: "Hot-water store",
          parameters: {
            maximumMassKg: 1000,
            specificHeatCapacityKjPerKgK: 3.6,
            enthalpyReferenceTemperatureC: 0,
            maximumTemperatureC: storeMaximumTemperatureC,
            minimumUsefulTemperatureC: storeMinimumUsefulTemperatureC,
            maximumHeatInputkW: 100,
            maximumHeatOutputkW: 100
          },
          initialState: {
            massKg: 1000,
            containedEnthalpykWh: storeInitialTemperatureC
          }
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
          type: constantTemperatureDefinition.type,
          definitionVersion: constantTemperatureDefinition.version,
          name: "Ambient",
          parameters: { temperatureSeriesId: "ambient-temperature" },
          initialState: {}
        },
        {
          id: "store-loss",
          type: heatTransferDefinition.type,
          definitionVersion: heatTransferDefinition.version,
          name: "Store heat loss",
          parameters: {
            conductancekWPerK: heatTransferConductancekWPerK
          },
          initialState: {}
        }
      ],
      connections: [
        {
          id: "grid-to-heater",
          name: "Grid to heater",
          from: { componentId: "grid", portId: "electricity" },
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
          id: "store-to-loss",
          name: "Store to heat transfer",
          from: { componentId: "store", portId: "passive-heat-out" },
          to: { componentId: "store-loss", portId: "source" }
        },
        {
          id: "store-to-ambient",
          name: "Heat transfer to ambient",
          from: { componentId: "store-loss", portId: "sink" },
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
      electricalGridDefinition,
      constantTemperatureDefinition,
      electricHeaterDefinition,
      demandDefinition,
      heatTransferDefinition,
      thermalStoreDefinition
    ])
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance);
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
  const [grid, heater, store, demand, ambient, heatTransfer] = step.components;

  assert.deepEqual(heater.requestedCommand, { powerkW: -10 });
  assert.deepEqual(heater.feasibleCommand, {
    powerkW: -10,
    heatOutputkW: 10
  });
  assert.deepEqual(heater.actualCommand, {
    powerkW: -10,
    heatOutputkW: 10
  });
  assert.deepEqual(heater.outputs, {
    electricalInputPowerkW: 10,
    heatOutputkW: 10,
    supplyTemperatureC: 100
  });
  assert.deepEqual(grid.actualCommand, { powerkW: 10 });

  assert.equal(store.requestedCommand, null);
  assert.equal(store.feasibleCommand, null);
  assert.deepEqual(store.actualCommand, {
    materialInFlow: {
      massFlowKgPerSecond: 0,
      specificEnthalpyKjPerKg: 288
    },
    materialOutFlow: {
      massFlowKgPerSecond: 0,
      specificEnthalpyKjPerKg: 288
    },
    heatInFlows: {
      "heater-to-store": {
        heatFlowkW: 10,
        sourceTemperatureC: 100,
        deliveryTemperatureC: 100
      }
    },
    heatOutFlow: {
      heatFlowkW: 10,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 80
    },
    passiveHeatInFlows: {},
    passiveHeatOutFlows: {
      "store-to-loss": {
        heatFlowkW: 0,
        sourceTemperatureC: 80,
        deliveryTemperatureC: 80
      }
    }
  });
  assert.deepEqual(heatTransfer.actualCommand, {
    sourceFlow: {
      heatFlowkW: 0,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 80
    },
    sinkFlow: {
      heatFlowkW: 0,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 20
    }
  });
  assert.deepEqual(store.outputs, {
    massInflowKgPerSecond: 0,
    massOutflowKgPerSecond: 0,
    enthalpyInflowkW: 0,
    enthalpyOutflowkW: 0,
    heatInputkW: 10,
    heatOutputkW: 10,
    passiveHeatInputkW: 0,
    passiveHeatOutputkW: 0,
    netEnergyFlowkW: 0,
    containedMassKg: 1000,
    containedEnthalpykWh: 80,
    specificEnthalpyKjPerKg: 288,
    temperatureC: 80,
    usableEnergykWh: 10,
    temperatureMarginK: 10
  });
  assert.equal(demand.outputs.servedHeatFlowkW, 10);
  assert.equal(demand.outputs.unmetHeatFlowkW, 0);
  assert.equal(ambient.outputs.receivedHeatFlowkW, 0);

  assert.deepEqual(step.connections, [
    {
      connectionId: "grid-to-heater",
      flowType: "electricity.active-power",
      flow: { powerkW: 10 }
    },
    {
      connectionId: "heater-to-store",
      flowType: "thermal.heat-flow",
      flow: {
        heatFlowkW: 10,
        sourceTemperatureC: 100,
        deliveryTemperatureC: 100
      }
    },
    {
      connectionId: "store-to-demand",
      flowType: "thermal.heat-flow",
      flow: {
        heatFlowkW: 10,
        sourceTemperatureC: 80,
        deliveryTemperatureC: 80
      }
    },
    {
      connectionId: "store-to-loss",
      flowType: "thermal.heat-flow",
      flow: {
        heatFlowkW: 0,
        sourceTemperatureC: 80,
        deliveryTemperatureC: 80
      }
    },
    {
      connectionId: "store-to-ambient",
      flowType: "thermal.heat-flow",
      flow: {
        heatFlowkW: 0,
        sourceTemperatureC: 80,
        deliveryTemperatureC: 20
      }
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
  assert.equal(first.components[2].outputs.temperatureC, 75);
  assert.equal(first.components[3].outputs.servedHeatFlowkW, 0);
  assert.equal(first.components[3].outputs.unmetHeatFlowkW, 10);
  assert.equal(second.components[2].actualCommand.heatOutFlow.heatFlowkW, 5);
  assert.equal(second.components[2].outputs.temperatureC, 80);
  assert.equal(second.components[3].outputs.servedHeatFlowkW, 5);
  assert.equal(second.components[3].outputs.unmetHeatFlowkW, 5);
});

test("heat transfer determines standing loss and the store conserves energy", () => {
  const result = runScenario(createFixture({
    demandValues: [4],
    heatTransferConductancekWPerK: 0.1
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  const store = step.components[2];
  assert.equal(store.actualCommand.heatInFlows["heater-to-store"].heatFlowkW, 4);
  assert.equal(store.actualCommand.heatOutFlow.heatFlowkW, 4);
  assert.equal(store.outputs.passiveHeatOutputkW, 6);
  assert.equal(store.outputs.netEnergyFlowkW, -6);
  assertClose(store.outputs.temperatureC, 74);
  assert.equal(step.components[4].outputs.receivedHeatFlowkW, 6);
  assert.equal(step.components[5].outputs.heatFlowkW, 6);
  assert.equal(step.connections[3].flow.heatFlowkW, 6);
  assert.equal(step.connections[4].flow.heatFlowkW, 6);
});

test("heat-demand-following policy converts requested heat through heater efficiency", () => {
  const result = runScenario(createFixture({
    demandValues: [8],
    heaterEfficiency: 0.8
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  assert.deepEqual(step.components[1].requestedCommand, { powerkW: -10 });
  assert.deepEqual(step.components[1].actualCommand, {
    powerkW: -10,
    heatOutputkW: 8
  });
  assert.deepEqual(step.components[0].actualCommand, { powerkW: 10 });
});

test("the store clamps heater operation at its supply-temperature boundary", () => {
  const result = runScenario(createFixture({
    demandValues: [0],
    heaterEfficiency: 0.8,
    heaterSupplyTemperatureC: 85,
    policy: {
      request: () => ({
        targets: { heater: { powerkW: -100 } },
        balancingComponentId: "grid"
      })
    }
  }));

  assert.equal(result.completed, true);
  const step = result.results.steps[0];
  assert.deepEqual(step.components[1].requestedCommand, { powerkW: -100 });
  assert.deepEqual(step.components[1].feasibleCommand, {
    powerkW: -6.25,
    heatOutputkW: 5
  });
  assert.deepEqual(step.components[0].actualCommand, { powerkW: 6.25 });
  assert.equal(step.components[2].outputs.temperatureC, 85);
  assert.equal(step.connections[1].flow.heatFlowkW, 5);
});

test("a store at maximum temperature can replace simultaneous heat output", () => {
  const result = runScenario(createFixture({
    demandValues: [10],
    storeInitialTemperatureC: 100,
    storeMaximumTemperatureC: 100
  }));

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  const store = result.results.steps[0].components[2];
  assert.equal(store.actualCommand.heatInFlows["heater-to-store"].heatFlowkW, 10);
  assert.equal(store.actualCommand.heatOutFlow.heatFlowkW, 10);
  assert.equal(store.outputs.temperatureC, 100);
});

test("coupled runtime preserves electrical grid infeasibility", () => {
  const result = runScenario(createFixture({
    demandValues: [10],
    maximumGridImportPowerkW: 4
  }));

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.electrical-balance-infeasible"));
});

test("thermal-store material and passive heat ports are optional", () => {
  const fixture = createFixture();
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => !["store-to-loss", "store-to-ambient"].includes(
      connection.id
    )
  );
  fixture.model.components = fixture.model.components.filter(
    (component) => component.id !== "store-loss"
  );
  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.ok(result.results.steps.every((step) =>
    step.components[2].outputs.passiveHeatOutputkW === 0
  ));
});

test("heat transfer requires both of its visible boundary connections", () => {
  const fixture = createFixture({ heatTransferConductancekWPerK: 0.1 });
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => connection.id !== "store-to-loss"
  );
  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes(
    "runtime.component-connection-count"
  ));
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
              heatFlowkW: evaluation.portFlows["heat-in"].heatFlowkW + 1
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
  assert.throws(
    () => createHeatDemandFollowingPolicy({
      heaterComponentId: "heater",
      demandComponentId: "heat-demand"
    }),
    /balancingComponentId must be a non-empty string/u
  );

  const result = runScenario(createFixture({
    policy: createHeatDemandFollowingPolicy({
      heaterComponentId: "store",
      demandComponentId: "heat-demand",
      balancingComponentId: "grid"
    })
  }));
  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.policy-failed"));
});
