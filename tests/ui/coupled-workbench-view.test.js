import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
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
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../../src/core/flow-types.js";
import { createHeatDemandFollowingPolicy } from
  "../../src/policies/heat-demand-following.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createResultsChartModel } from "../../src/ui/results-chart-model.js";
import { createCoupledThermalRunKpis } from "../../src/ui/run-kpi-model.js";
import {
  createInspectorDiagnosticViews,
  createWorkbenchView
} from "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL("../../examples/coupled-thermal/", import.meta.url);

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
  ambientBoundaryDefinition,
  electricHeaterDefinition,
  heatDemandDefinition,
  hotWaterStoreDefinition
]);
const run = runScenario({
  model,
  scenario,
  registry,
  policy: createHeatDemandFollowingPolicy({
    heaterComponentId: "heater",
    demandComponentId: "heat-demand",
    balancingComponentId: "grid"
  })
});

test("coupled chart includes electrical and thermal connection flows", () => {
  assert.equal(run.completed, true, JSON.stringify(run.diagnostics));
  const chart = createResultsChartModel({ model, registry, results: run.results });

  assert.deepEqual(
    chart.series.map((series) => series.id),
    [
      "grid-to-heater:forward",
      "heater-to-store:forward",
      "store-to-demand:forward",
      "store-to-ambient:forward"
    ]
  );
  assert.deepEqual(
    chart.series.map((series) => series.flowType),
    [
      ACTIVE_POWER_FLOW_TYPE,
      THERMAL_HEAT_FLOW_TYPE,
      THERMAL_HEAT_FLOW_TYPE,
      THERMAL_HEAT_FLOW_TYPE
    ]
  );

  const heaterHeat = chart.series.find(
    (series) => series.id === "heater-to-store:forward"
  );
  assert.deepEqual(
    heaterHeat.values.map((point) => point.powerkW),
    run.results.steps.map((step) => step.connections.find(
      (connection) => connection.connectionId === "heater-to-store"
    ).flow.heatFlowkW).map((heatFlowkW) => Math.max(0, heatFlowkW))
  );

  assert.equal(chart.temperatureSeries.length, 1);
  const [storeTemperature] = chart.temperatureSeries;
  assert.equal(storeTemperature.id, "store:temperature");
  assert.equal(storeTemperature.label, "Hot-water store temperature");
  assert.equal(storeTemperature.thresholdC, 70);
  assert.equal(storeTemperature.values.length, 13);
  assert.deepEqual(
    storeTemperature.values[0],
    { stepIndex: -1, elapsedSeconds: 0, temperatureC: 80 }
  );
  assert.deepEqual(
    storeTemperature.values.slice(1).map((point) => point.elapsedSeconds),
    Array.from({ length: 12 }, (_, index) => (index + 1) * 1800)
  );
  assert.deepEqual(
    storeTemperature.values.slice(1).map((point) => point.temperatureC),
    expectedResults.series.storeTemperatureC
  );
});

test("coupled topology and inspector expose the important thermal results", () => {
  const stepIndex = 4;
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex
  });
  const runtimeStep = run.results.steps[stepIndex];
  const store = view.components.find((component) => component.id === "store");
  const demand = view.components.find((component) => component.id === "heat-demand");
  const runtimeStore = runtimeStep.components.find(
    (component) => component.componentId === "store"
  );
  const runtimeDemand = runtimeStep.components.find(
    (component) => component.componentId === "heat-demand"
  );

  assert.equal(store.metric.value, runtimeStore.outputs.temperatureC);
  assert.equal(store.metric.unit, "°C");
  assert.equal(demand.metric.value, runtimeDemand.outputs.unmetHeatFlowkW);
  assert.equal(
    demand.outputFields.find((field) => field.id === "servedHeatFlowkW").value,
    runtimeDemand.outputs.servedHeatFlowkW
  );
  assert.equal(
    demand.outputFields.find((field) => field.id === "unmetHeatFlowkW").value,
    runtimeDemand.outputs.unmetHeatFlowkW
  );
  assert.deepEqual(
    view.connections
      .filter((connection) => connection.flowType === THERMAL_HEAT_FLOW_TYPE)
      .map((connection) => connection.signedFlow),
    runtimeStep.connections
      .filter((connection) => connection.flowType === THERMAL_HEAT_FLOW_TYPE)
      .map((connection) => connection.flow.heatFlowkW)
  );
});

test("inspector warnings are scoped and explain the selected timestep", () => {
  const stepIndex = 4;
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex
  });
  const heater = view.components.find((component) => component.id === "heater");
  const demand = view.components.find((component) => component.id === "heat-demand");

  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: run.diagnostics,
    stepIndex,
    component: heater
  }), []);
  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: run.diagnostics,
    stepIndex,
    component: demand
  }), [{
    severity: "warning",
    code: "thermal.heat-demand.unmet-heat",
    title: "Unmet heat demand",
    message: "30 kW unmet · 120 kW served of 150 kW requested"
  }]);
  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: run.diagnostics,
    stepIndex: 3,
    component: demand
  }), []);
});

test("coupled KPIs use the fixed-timestep engineering totals", () => {
  const kpis = Object.fromEntries(createCoupledThermalRunKpis(run.results).map(
    (kpi) => [kpi.id, kpi]
  ));
  const expected = expectedResults.summary;

  assert.equal(kpis["grid-import-energy"].value, expected.totalGridImportEnergykWh);
  assert.equal(kpis["heat-demand-energy"].value, expected.totalDemandEnergykWh);
  assert.equal(kpis["served-heat-energy"].value, expected.totalServedHeatEnergykWh);
  assert.equal(kpis["unmet-heat-energy"].value, expected.totalUnmetHeatEnergykWh);
  assert.equal(
    kpis["minimum-store-temperature"].value,
    Math.min(...expectedResults.series.storeTemperatureC)
  );
  assert.equal(kpis["final-store-temperature"].value, expected.finalStoreTemperatureC);
  assert.equal(kpis["unmet-heat-energy"].tone, "warning");
  assert.equal(kpis["unmet-heat-energy"].displayValue, "55.09 kWh");
});
