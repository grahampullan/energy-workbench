import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalBusDefinition } from
  "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { ambientBoundaryDefinition } from
  "../../src/components/thermal/ambient-boundary.js";
import { electricHeaterDefinition } from
  "../../src/components/thermal/electric-heater.js";
import { heatDemandDefinition } from
  "../../src/components/thermal/heat-demand.js";
import { hotWaterStoreDefinition } from
  "../../src/components/thermal/hot-water-store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import {
  validateLayout,
  validateModel,
  validateScenario
} from "../../src/core/validation/validate-documents.js";
import { createHeatDemandFollowingPolicy } from
  "../../src/policies/heat-demand-following.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

const exampleDirectory = new URL("../../examples/coupled-thermal/", import.meta.url);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [model, scenario, layout, expectedResults] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json"),
  readExampleJson("layout.json"),
  readExampleJson("expected-results.json")
]);

const registry = createComponentRegistry([
  electricalBusDefinition,
  electricalGridDefinition,
  ambientBoundaryDefinition,
  electricHeaterDefinition,
  heatDemandDefinition,
  hotWaterStoreDefinition
]);
const policy = createHeatDemandFollowingPolicy({
  heaterComponentId: "heater",
  demandComponentId: "heat-demand"
});
const runResult = runScenario({ model, scenario, policy, registry });
const storeModelComponent = model.components.find(
  (component) => component.id === "store"
);
const storeThermalCapacitykWhPerK =
  storeModelComponent.parameters.volumeM3 *
  storeModelComponent.parameters.waterDensityKgPerM3 *
  storeModelComponent.parameters.specificHeatCapacityKjPerKgK /
  3600;

function componentAtStep(step, componentId) {
  return step.components.find((component) => component.componentId === componentId);
}

function integrateFixedStep(values) {
  const durationHours = runResult.results.time.timeStepSeconds / 3600;
  return values.reduce((energykWh, value) =>
    energykWh + value * durationHours, 0);
}

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function assertSeriesClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assertClose(value, expected[index]));
}

function resultSeries() {
  const series = Object.fromEntries(
    Object.keys(expectedResults.series).map((name) => [name, []])
  );

  for (const step of runResult.results.steps) {
    const heater = componentAtStep(step, "heater");
    const store = componentAtStep(step, "store");
    const demand = componentAtStep(step, "heat-demand");
    series.heaterRequestedPowerkW.push(heater.requestedCommand.powerkW);
    series.heaterElectricalInputPowerkW.push(
      heater.outputs.electricalInputPowerkW
    );
    series.heaterHeatOutputkW.push(heater.outputs.heatOutputkW);
    series.storeChargeHeatFlowkW.push(store.outputs.chargeHeatFlowkW);
    series.storeDischargeHeatFlowkW.push(store.outputs.dischargeHeatFlowkW);
    series.storeHeatLosskW.push(store.outputs.heatLosskW);
    series.storeTemperatureC.push(store.state.temperatureC);
    series.demandHeatFlowkW.push(demand.outputs.demandHeatFlowkW);
    series.servedHeatFlowkW.push(demand.outputs.servedHeatFlowkW);
    series.unmetHeatFlowkW.push(demand.outputs.unmetHeatFlowkW);
  }

  return series;
}

function summarise(series) {
  const finalTemperatureC = series.storeTemperatureC.at(-1);
  const initialTemperatureC = storeModelComponent.initialState.temperatureC;
  return {
    totalGridImportEnergykWh: integrateFixedStep(
      runResult.results.steps.map((step) =>
        componentAtStep(step, "grid").outputs.importPowerkW)
    ),
    totalHeaterElectricalInputEnergykWh: integrateFixedStep(
      series.heaterElectricalInputPowerkW
    ),
    totalHeaterHeatOutputEnergykWh: integrateFixedStep(
      series.heaterHeatOutputkW
    ),
    totalDemandEnergykWh: integrateFixedStep(series.demandHeatFlowkW),
    totalServedHeatEnergykWh: integrateFixedStep(series.servedHeatFlowkW),
    totalUnmetHeatEnergykWh: integrateFixedStep(series.unmetHeatFlowkW),
    totalStoreChargeEnergykWh: integrateFixedStep(
      series.storeChargeHeatFlowkW
    ),
    totalStoreDischargeEnergykWh: integrateFixedStep(
      series.storeDischargeHeatFlowkW
    ),
    totalStandingHeatLossEnergykWh: integrateFixedStep(series.storeHeatLosskW),
    initialStoreTemperatureC: initialTemperatureC,
    finalStoreTemperatureC: finalTemperatureC,
    storeThermalCapacitykWhPerK,
    storeInternalEnergyChangekWh:
      storeThermalCapacitykWhPerK *
      (finalTemperatureC - initialTemperatureC),
    maximumPowerBalanceErrorkW: Math.max(
      ...runResult.results.steps.map((step) => Math.abs(
        componentAtStep(step, "bus").outputs.powerBalanceErrorkW
      ))
    )
  };
}

test("coupled thermal example documents are valid and use stable references", () => {
  assert.equal(validateModel(model, { registry }).valid, true);
  assert.equal(validateScenario(scenario).valid, true);
  assert.equal(validateLayout(layout, { model }).valid, true);
  assert.deepEqual(
    model.components.map((component) => component.id),
    ["grid", "bus", "heater", "store", "heat-demand", "ambient"]
  );
  assert.equal(layout.components.length, model.components.length);
});

test("coupled thermal example matches the reviewed headless result fixture", () => {
  assert.equal(runResult.completed, true, JSON.stringify(runResult.diagnostics));
  assert.equal(runResult.results.steps.length,
    expectedResults.numericContract.timeStepCount);
  assert.equal(runResult.results.time.timeStepSeconds,
    expectedResults.numericContract.timeStepSeconds);

  const series = resultSeries();
  for (const [name, expectedValues] of Object.entries(expectedResults.series)) {
    assertSeriesClose(series[name], expectedValues);
  }
  const summary = summarise(series);
  for (const [name, expectedValue] of Object.entries(expectedResults.summary)) {
    assertClose(summary[name], expectedValue);
  }

  assert.ok(runResult.diagnostics.every(
    (diagnostic) => diagnostic.severity === "warning" &&
      diagnostic.code === expectedResults.expectedDiagnostics.code
  ));
  assert.deepEqual(
    runResult.diagnostics.map((diagnostic) =>
      Number(diagnostic.path.split("/")[2])),
    expectedResults.expectedDiagnostics.stepIndices
  );
});

test("coupled thermal example conserves electrical and thermal energy", () => {
  const summary = summarise(resultSeries());
  const heaterEfficiency = model.components.find(
    (component) => component.id === "heater"
  ).parameters.efficiency;

  assertClose(
    summary.totalGridImportEnergykWh,
    summary.totalHeaterElectricalInputEnergykWh
  );
  assertClose(
    summary.totalHeaterHeatOutputEnergykWh,
    summary.totalHeaterElectricalInputEnergykWh * heaterEfficiency
  );
  assertClose(
    summary.totalDemandEnergykWh,
    summary.totalServedHeatEnergykWh + summary.totalUnmetHeatEnergykWh
  );
  assertClose(
    summary.storeInternalEnergyChangekWh,
    summary.totalStoreChargeEnergykWh -
      summary.totalStoreDischargeEnergykWh -
      summary.totalStandingHeatLossEnergykWh
  );
  assert.ok(summary.maximumPowerBalanceErrorkW < 1e-12);
});

test("coupled thermal example exposes equipment and stored-energy limits", () => {
  const peakStep = runResult.results.steps[4];
  const energyLimitedStep = runResult.results.steps[5];
  const idleStep = runResult.results.steps[0];
  const peakHeater = componentAtStep(peakStep, "heater");
  const peakStore = componentAtStep(peakStep, "store");
  const peakDemand = componentAtStep(peakStep, "heat-demand");
  const energyLimitedStore = componentAtStep(energyLimitedStep, "store");

  assert.equal(peakHeater.requestedCommand.powerkW, -150 / 0.9);
  assert.equal(peakHeater.actualCommand.heatOutputkW, 80);
  assert.equal(peakStore.actualCommand.dischargeHeatFlowkW, 120);
  assert.equal(peakDemand.outputs.unmetHeatFlowkW, 30);
  assert.ok(
    energyLimitedStore.operatingLimits.maximumDischargeHeatFlowkW < 120
  );
  assertClose(
    energyLimitedStore.actualCommand.dischargeHeatFlowkW,
    energyLimitedStore.operatingLimits.maximumDischargeHeatFlowkW
  );
  assertClose(componentAtStep(idleStep, "heater").outputs.heatOutputkW, 0);
  assert.ok(componentAtStep(idleStep, "store").outputs.heatLosskW > 0);
});
