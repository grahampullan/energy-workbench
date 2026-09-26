import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { materialSinkDefinition } from
  "../../src/components/material/sink.js";
import { materialSourceDefinition } from
  "../../src/components/material/source.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { electricHeaterDefinition } from
  "../../src/components/thermal/electric-heater.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { MATERIAL_MASS_FLOW_TYPE } from "../../src/core/flow-types.js";
import { validateLayout } from
  "../../src/core/validation/validate-documents.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createResultsChartModel } from
  "../../src/ui/results-chart-model.js";
import { createMaterialInventoryRunKpis } from
  "../../src/ui/run-kpi-model.js";
import { createWorkbenchView } from
  "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL(
  "../../examples/material-inventory-synthetic/",
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
  materialSourceDefinition,
  electricalGridDefinition,
  electricHeaterDefinition,
  thermalStoreDefinition,
  materialSinkDefinition
]);
const run = runScenario({ model, scenario, registry });

function activeStepIndices(series, field) {
  return series.values
    .filter((value) => value[field] > 0)
    .map(({ stepIndex }) => stepIndex);
}

function stepIndices(start, count) {
  return Array.from({ length: count }, (_, index) => start + index);
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance);
}

test("material-inventory UI documents and chart series are complete", () => {
  assert.equal(run.completed, true, JSON.stringify(run.diagnostics));
  assert.equal(validateLayout(layout, { model }).valid, true);
  const chart = createResultsChartModel({
    model,
    registry,
    results: run.results,
    scenario
  });

  assert.deepEqual(chart.series.map(({ id }) => id), [
    "grid-to-heater:forward",
    "heater-to-inventory:forward"
  ]);
  assert.deepEqual(chart.materialSeries.map(({ id }) => id), [
    "source-to-inventory:mass-forward",
    "inventory-to-sink:mass-forward"
  ]);
  assert.ok(chart.materialSeries.every(({ values }) => values.length === 160));
  assert.deepEqual(activeStepIndices(
    chart.materialSeries[0],
    "massFlowKgPerSecond"
  ), stepIndices(20, 20));
  assert.deepEqual(activeStepIndices(
    chart.materialSeries[1],
    "massFlowKgPerSecond"
  ), stepIndices(110, 20));
  assert.deepEqual(chart.prescribedMassSeries.map(({ id }) => id), [
    "scenario:material-inflow",
    "scenario:material-outflow"
  ]);
  assert.ok(chart.prescribedMassSeries.every(
    ({ values }) => values.length === 160
  ));
  assert.deepEqual(activeStepIndices(
    chart.prescribedMassSeries.at(-1),
    "massFlowKgPerSecond"
  ), stepIndices(110, 20));
  assert.equal(chart.timeStepSeconds, 6);
  assert.equal(chart.endElapsedSeconds, 960);

  assert.equal(chart.temperatureSeries.length, 1);
  const [temperature] = chart.temperatureSeries;
  assert.equal(temperature.id, "inventory:temperature");
  assert.equal(temperature.stepValueOffset, 1);
  assert.equal(temperature.thresholdC, 0);
  assert.equal(temperature.thresholdLabel, "Minimum useful");
  assert.equal(temperature.values.length, 161);
  assert.deepEqual(temperature.values[0], {
    stepIndex: -1, elapsedSeconds: 0, temperatureC: 0
  });
  for (const checkpoint of expectedResults.checkpoints) {
    assert.ok(Math.abs(
      temperature.values[checkpoint.stepIndex + temperature.stepValueOffset].temperatureC
        - checkpoint.temperatureC
    ) <= 1e-12);
  }
});

test("material topology and inspector expose mass, enthalpy, and temperature", () => {
  const stepIndex = 119;
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex
  });
  const inventory = view.components.find(({ id }) => id === "inventory");
  const materialConnections = view.connections.filter(
    ({ flowType }) => flowType === MATERIAL_MASS_FLOW_TYPE
  );

  assert.equal(inventory.metric.value, 110);
  assert.equal(inventory.metric.unit, "°C");
  assert.equal(
    inventory.outputFields.find(({ id }) => id === "containedMassKg").value,
    60
  );
  assert.equal(
    inventory.outputFields.find(
      ({ id }) => id === "specificEnthalpyKjPerKg"
    ).value,
    110
  );
  assert.equal(
    inventory.outputFields.find(({ id }) => id === "enthalpyInflowkW").label,
    "Material enthalpy rate in"
  );
  assert.equal(
    inventory.outputFields.find(({ id }) => id === "heatInputkW").label,
    "Heat-transfer input"
  );
  assert.equal(
    inventory.outputFields.find(({ id }) => id === "netEnergyFlowkW").label,
    "Stored enthalpy change rate"
  );
  assert.ok(inventory.parameterGroups.flatMap(({ fields }) => fields)
    .every(({ editor }) => editor !== null));
  assert.deepEqual(materialConnections.map(({ displayFlow }) => displayFlow), [
    "0 kg/s · 100 kJ/kg",
    "1 kg/s · 110 kJ/kg"
  ]);
});

test("material-inventory KPIs report the reviewed balances", () => {
  const kpis = Object.fromEntries(createMaterialInventoryRunKpis(
    run.results
  ).map((candidate) => [candidate.id, candidate]));
  const expected = expectedResults.summary;

  assert.equal(kpis["material-mass-in"].value, expected.totalMassInKg);
  assert.equal(kpis["material-mass-out"].value, expected.totalMassOutKg);
  assertClose(
    kpis["material-enthalpy-in"].value,
    expected.totalEnthalpyInKWh
  );
  assertClose(kpis["heat-input-energy"].value, expected.totalHeatInputKWh);
  assertClose(
    kpis["material-enthalpy-out"].value,
    expected.totalEnthalpyOutKWh
  );
  assert.equal(kpis["peak-inventory-temperature"].value, 110);
});
