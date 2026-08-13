import assert from "node:assert/strict";
import test from "node:test";

import { electricalBatteryDefinition } from "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalPvDefinition } from "../../src/components/electrical/pv.js";
import { electricalSourceDefinition } from "../../src/components/electrical/source.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { createPvBatterySelfConsumptionPolicy } from
  "../../src/policies/pv-battery-self-consumption.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  demandValues = [2, 1, 5, 5],
  generationValues = [5, 5, 0, 0],
  loadProfileMultiplier = 1,
  pvProfileMultiplier = 1,
  storedEnergykWh = 0,
  policy = createPvBatterySelfConsumptionPolicy({
    batteryComponentId: "battery"
  })
} = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.pv-battery-self-consumption",
      name: "PV battery self-consumption model",
      components: [
        {
          id: "grid",
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
      connections: [
        {
          id: "grid-to-bus",
          name: "Grid to bus",
          from: { componentId: "grid", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal-1" }
        },
        {
          id: "pv-to-bus",
          name: "PV to bus",
          from: { componentId: "pv", portId: "electricity-out" },
          to: { componentId: "bus", portId: "terminal-2" }
        },
        {
          id: "bus-to-load",
          name: "Bus to load",
          from: { componentId: "bus", portId: "terminal-3" },
          to: { componentId: "load", portId: "electricity-in" }
        },
        {
          id: "battery-to-bus",
          name: "Battery to bus",
          from: { componentId: "battery", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal-4" }
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
    policy,
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

test("runtime gives policies an immutable operating-limit snapshot", () => {
  let receivedPolicyContext;
  const selfConsumptionPolicy = createPvBatterySelfConsumptionPolicy({
    batteryComponentId: "battery"
  });
  const fixture = createFixture({
    demandValues: [2],
    generationValues: [5],
    policy: {
      request(runtimeModel, stepContext, policyContext) {
        receivedPolicyContext = policyContext;
        return selfConsumptionPolicy.request(
          runtimeModel,
          stepContext,
          policyContext
        );
      }
    }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.equal(Object.isFrozen(receivedPolicyContext), true);
  assert.equal(
    Object.isFrozen(receivedPolicyContext.operatingLimitsByComponentId),
    true
  );
  assert.deepEqual(receivedPolicyContext.operatingLimitsByComponentId.pv, {
    minimumPowerkW: 5,
    maximumPowerkW: 5
  });
  assert.deepEqual(receivedPolicyContext.operatingLimitsByComponentId.load, {
    minimumPowerkW: -2,
    maximumPowerkW: -2
  });
});

test("self-consumption policy rejects invalid battery and extra variable operation", () => {
  assert.throws(
    () => createPvBatterySelfConsumptionPolicy(),
    /batteryComponentId must be a non-empty string/u
  );

  const wrongBattery = createFixture({
    demandValues: [2],
    generationValues: [5],
    policy: createPvBatterySelfConsumptionPolicy({ batteryComponentId: "grid" })
  });
  const wrongBatteryResult = runScenario(wrongBattery);
  assert.equal(wrongBatteryResult.completed, false);
  assert.ok(diagnosticCodes(wrongBatteryResult).includes("runtime.policy-failed"));

  const variableSource = createFixture({
    demandValues: [2],
    generationValues: [5]
  });
  variableSource.model.components[2] = {
    id: "pv",
    type: electricalSourceDefinition.type,
    definitionVersion: electricalSourceDefinition.version,
    name: "Variable source",
    parameters: { maximumPowerkW: 10 },
    initialState: {}
  };
  const variableSourceResult = runScenario(variableSource);
  assert.equal(variableSourceResult.completed, false);
  assert.ok(diagnosticCodes(variableSourceResult).includes("runtime.policy-failed"));
  assert.match(
    variableSourceResult.diagnostics.at(-1).message,
    /requires fixed operation for component: pv/u
  );
});
