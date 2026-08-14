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
import {
  createInspectorDiagnosticViews,
  createWorkbenchView
} from "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL("../../examples/coupled-thermal/", import.meta.url);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [model, scenario] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json")
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
