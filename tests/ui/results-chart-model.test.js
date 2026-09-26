import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalBatteryDefinition } from
  "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalPvDefinition } from "../../src/components/electrical/pv.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createResultsChartModel } from "../../src/ui/results-chart-model.js";
import { createElectricalRunKpis } from "../../src/ui/run-kpi-model.js";

const exampleDirectory = new URL("../../examples/blog-electrical/", import.meta.url);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [model, scenario, expectedResults] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json"),
  readExampleJson("expected-results.json")
]);
const registry = createComponentRegistry([
  electricalBatteryDefinition,
  electricalBusDefinition,
  electricalGridDefinition,
  electricalLoadDefinition,
  electricalPvDefinition
]);
const run = runScenario({
  model,
  scenario,
  registry,
});

test("chart model derives directional power series from canonical connection results", () => {
  assert.equal(run.completed, true, JSON.stringify(run.diagnostics));
  const chart = createResultsChartModel({
    model,
    registry,
    results: run.results,
    scenario
  });

  assert.equal(chart.stepCount, 1440);
  assert.equal(chart.timeStepSeconds, 60);
  assert.equal(chart.endElapsedSeconds, 86_400);
  assert.deepEqual(
    chart.series.map((series) => series.id),
    [
      "grid-to-bus:forward",
      "grid-to-bus:reverse",
      "pv-to-bus:forward",
      "bus-to-load:forward",
      "battery-to-bus:forward",
      "battery-to-bus:reverse"
    ]
  );
  assert.deepEqual(
    chart.series.map((series) => series.label),
    [
      "Grid → Electrical bus",
      "Electrical bus → Grid",
      "Solar PV → Electrical bus",
      "Electrical bus → Electrical load",
      "Battery → Electrical bus",
      "Electrical bus → Battery"
    ]
  );
  assert.equal(chart.series[0].colour, "#4e79a7");
  assert.equal(chart.series[1].colour, chart.series[0].colour);
  assert.equal(chart.series[2].colour, "#f28e2c");
  assert.ok(chart.series.every((series) =>
    series.values.every((point) => point.powerkW >= 0)
  ));
  assert.deepEqual(
    chart.prescribedPowerSeries.map((series) => series.id),
    ["scenario:electrical-demand", "scenario:solar-generation"]
  );
  assert.ok(chart.prescribedPowerSeries.every(
    (series) => series.kind === "prescribed"
  ));
  assert.deepEqual(chart.temperatureSeries, []);
  assert.deepEqual(chart.prescribedTemperatureSeries, []);
});

test("chart integration reproduces explicit-forward daily-energy results", () => {
  const chart = createResultsChartModel({ model, registry, results: run.results });
  const energyBySeriesId = Object.fromEntries(chart.series.map((series) => [
    series.id,
    series.integratedEnergykWh
  ]));
  const expected = expectedResults.cases.baseline.integratedEnergykWh;

  assert.ok(Math.abs(energyBySeriesId["pv-to-bus:forward"] - expected["solar supply"]) < 1e-12);
  assert.ok(Math.abs(energyBySeriesId["battery-to-bus:forward"] - expected["from battery"]) < 1e-12);
  assert.ok(Math.abs(energyBySeriesId["grid-to-bus:forward"] - expected["grid supply"]) < 1e-12);
  assert.ok(Math.abs(energyBySeriesId["bus-to-load:forward"] - expected.load) < 1e-12);
  assert.ok(Math.abs(energyBySeriesId["battery-to-bus:reverse"] - expected["to battery"]) < 1e-12);
  assert.ok(Math.abs(energyBySeriesId["grid-to-bus:reverse"] - expected["grid export"]) < 1e-12);
});

test("electrical KPIs reproduce the reviewed run totals", () => {
  const kpis = Object.fromEntries(createElectricalRunKpis(run.results).map(
    (kpi) => [kpi.id, kpi]
  ));
  const expected = expectedResults.cases.baseline.integratedEnergykWh;

  for (const [kpiId, expectedValue] of [
    ["load-energy", expected.load],
    ["solar-energy", expected["solar supply"]],
    ["grid-import-energy", expected["grid supply"]],
    ["grid-export-energy", expected["grid export"]],
    ["battery-charge-energy", expected["to battery"]],
    ["battery-discharge-energy", expected["from battery"]]
  ]) {
    assert.ok(Math.abs(kpis[kpiId].value - expectedValue) < 1e-12);
  }
  assert.equal(kpis["grid-import-energy"].displayValue, "7.357 kWh");
});

test("chart model rejects an incomplete connection result series", () => {
  const incompleteResults = structuredClone(run.results);
  incompleteResults.steps[4].connections = incompleteResults.steps[4].connections.filter(
    (connection) => connection.connectionId !== "pv-to-bus"
  );

  assert.throws(
    () => createResultsChartModel({ model, registry, results: incompleteResults }),
    /do not contain connection pv-to-bus at step 4/u
  );
});
