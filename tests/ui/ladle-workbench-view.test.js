import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { materialSinkDefinition } from
  "../../src/components/material/sink.js";
import { materialSourceDefinition } from
  "../../src/components/material/source.js";
import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { fuelBurnerDefinition } from
  "../../src/components/thermal/fuel-burner.js";
import { heatTransferDefinition } from
  "../../src/components/thermal/heat-transfer.js";
import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { MATERIAL_MASS_FLOW_TYPE } from "../../src/core/flow-types.js";
import { validateLayout } from
  "../../src/core/validation/validate-documents.js";
import { createLadleCyclePolicy } from
  "../../src/policies/ladle-cycle.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createResultsChartModel } from
  "../../src/ui/results-chart-model.js";
import { createConnectionColourScale } from
  "../../src/ui/connection-colours.js";
import { resultsFlowSeries, resultsSeriesIsEmphasised } from
  "../../src/ui/results-chart.js";
import { createLadleRunKpis } from "../../src/ui/run-kpi-model.js";
import {
  createInspectorDiagnosticViews,
  createWorkbenchView
} from
  "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL(
  "../../examples/ladle-cycle-synthetic/",
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
  materialSinkDefinition,
  materialSourceDefinition,
  constantTemperatureDefinition,
  fuelBurnerDefinition,
  heatTransferDefinition,
  thermalStoreDefinition
]);

function run(strategy, modelDocument = model) {
  return runScenario({
    model: modelDocument,
    scenario,
    registry,
    policy: createLadleCyclePolicy({
      burnerComponentId: "burner",
      refractoryComponentId: "refractory",
      inventoryComponentId: "metal",
      modeSeriesId: "process-mode",
      historicalHeatOutputSeriesId: "historical-burner-output",
      outflowSeriesId: "material-outflow",
      strategy,
      operatingMarginK: 10
    })
  });
}

const historical = run("historical");
const improved = run("minimum-fuel");

function kpisById(results) {
  return Object.fromEntries(createLadleRunKpis(results).map(
    (candidate) => [candidate.id, candidate]
  ));
}

test("ladle charts separate energy rates, material flows, and temperatures", () => {
  assert.equal(historical.completed, true, JSON.stringify(historical.diagnostics));
  assert.equal(validateLayout(layout, { model }).valid, true);
  const chart = createResultsChartModel({
    model,
    registry,
    results: historical.results,
    scenario
  });

  assert.deepEqual(chart.series.map(({ id }) => id), [
    "burner-to-refractory:forward",
    "contact-to-refractory:forward",
    "refractory-loss-to-ambient:forward",
    "metal-loss-to-ambient:forward"
  ]);
  assert.deepEqual(chart.materialSeries.map(({ id }) => id), [
    "source-to-metal:mass-forward",
    "metal-to-sink:mass-forward"
  ]);
  assert.ok(chart.materialSeries.every(({ flowType }) =>
    flowType === MATERIAL_MASS_FLOW_TYPE
  ));
  assert.deepEqual(chart.temperatureSeries.map(({ id }) => id), [
    "refractory:temperature",
    "metal:temperature"
  ]);
  assert.deepEqual(chart.prescribedPowerSeries.map(({ id }) => id), [
    "scenario:historical-burner-output"
  ]);
  assert.deepEqual(chart.prescribedMassSeries.map(({ id }) => id), [
    "scenario:material-inflow",
    "scenario:material-outflow"
  ]);
  assert.deepEqual(chart.prescribedTemperatureSeries.map(({ id }) => id), [
    "scenario:ambient-temperature"
  ]);
});

test("hover reveals omitted heat-transfer inlets using their own flow and colour", () => {
  const chart = createResultsChartModel({
    model,
    registry,
    results: historical.results,
    scenario
  });
  const colours = createConnectionColourScale(model.connections.map(({ id }) => id));
  assert.equal(resultsFlowSeries(chart).length, 4);

  for (const [inletId, outletId] of [
    ["metal-to-contact", "contact-to-refractory"],
    ["refractory-to-loss", "refractory-loss-to-ambient"],
    ["metal-to-loss", "metal-loss-to-ambient"]
  ]) {
    const hovered = resultsFlowSeries(chart, inletId);
    const highlighted = hovered.filter((series) => resultsSeriesIsEmphasised(
      series, "refractory", inletId, null
    ));
    assert.equal(hovered.length, 5);
    assert.equal(highlighted.length, 1);
    const [inlet] = highlighted;
    const outlet = chart.series.find(({ connectionId }) => connectionId === outletId);
    assert.equal(inlet.connectionId, inletId);
    assert.equal(inlet.colour, colours.colourFor(inletId));
    assert.notEqual(inlet.colour, outlet.colour);
    assert.deepEqual(inlet.values.map(({ powerkW }) => powerkW),
      historical.results.steps.map((step) => step.connections.find(
        ({ connectionId }) => connectionId === inletId
      ).flow.heatFlowkW)
    );
    assert.deepEqual(inlet.values, outlet.values);
    assert.equal(inlet.integratedEnergykWh, outlet.integratedEnergykWh);
    assert.equal(resultsFlowSeries(chart, outletId).length, 4);
  }

  const contact = resultsFlowSeries(chart, "metal-to-contact").find(
    ({ connectionId }) => connectionId === "metal-to-contact"
  );
  assert.equal(contact.values[0].powerkW, 0);
  assert.ok(contact.values[95].powerkW > 0);
  assert.equal(resultsFlowSeries(chart, null), chart.series);
});

test("ladle topology cards expose the selected-timestep engineering state", () => {
  const stepIndex = 95;
  const view = createWorkbenchView({
    model,
    registry,
    results: historical.results,
    stepIndex
  });
  const runtimeStep = historical.results.steps[stepIndex];
  const output = (componentId) => runtimeStep.components.find(
    ({ componentId: candidate }) => candidate === componentId
  ).outputs;
  const component = (componentId) => view.components.find(
    ({ id }) => id === componentId
  );

  assert.equal(
    component("refractory").metric.value,
    output("refractory").temperatureC
  );
  assert.equal(component("refractory").metric.unit, "°C");
  assert.equal(component("metal").metric.value, output("metal").temperatureC);
  assert.equal(component("metal").outputFields.find(
    ({ id }) => id === "containedMassKg"
  ).value, output("metal").containedMassKg);
  assert.equal(component("burner").definitionName, "Fuel burner");
  assert.equal(component("ambient").definitionName, "Constant temperature");
  assert.equal(component("ambient").name, "Ambient");
});

test("ladle KPIs reproduce the reviewed policy comparison", () => {
  const historicalKpis = kpisById(historical.results);
  const improvedKpis = kpisById(improved.results);
  const historicalExpected = expectedResults.policies.historical.summary;
  const improvedExpected = expectedResults.policies["minimum-fuel"].summary;

  assert.equal(
    historicalKpis["ladle-fuel-input"].value,
    historicalExpected.fuelInputEnergykWh
  );
  assert.equal(
    improvedKpis["ladle-fuel-input"].value,
    improvedExpected.fuelInputEnergykWh
  );
  assert.equal(
    improvedKpis["ladle-direct-emissions"].value,
    improvedExpected.directEmissionsKgCO2
  );
  assert.equal(
    improvedKpis["ladle-material-out"].value,
    improvedExpected.totalMassOutKg
  );
  assert.equal(
    improvedKpis["ladle-minimum-tap-temperature"].value,
    improvedExpected.minimumTapTemperatureC
  );
  assert.equal(
    improvedKpis["ladle-delivery-margin"].value,
    improvedExpected.minimumTapTemperatureMarginK
  );
  assert.equal(improvedKpis["ladle-delivery-margin"].tone, "neutral");
  assert.ok(improvedKpis["ladle-fuel-input"].value <
    historicalKpis["ladle-fuel-input"].value);
});

test("ladle inspector explains a delivery-temperature violation", () => {
  const constrainedModel = structuredClone(model);
  constrainedModel.components.find(({ id }) => id === "metal")
    .parameters.minimumUsefulTemperatureC = 1590;
  const constrainedRun = run("historical", constrainedModel);
  const stepIndex = 90;
  const view = createWorkbenchView({
    model: constrainedModel,
    registry,
    results: constrainedRun.results,
    stepIndex
  });
  const metal = view.components.find(({ id }) => id === "metal");

  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: constrainedRun.diagnostics,
    stepIndex,
    component: metal
  }), [{
    severity: "warning",
    code: "thermal.store.material-delivery-temperature",
    title: "Material delivery temperature missed",
    message: "1,534 °C delivered · 55.6 K below requirement"
  }]);
});

test("reduced inflow exposes requested, actual, and unmet discharge in the UI", () => {
  const reducedModel = structuredClone(model);
  reducedModel.components.find(({ id }) => id === "material-source")
    .parameters.profileMultiplier = 0.8;
  const reduced = run("historical", reducedModel);
  assert.equal(reduced.completed, true, JSON.stringify(reduced.diagnostics));
  const kpis = kpisById(reduced.results);
  assert.equal(kpis["ladle-material-requested"].value, 5700);
  assert.equal(kpis["ladle-material-out"].value, 4800);
  assert.equal(kpis["ladle-material-unmet"].value, 900);
  assert.equal(kpis["ladle-material-unmet"].tone, "warning");
  assert.ok(kpis["ladle-minimum-tap-temperature"].value > 0);

  const stepIndex = 99;
  const view = createWorkbenchView({
    model: reducedModel, registry, results: reduced.results, stepIndex
  });
  const metal = view.components.find(({ id }) => id === "metal");
  assert.deepEqual(metal.operationFields, [
    { label: "Requested discharge", value: 9.5, unit: "kg/s", displayValue: "9.5 kg/s" },
    { label: "Actual discharge", value: 0, unit: "kg/s", displayValue: "0 kg/s" },
    { label: "Unmet discharge", value: 9.5, unit: "kg/s", displayValue: "9.5 kg/s" }
  ]);
  assert.deepEqual(createInspectorDiagnosticViews({
    diagnostics: reduced.diagnostics, stepIndex, component: metal
  }), [{
    severity: "warning",
    code: "ui.unmet-material-discharge",
    title: "Unmet discharge",
    message: "9.5 kg/s unmet · 0 kg/s actual of 9.5 kg/s requested"
  }]);
  const source = view.components.find(({ id }) => id === "material-source");
  const multiplier = source.parameterGroups.flatMap(({ fields }) => fields)
    .find(({ id }) => id === "profileMultiplier");
  assert.equal(multiplier.value, 0.8);
  assert.equal(multiplier.label, "Inflow profile multiplier");
});

test("zero inflow reports the full discharge shortfall and no delivery temperature", () => {
  const emptyModel = structuredClone(model);
  emptyModel.components.find(({ id }) => id === "material-source")
    .parameters.profileMultiplier = 0;
  const empty = run("historical", emptyModel);
  assert.equal(empty.completed, true, JSON.stringify(empty.diagnostics));
  const kpis = kpisById(empty.results);
  assert.equal(kpis["ladle-material-requested"].value, 5700);
  assert.equal(kpis["ladle-material-out"].value, 0);
  assert.equal(kpis["ladle-material-unmet"].value, 5700);
  for (const id of ["ladle-minimum-tap-temperature", "ladle-delivery-margin"]) {
    assert.equal(kpis[id].value, null);
    assert.equal(kpis[id].displayValue, "—");
  }
});
