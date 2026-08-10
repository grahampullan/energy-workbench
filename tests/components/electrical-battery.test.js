import assert from "node:assert/strict";
import test from "node:test";

import { electricalBatteryDefinition } from "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createBatteryFixture({
  capacityKwh = 5,
  maximumChargePowerKw = 3,
  maximumDischargePowerKw = 3,
  chargingEfficiency = 1,
  dischargingEfficiency = 1,
  storedEnergyKwh = 0,
  requestedPowerKw = [0],
  timeStepSeconds = 3600
} = {}) {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.battery",
      name: "Battery model",
      components: [
        {
          id: "grid",
          type: electricalGridDefinition.type,
          definitionVersion: electricalGridDefinition.version,
          name: "Grid",
          parameters: {
            maximumImportPowerKw: 100,
            maximumExportPowerKw: 100
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
          id: "battery",
          type: electricalBatteryDefinition.type,
          definitionVersion: electricalBatteryDefinition.version,
          name: "Battery",
          parameters: {
            capacityKwh,
            maximumChargePowerKw,
            maximumDischargePowerKw,
            chargingEfficiency,
            dischargingEfficiency
          },
          initialState: { storedEnergyKwh }
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
          id: "battery-to-bus",
          name: "Battery to bus",
          from: { componentId: "battery", portId: "electricity" },
          to: { componentId: "bus", portId: "terminal-2" }
        }
      ]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.battery",
      name: "Battery scenario",
      time: {
        timeStepSeconds,
        stepCount: requestedPowerKw.length
      },
      series: []
    },
    policy: {
      request(runtimeModel, stepContext) {
        return {
          battery: { powerKw: requestedPowerKw[stepContext.stepIndex] }
        };
      }
    },
    registry: createComponentRegistry([
      electricalBatteryDefinition,
      electricalBusDefinition,
      electricalGridDefinition
    ])
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("battery limits clamp charging and discharging at empty and full state", () => {
  const fixture = createBatteryFixture({
    requestedPowerKw: [3, -3, -3, -3, 3, 3]
  });
  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  const batterySteps = result.results.steps.map((step) => step.components[2]);
  assert.deepEqual(
    batterySteps.map((component) => component.feasibleCommand.powerKw),
    [0, -3, -2, 0, 3, 2]
  );
  assert.deepEqual(
    batterySteps.map((component) => component.state.storedEnergyKwh),
    [0, 3, 5, 5, 2, 0]
  );
  assert.deepEqual(batterySteps[2].operatingLimits, {
    minimumPowerKw: -2,
    maximumPowerKw: 3
  });
  assert.deepEqual(batterySteps[3].outputs, {
    chargePowerKw: 0,
    dischargePowerKw: 0,
    netPowerKw: 0,
    storedEnergyKwh: 5,
    stateOfChargeFraction: 1
  });
  assert.deepEqual(
    result.results.steps.map((step) => step.components[0].actualCommand.powerKw),
    [0, 3, 2, 0, -3, -2]
  );
  assert.deepEqual(runScenario(fixture), result);
});

test("battery state applies charging and discharging efficiency", () => {
  const result = runScenario(createBatteryFixture({
    capacityKwh: 10,
    maximumChargePowerKw: 10,
    maximumDischargePowerKw: 10,
    chargingEfficiency: 0.8,
    dischargingEfficiency: 0.5,
    storedEnergyKwh: 1,
    requestedPowerKw: [-2, 1]
  }));

  assert.equal(result.completed, true);
  const [chargeStep, dischargeStep] = result.results.steps;
  assertClose(chargeStep.components[2].state.storedEnergyKwh, 2.6);
  assertClose(dischargeStep.components[2].state.storedEnergyKwh, 0.6);
  assert.deepEqual(chargeStep.components[2].outputs, {
    chargePowerKw: 2,
    dischargePowerKw: 0,
    netPowerKw: -2,
    storedEnergyKwh: 2.6,
    stateOfChargeFraction: 0.26
  });
  assert.deepEqual(dischargeStep.components[2].portFlows, {
    electricity: { powerKw: 1 }
  });
  assert.deepEqual(
    result.results.steps.map((step) => step.connections[1].powerKw),
    [-2, 1]
  );
});

test("battery energy limits include timestep duration and refine consistently", () => {
  const limitedResult = runScenario(createBatteryFixture({
    storedEnergyKwh: 0.5,
    requestedPowerKw: [3],
    timeStepSeconds: 900
  }));
  assert.equal(limitedResult.completed, true);
  assert.deepEqual(limitedResult.results.steps[0].components[2].operatingLimits, {
    minimumPowerKw: -3,
    maximumPowerKw: 2
  });
  assert.deepEqual(limitedResult.results.steps[0].components[2].actualCommand, {
    powerKw: 2
  });
  assert.equal(
    limitedResult.results.steps[0].components[2].state.storedEnergyKwh,
    0
  );

  const coarseResult = runScenario(createBatteryFixture({
    capacityKwh: 10,
    maximumChargePowerKw: 10,
    chargingEfficiency: 0.8,
    storedEnergyKwh: 1,
    requestedPowerKw: [-2],
    timeStepSeconds: 3600
  }));
  const refinedResult = runScenario(createBatteryFixture({
    capacityKwh: 10,
    maximumChargePowerKw: 10,
    chargingEfficiency: 0.8,
    storedEnergyKwh: 1,
    requestedPowerKw: [-2, -2],
    timeStepSeconds: 1800
  }));
  assert.equal(coarseResult.completed, true);
  assert.equal(refinedResult.completed, true);
  assertClose(
    coarseResult.results.steps[0].components[2].state.storedEnergyKwh,
    refinedResult.results.steps[1].components[2].state.storedEnergyKwh
  );
  assertClose(coarseResult.results.steps[0].components[2].state.storedEnergyKwh, 2.6);
});

test("battery validation rejects impossible initial energy and zero efficiency", () => {
  const excessiveInitialEnergy = runScenario(createBatteryFixture({
    capacityKwh: 5,
    storedEnergyKwh: 6
  }));
  assert.equal(excessiveInitialEnergy.completed, false);
  assert.ok(
    diagnosticCodes(excessiveInitialEnergy).includes(
      "electrical.battery.initial-energy-range"
    )
  );

  const zeroChargingEfficiency = runScenario(createBatteryFixture({
    chargingEfficiency: 0
  }));
  assert.equal(zeroChargingEfficiency.completed, false);
  assert.ok(
    diagnosticCodes(zeroChargingEfficiency).includes(
      "electrical.battery.charging-efficiency"
    )
  );

  const zeroDischargingEfficiency = runScenario(createBatteryFixture({
    dischargingEfficiency: 0
  }));
  assert.equal(zeroDischargingEfficiency.completed, false);
  assert.ok(
    diagnosticCodes(zeroDischargingEfficiency).includes(
      "electrical.battery.discharging-efficiency"
    )
  );
});
