import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { ambientBoundaryDefinition } from
  "../../src/components/thermal/ambient-boundary.js";
import { electricHeaterDefinition } from
  "../../src/components/thermal/electric-heater.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { integrateStepPowerkWh } from
  "../../src/core/energy-integration.js";
import {
  validateLayout,
  validateModel,
  validateScenario
} from "../../src/core/validation/validate-documents.js";
import { createScheduledHeatingPolicy } from
  "../../src/policies/scheduled-heating.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

const exampleDirectory = new URL(
  "../../examples/batch-heating-synthetic/",
  import.meta.url
);

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
  electricalGridDefinition,
  thermalStoreDefinition,
  ambientBoundaryDefinition,
  electricHeaterDefinition
]);
const policy = createScheduledHeatingPolicy({
  heaterComponentId: "heater",
  powerSeriesId: "heater-input-power",
  balancingComponentId: "grid"
});
const runResult = runScenario({ model, scenario, policy, registry });
const batchModelComponent = model.components.find(
  (component) => component.id === "batch"
);
const batchThermalCapacitykWhPerK =
  batchModelComponent.initialState.massKg *
  batchModelComponent.parameters.specificHeatCapacityKjPerKgK /
  3600;

function componentAtStep(step, componentId) {
  return step.components.find((component) => component.componentId === componentId);
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
    const batch = componentAtStep(step, "batch");
    series.heaterRequestedPowerkW.push(heater.requestedCommand.powerkW);
    series.heaterElectricalInputPowerkW.push(
      heater.outputs.electricalInputPowerkW
    );
    series.heaterHeatOutputkW.push(heater.outputs.heatOutputkW);
    series.batchHeatInputkW.push(batch.outputs.heatInputkW);
    series.batchHeatLosskW.push(batch.outputs.heatLosskW);
    series.batchTemperatureC.push(batch.outputs.temperatureC);
    series.requiredTemperatureMarginK.push(
      batch.outputs.temperatureMarginK
    );
  }
  return series;
}

function summarise(series) {
  const finalTemperatureC = series.batchTemperatureC.at(-1);
  const initialTemperatureC =
    batchModelComponent.parameters.enthalpyReferenceTemperatureC +
    batchModelComponent.initialState.containedEnthalpykWh /
      batchThermalCapacitykWhPerK;
  return {
    totalGridImportEnergykWh: integrateStepPowerkWh(
      runResult.results.steps.map((step) =>
        componentAtStep(step, "grid").outputs.importPowerkW),
      runResult.results.time.timeStepSeconds
    ),
    totalHeaterElectricalInputEnergykWh: integrateStepPowerkWh(
      series.heaterElectricalInputPowerkW,
      runResult.results.time.timeStepSeconds
    ),
    totalHeaterHeatOutputEnergykWh: integrateStepPowerkWh(
      series.heaterHeatOutputkW,
      runResult.results.time.timeStepSeconds
    ),
    totalBatchHeatInputEnergykWh: integrateStepPowerkWh(
      series.batchHeatInputkW,
      runResult.results.time.timeStepSeconds
    ),
    totalBatchNetHeatEnergykWh: integrateStepPowerkWh(
      series.batchHeatInputkW.map((value, index) =>
        value - series.batchHeatLosskW[index]),
      runResult.results.time.timeStepSeconds
    ),
    totalHeatLossEnergykWh: integrateStepPowerkWh(
      series.batchHeatLosskW,
      runResult.results.time.timeStepSeconds
    ),
    initialBatchTemperatureC: initialTemperatureC,
    finalBatchTemperatureC: finalTemperatureC,
    batchThermalCapacitykWhPerK,
    batchInternalEnergyChangekWh:
      batchThermalCapacitykWhPerK *
      (finalTemperatureC - initialTemperatureC),
    finalRequiredTemperatureMarginK:
      series.requiredTemperatureMarginK.at(-1)
  };
}

test("batch-heating example documents are valid and use stable references", () => {
  assert.equal(validateModel(model, { registry }).valid, true);
  assert.equal(validateScenario(scenario).valid, true);
  assert.equal(validateLayout(layout, { model }).valid, true);
  assert.deepEqual(
    model.components.map((component) => component.id),
    ["grid", "heater", "batch", "ambient"]
  );
  assert.equal(layout.components.length, model.components.length);
  assert.deepEqual(runResult.results.steps[0].resolutionPlan.stages, [
    ["batch"],
    ["heater", "ambient"],
    ["grid"]
  ]);
});

test("batch-heating example matches the reviewed headless result fixture", () => {
  assert.equal(runResult.completed, true, JSON.stringify(runResult.diagnostics));
  assert.deepEqual(runResult.diagnostics, []);
  assert.equal(
    runResult.results.steps.length,
    expectedResults.numericContract.timeStepCount
  );
  assert.equal(
    runResult.results.time.timeStepSeconds,
    expectedResults.numericContract.timeStepSeconds
  );

  const series = resultSeries();
  for (const [name, expectedValues] of Object.entries(expectedResults.series)) {
    assertSeriesClose(series[name], expectedValues);
  }
  const summary = summarise(series);
  for (const [name, expectedValue] of Object.entries(expectedResults.summary)) {
    assertClose(summary[name], expectedValue);
  }
  assert.deepEqual(
    runScenario({ model, scenario, policy, registry }),
    runResult
  );
});

test("batch-heating example conserves electrical and thermal energy", () => {
  const series = resultSeries();
  const summary = summarise(series);
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
    summary.totalBatchHeatInputEnergykWh,
    summary.totalHeaterHeatOutputEnergykWh
  );
  assertClose(
    summary.totalBatchNetHeatEnergykWh,
    summary.totalBatchHeatInputEnergykWh - summary.totalHeatLossEnergykWh
  );
  assertClose(
    summary.batchInternalEnergyChangekWh,
    summary.totalBatchNetHeatEnergykWh
  );
});

test("batch component warns when the final required temperature is missed", () => {
  const failingModel = structuredClone(model);
  failingModel.components.find(
    (component) => component.id === "batch"
  ).parameters.minimumUsefulTemperatureC = 135;
  const result = runScenario({ model: failingModel, scenario, policy, registry });

  assert.equal(result.completed, true);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      path: diagnostic.path
    })),
    [{
      severity: "warning",
      code: "thermal.store.minimum-temperature-missed",
      path: "/steps/15/components/batch"
    }]
  );
});
