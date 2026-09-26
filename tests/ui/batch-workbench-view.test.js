import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { electricHeaterDefinition } from
  "../../src/components/thermal/electric-heater.js";
import { heatTransferDefinition } from
  "../../src/components/thermal/heat-transfer.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createResultsChartModel } from "../../src/ui/results-chart-model.js";
import { createBatchHeatingRunKpis } from "../../src/ui/run-kpi-model.js";
import {
  createInspectorDiagnosticViews,
  createWorkbenchView
} from "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL(
  "../../examples/batch-heating-synthetic/",
  import.meta.url
);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [model, scenario, expectedResults] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json"),
  readExampleJson("expected-results.json")
]);
const registry = createComponentRegistry([
  electricalGridDefinition,
  thermalStoreDefinition,
  constantTemperatureDefinition,
  electricHeaterDefinition,
  heatTransferDefinition
]);
const run = runScenario({ model, scenario, registry });

function assertSeriesClose(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) <= tolerance);
  });
}

test("batch workbench chart exposes flow and required-temperature results", () => {
  assert.equal(run.completed, true, JSON.stringify(run.diagnostics));
  const chart = createResultsChartModel({
    model,
    registry,
    results: run.results,
    scenario
  });

  assert.deepEqual(chart.series.map((series) => series.id), [
    "grid-to-heater:forward",
    "heater-to-batch:forward",
    "batch-to-ambient:forward"
  ]);
  assert.deepEqual(
    chart.prescribedPowerSeries.map((series) => ({
      id: series.id,
      kind: series.kind,
      label: series.label,
      values: series.values.map((point) => point.powerkW)
    })),
    [{
      id: "scenario:heater-input-power",
      kind: "prescribed",
      label: "Scheduled heater input · scenario input",
      values: scenario.series.find(
        (series) => series.id === "heater-input-power"
      ).data.values
    }]
  );
  assert.equal(chart.temperatureSeries.length, 1);
  const [temperature] = chart.temperatureSeries;
  assert.equal(temperature.id, "batch:temperature");
  assert.equal(temperature.label, "Batch temperature");
  assert.equal(temperature.thresholdC, 120);
  assert.equal(temperature.thresholdLabel, "Minimum useful");
  assert.deepEqual(temperature.values[0], {
    stepIndex: -1, elapsedSeconds: 0, temperatureC: 20
  });
  assert.equal(temperature.stepValueOffset, 1);
  assertSeriesClose(
    temperature.values.slice(1).map((point) => point.temperatureC),
    expectedResults.series.batchTemperatureC
  );
  assert.deepEqual(
    chart.prescribedTemperatureSeries.map((series) => ({
      id: series.id,
      kind: series.kind,
      label: series.label,
      values: series.values.map((point) => point.temperatureC)
    })),
    [{
      id: "scenario:ambient-temperature",
      kind: "prescribed",
      label: "Ambient temperature · scenario input",
      values: Array.from({ length: 16 }, () => 20)
    }]
  );
});

test("a one-step temperature chart includes both initial and final state samples", () => {
  const oneStepScenario = structuredClone(scenario);
  oneStepScenario.time.stepCount = 1;
  for (const series of oneStepScenario.series) {
    series.data.values = [series.data.values[0]];
  }
  const oneStepRun = runScenario({ model, scenario: oneStepScenario, registry });
  assert.equal(oneStepRun.completed, true);
  const chart = createResultsChartModel({
    model, registry, results: oneStepRun.results, scenario: oneStepScenario
  });
  const [temperature] = chart.temperatureSeries;
  assert.deepEqual(temperature.values.map(({ elapsedSeconds }) => elapsedSeconds), [0, 900]);
  assert.equal(temperature.values[0].temperatureC, 20);
  assert.equal(temperature.values[1].temperatureC,
    oneStepRun.results.steps[0].components.find(({ componentId }) => componentId === "batch").outputs.temperatureC);
});

test("batch workbench inspector exposes editable model inputs and live results", () => {
  const stepIndex = run.results.steps.length - 1;
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex
  });
  const batch = view.components.find((component) => component.id === "batch");
  const parameters = Object.fromEntries(batch.parameterGroups
    .flatMap((group) => group.fields)
    .map((field) => [field.id, field]));

  assert.equal(batch.metric.value, expectedResults.summary.finalBatchTemperatureC);
  assert.equal(batch.metric.unit, "°C");
  assert.deepEqual(Object.keys(parameters), [
    "maximumMassKg",
    "specificHeatCapacityKjPerKgK",
    "enthalpyReferenceTemperatureC",
    "maximumTemperatureC",
    "minimumUsefulTemperatureC",
    "maximumHeatInputkW",
    "maximumHeatOutputkW"
  ]);
  assert.ok(Object.values(parameters).every((field) => field.editor !== null));
  assert.equal(
    parameters.specificHeatCapacityKjPerKgK.label,
    "Specific heat capacity"
  );
  assert.equal(
    parameters.specificHeatCapacityKjPerKgK.unit,
    "kJ / kgK"
  );
  assert.equal(
    parameters.specificHeatCapacityKjPerKgK.displayValue,
    "3.6 kJ / kgK"
  );
  assert.equal(
    batch.outputFields.find(
      (field) => field.id === "temperatureMarginK"
    ).value,
    expectedResults.summary.finalRequiredTemperatureMarginK
  );
  assert.equal(
    batch.outputFields.find((field) => field.id === "temperatureC").value,
    expectedResults.summary.finalBatchTemperatureC
  );
});

test("batch workbench KPIs use explicit-forward energy totals", () => {
  const kpis = Object.fromEntries(createBatchHeatingRunKpis(run.results).map(
    (candidate) => [candidate.id, candidate]
  ));
  const expected = expectedResults.summary;

  assert.equal(kpis["grid-import-energy"].value, expected.totalGridImportEnergykWh);
  assert.equal(kpis["heat-supplied-energy"].value, expected.totalBatchHeatInputEnergykWh);
  assert.equal(kpis["heat-absorbed-energy"].value, expected.totalBatchNetHeatEnergykWh);
  assert.equal(kpis["heat-loss-energy"].value, expected.totalHeatLossEnergykWh);
  assert.equal(kpis["final-batch-temperature"].value, expected.finalBatchTemperatureC);
  assert.equal(
    kpis["required-temperature-margin"].value,
    expected.finalRequiredTemperatureMarginK
  );
  assert.equal(kpis["required-temperature-margin"].tone, "neutral");
});

test("batch workbench explains a missed final temperature on the batch", () => {
  const failingModel = structuredClone(model);
  failingModel.components.find(
    (component) => component.id === "batch"
  ).parameters.minimumUsefulTemperatureC = 135;
  const failingRun = runScenario({
    model: failingModel,
    scenario,
    registry,
  });
  const stepIndex = failingRun.results.steps.length - 1;
  const view = createWorkbenchView({
    model: failingModel,
    registry,
    results: failingRun.results,
    stepIndex
  });
  const batch = view.components.find((component) => component.id === "batch");

  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: failingRun.diagnostics,
    stepIndex,
    component: batch
  }), [{
    severity: "warning",
    code: "thermal.store.minimum-temperature-missed",
    title: "Required temperature missed",
    message: "126.7 °C final · 8.349 K below requirement"
  }]);
  assert.equal(
    createBatchHeatingRunKpis(failingRun.results).find(
      (candidate) => candidate.id === "required-temperature-margin"
    ).tone,
    "warning"
  );
});
