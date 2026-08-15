import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalBatteryDefinition } from
  "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalPvDefinition } from "../../src/components/electrical/pv.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { integrateStepPowerkWh } from
  "../../src/core/energy-integration.js";
import {
  validateLayout,
  validateModel,
  validateScenario,
  validateVariant
} from "../../src/core/validation/validate-documents.js";
import { createPvBatterySelfConsumptionPolicy } from
  "../../src/policies/pv-battery-self-consumption.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

const exampleDirectory = new URL("../../examples/blog-electrical/", import.meta.url);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [
  model,
  scenario,
  layout,
  doublePvVariant,
  doubleBatteryCapacityVariant,
  expectedResults,
  legacyModel,
  legacyExpectedResults
] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json"),
  readExampleJson("layout.json"),
  readExampleJson("variant-double-pv.json"),
  readExampleJson("variant-double-battery-capacity.json"),
  readExampleJson("expected-results.json"),
  readExampleJson("legacy-model.json"),
  readExampleJson("legacy-expected-results.json")
]);

const registry = createComponentRegistry([
  electricalBatteryDefinition,
  electricalBusDefinition,
  electricalGridDefinition,
  electricalLoadDefinition,
  electricalPvDefinition
]);
const policy = createPvBatterySelfConsumptionPolicy({
  batteryComponentId: "battery",
  balancingComponentId: "grid"
});
const variantsByCase = {
  baseline: null,
  doublePv: doublePvVariant,
  doubleBatteryCapacity: doubleBatteryCapacityVariant
};

function applyVariant(baseModel, variant) {
  const variedModel = structuredClone(baseModel);
  for (const override of variant?.parameterOverrides ?? []) {
    const component = variedModel.components.find(
      (candidate) => candidate.id === override.componentId
    );
    component.parameters[override.parameter] = override.value;
  }
  return variedModel;
}

function componentAtStep(step, componentId) {
  return step.components.find((component) => component.componentId === componentId);
}

function powerSeries(runResult) {
  const series = {
    "solar supply": [],
    "from battery": [],
    "grid supply": [],
    load: [],
    "to battery": [],
    "grid export": []
  };

  for (const step of runResult.results.steps) {
    const grid = componentAtStep(step, "grid");
    const pv = componentAtStep(step, "pv");
    const load = componentAtStep(step, "load");
    const battery = componentAtStep(step, "battery");
    series["solar supply"].push(pv.outputs.powerkW);
    series["from battery"].push(battery.outputs.dischargePowerkW);
    series["grid supply"].push(grid.outputs.importPowerkW);
    series.load.push(load.outputs.suppliedPowerkW);
    series["to battery"].push(battery.outputs.chargePowerkW);
    series["grid export"].push(grid.outputs.exportPowerkW);
  }

  return series;
}

function summariseRun(runResult) {
  const checkpointStepIndices = expectedResults.numericContract.checkpointStepIndices;
  const series = powerSeries(runResult);
  const seriesSummary = Object.fromEntries(
    Object.entries(series).map(([name, values]) => [name, {
      minimumkW: Math.min(...values),
      maximumkW: Math.max(...values),
      integratedEnergykWh: integrateStepPowerkWh(
        values,
        runResult.results.time.timeStepSeconds
      ),
      checkpointskW: checkpointStepIndices.map((stepIndex) => values[stepIndex])
    }])
  );
  const finalStep = runResult.results.steps.at(-1);
  const maximumPowerBalanceErrorkW = Math.max(
    ...runResult.results.steps.map((step) => Math.abs(
      componentAtStep(step, "bus").outputs.powerBalanceErrorkW
    ))
  );

  return {
    series: seriesSummary,
    finalBatteryStoredEnergykWh:
      componentAtStep(finalStep, "battery").state.storedEnergykWh,
    maximumPowerBalanceErrorkW
  };
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const runsByCase = Object.fromEntries(
  Object.entries(variantsByCase).map(([caseName, variant]) => [
    caseName,
    runScenario({
      model: applyVariant(model, variant),
      scenario,
      policy,
      registry
    })
  ])
);
const summariesByCase = Object.fromEntries(
  Object.entries(runsByCase).map(([caseName, runResult]) => [
    caseName,
    runResult.completed ? summariseRun(runResult) : null
  ])
);

test("ported blog example documents are valid and use stable references", () => {
  assert.equal(validateModel(model, { registry }).valid, true);
  assert.equal(validateScenario(scenario).valid, true);
  assert.equal(validateLayout(layout, { model }).valid, true);
  assert.equal(validateVariant(doublePvVariant, { model, registry }).valid, true);
  assert.equal(
    validateVariant(doubleBatteryCapacityVariant, { model, registry }).valid,
    true
  );
  assert.deepEqual(
    model.components.map((component) => component.id),
    ["grid", "bus", "pv", "load", "battery"]
  );
  assert.equal(layout.components.length, model.components.length);
  assert.deepEqual(runsByCase.baseline.results.steps[0].resolutionPlan.stages, [
    ["pv", "load", "battery"],
    ["bus"],
    ["grid"]
  ]);
});

test("ported scenario preserves every legacy profile sample in kilowatts", () => {
  const legacyLoad = legacyModel.nodes.find((node) => node.name === "Load")
    .sockets[0].state.timeSeries;
  const legacyPv = legacyModel.nodes.find((node) => node.name === "Solar PV")
    .sockets[0].state.timeSeries;
  const demand = scenario.series.find((series) => series.id === "electrical-demand")
    .data.values;
  const generation = scenario.series.find(
    (series) => series.id === "solar-generation"
  ).data.values;

  assert.equal(demand.length, 1440);
  assert.equal(generation.length, 1440);
  assert.deepEqual(demand, legacyLoad.map((powerW) => powerW / 1000));
  assert.deepEqual(generation, legacyPv.map((powerW) => powerW / 1000));
});

test("new runtime preserves legacy extrema and checkpoint powers", () => {
  for (const [caseName, runResult] of Object.entries(runsByCase)) {
    assert.equal(runResult.completed, true, JSON.stringify(runResult.diagnostics));
    const summary = summariesByCase[caseName];
    const legacyCase = legacyExpectedResults.cases[caseName];

    for (const [seriesName, legacySeries] of Object.entries(legacyCase.series)) {
      const actualSeries = summary.series[seriesName];
      assertClose(actualSeries.minimumkW, legacySeries.minimumW / 1000);
      assertClose(actualSeries.maximumkW, legacySeries.maximumW / 1000);
      actualSeries.checkpointskW.forEach((actualPowerkW, checkpointIndex) => {
        assertClose(
          actualPowerkW,
          legacySeries.checkpointsW[checkpointIndex] / 1000
        );
      });
    }
  }
});

test("corrected battery boundaries match reviewed daily-energy results", () => {
  for (const [caseName, expectedCase] of Object.entries(expectedResults.cases)) {
    const summary = summariesByCase[caseName];
    const legacyCase = legacyExpectedResults.cases[caseName];

    for (const [seriesName, expectedEnergykWh] of Object.entries(
      expectedCase.integratedEnergykWh
    )) {
      assertClose(
        summary.series[seriesName].integratedEnergykWh,
        expectedEnergykWh
      );
    }
    assert.equal(summary.finalBatteryStoredEnergykWh, 0);
    assert.ok(legacyCase.finalBatteryChargeKwh < 0);
    assertClose(
      summary.maximumPowerBalanceErrorkW,
      expectedCase.maximumPowerBalanceErrorkW,
      1e-15
    );
    assert.ok(summary.maximumPowerBalanceErrorkW < 1e-12);

    const supplyEnergykWh =
      summary.series["solar supply"].integratedEnergykWh +
      summary.series["from battery"].integratedEnergykWh +
      summary.series["grid supply"].integratedEnergykWh;
    const demandEnergykWh =
      summary.series.load.integratedEnergykWh +
      summary.series["to battery"].integratedEnergykWh +
      summary.series["grid export"].integratedEnergykWh;
    assertClose(supplyEnergykWh, demandEnergykWh);
  }
});
