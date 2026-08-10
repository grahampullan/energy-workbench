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
  batteryComponentId: "battery"
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
    series["solar supply"].push(pv.outputs.powerKw);
    series["from battery"].push(battery.outputs.dischargePowerKw);
    series["grid supply"].push(grid.outputs.importPowerKw);
    series.load.push(load.outputs.suppliedPowerKw);
    series["to battery"].push(battery.outputs.chargePowerKw);
    series["grid export"].push(grid.outputs.exportPowerKw);
  }

  return series;
}

function integratePowerKwh(values, timeStepSeconds) {
  const durationHours = timeStepSeconds / 3600;
  let energyKwh = 0;
  for (let index = 1; index < values.length; index += 1) {
    energyKwh += (values[index - 1] + values[index]) / 2 * durationHours;
  }
  return energyKwh;
}

function summariseRun(runResult) {
  const checkpointStepIndices = expectedResults.numericContract.checkpointStepIndices;
  const series = powerSeries(runResult);
  const seriesSummary = Object.fromEntries(
    Object.entries(series).map(([name, values]) => [name, {
      minimumKw: Math.min(...values),
      maximumKw: Math.max(...values),
      integratedEnergyKwh: integratePowerKwh(
        values,
        runResult.results.time.timeStepSeconds
      ),
      checkpointsKw: checkpointStepIndices.map((stepIndex) => values[stepIndex])
    }])
  );
  const finalStep = runResult.results.steps.at(-1);
  const maximumBalanceResidualKw = Math.max(
    ...runResult.results.steps.map((step) => Math.abs(
      componentAtStep(step, "bus").outputs.balanceResidualPowerKw
    ))
  );

  return {
    series: seriesSummary,
    finalBatteryStoredEnergyKwh:
      componentAtStep(finalStep, "battery").state.storedEnergyKwh,
    maximumBalanceResidualKw
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
      assertClose(actualSeries.minimumKw, legacySeries.minimumW / 1000);
      assertClose(actualSeries.maximumKw, legacySeries.maximumW / 1000);
      actualSeries.checkpointsKw.forEach((actualPowerKw, checkpointIndex) => {
        assertClose(
          actualPowerKw,
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

    for (const [seriesName, expectedEnergyKwh] of Object.entries(
      expectedCase.integratedEnergyKwh
    )) {
      assertClose(
        summary.series[seriesName].integratedEnergyKwh,
        expectedEnergyKwh
      );
    }
    assert.equal(summary.finalBatteryStoredEnergyKwh, 0);
    assert.ok(legacyCase.finalBatteryChargeKwh < 0);
    assertClose(
      summary.maximumBalanceResidualKw,
      expectedCase.maximumBalanceResidualKw,
      1e-15
    );
    assert.ok(summary.maximumBalanceResidualKw < 1e-12);

    const supplyEnergyKwh =
      summary.series["solar supply"].integratedEnergyKwh +
      summary.series["from battery"].integratedEnergyKwh +
      summary.series["grid supply"].integratedEnergyKwh;
    const demandEnergyKwh =
      summary.series.load.integratedEnergyKwh +
      summary.series["to battery"].integratedEnergyKwh +
      summary.series["grid export"].integratedEnergyKwh;
    assertClose(supplyEnergyKwh, demandEnergyKwh);
  }
});
