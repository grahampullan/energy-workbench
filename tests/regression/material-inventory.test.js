import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { materialSinkDefinition } from
  "../../src/components/material/sink.js";
import { materialSourceDefinition } from
  "../../src/components/material/source.js";
import { heatedMaterialInventoryDefinition } from
  "../../src/components/process/heated-material-inventory.js";
import { electricHeaterDefinition } from
  "../../src/components/thermal/electric-heater.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { integrateStepPowerkWh } from
  "../../src/core/energy-integration.js";
import {
  validateModel,
  validateScenario
} from "../../src/core/validation/validate-documents.js";
import { createScheduledMaterialInventoryPolicy } from
  "../../src/policies/scheduled-material-inventory.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

const exampleDirectory = new URL(
  "../../examples/material-inventory-synthetic/",
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
  materialSourceDefinition,
  electricalGridDefinition,
  electricHeaterDefinition,
  heatedMaterialInventoryDefinition,
  materialSinkDefinition
]);
const policy = createScheduledMaterialInventoryPolicy({
  heaterComponentId: "heater",
  powerSeriesId: "heater-input-power",
  inventoryComponentId: "inventory",
  outflowSeriesId: "material-outflow",
  balancingComponentId: "grid"
});

function run(runScenarioDocument = scenario) {
  return runScenario({ model, scenario: runScenarioDocument, policy, registry });
}

function componentAtStep(step, componentId) {
  return step.components.find(({ componentId: id }) => id === componentId);
}

function inventorySeries(result, field) {
  return result.results.steps.map(
    (step) => componentAtStep(step, "inventory").outputs[field]
  );
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("material-inventory example is valid and has a mixed-flow resolution plan", () => {
  assert.equal(validateModel(model, { registry }).valid, true);
  assert.equal(validateScenario(scenario).valid, true);
  const result = run();
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.results.steps[0].resolutionPlan.stages, [
    ["material-source"],
    ["inventory"],
    ["heater", "material-sink"],
    ["grid"]
  ]);
  assert.deepEqual(
    result.results.steps[0].connections.map(({ flowType }) => flowType),
    [
      "material.mass-flow",
      "electricity.active-power",
      "thermal.heat-flow",
      "material.mass-flow"
    ]
  );
});

test("fill, hold, heat, and empty results match the reviewed fixture", () => {
  const result = run();
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.equal(result.results.time.timeStepSeconds,
    expectedResults.numericContract.timeStepSeconds);
  assert.equal(result.results.steps.length,
    expectedResults.numericContract.stepCount);
  for (const checkpoint of expectedResults.checkpoints) {
    const outputs = componentAtStep(
      result.results.steps[checkpoint.stepIndex],
      "inventory"
    ).outputs;
    for (const field of [
      "containedMassKg",
      "containedEnthalpykWh",
      "temperatureC"
    ]) {
      assertClose(outputs[field], checkpoint[field]);
    }
  }
  assert.deepEqual(
    componentAtStep(result.results.steps.at(-1), "inventory").state,
    { massKg: 0, containedEnthalpykWh: 0 }
  );
});

test("material inventory limits outflow to start-of-step available mass", () => {
  const constrainedScenario = structuredClone(scenario);
  constrainedScenario.series.find(
    ({ id }) => id === "material-outflow"
  ).data.values[129] = 10;
  const result = run(constrainedScenario);
  const inventory = componentAtStep(result.results.steps[129], "inventory");

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.equal(inventory.feasibleCommand.massOutflowKgPerSecond, 1);
  assert.equal(
    inventory.actualCommand.materialOutFlow.massFlowKgPerSecond,
    1
  );
  assert.equal(inventory.outputs.massOutflowKgPerSecond, 1);
});

test("material inventory conserves mass and enthalpy without cumulative state", () => {
  const result = run();
  const outputs = result.results.steps.map(
    (step) => componentAtStep(step, "inventory").outputs
  );
  const durationSeconds = result.results.time.timeStepSeconds;
  const totalMassInKg = outputs.reduce(
    (total, output) => total + output.massInflowKgPerSecond * durationSeconds,
    0
  );
  const totalMassOutKg = outputs.reduce(
    (total, output) => total + output.massOutflowKgPerSecond * durationSeconds,
    0
  );
  const integrate = (field) => integrateStepPowerkWh(
    outputs.map((output) => output[field]),
    durationSeconds
  );
  const totalEnthalpyInKWh = integrate("enthalpyInflowkW");
  const totalHeatInputKWh = integrate("heatInputkW");
  const totalEnthalpyOutKWh = integrate("enthalpyOutflowkW");

  assert.equal(totalMassInKg, expectedResults.summary.totalMassInKg);
  assert.equal(totalMassOutKg, expectedResults.summary.totalMassOutKg);
  assertClose(totalEnthalpyInKWh, expectedResults.summary.totalEnthalpyInKWh);
  assertClose(totalHeatInputKWh, expectedResults.summary.totalHeatInputKWh);
  assertClose(totalEnthalpyOutKWh, expectedResults.summary.totalEnthalpyOutKWh);
  assertClose(totalMassInKg - totalMassOutKg, 0);
  assertClose(
    totalEnthalpyInKWh + totalHeatInputKWh - totalEnthalpyOutKWh,
    0
  );
  const initialInventoryState = result.results.initialStates.find(
    ({ componentId }) => componentId === "inventory"
  ).state;
  assert.deepEqual(Object.keys(initialInventoryState), [
    "massKg",
    "containedEnthalpykWh"
  ]);
});

test("material inventory is consistent under aligned timestep refinement", () => {
  const refinedScenario = structuredClone(scenario);
  refinedScenario.time.timeStepSeconds /= 2;
  refinedScenario.time.stepCount *= 2;
  for (const series of refinedScenario.series) {
    series.data.values = series.data.values.flatMap((value) => [value, value]);
  }
  const coarse = run();
  const refined = run(refinedScenario);
  assert.equal(refined.completed, true, JSON.stringify(refined.diagnostics));

  for (const field of ["containedMassKg", "containedEnthalpykWh", "temperatureC"]) {
    const coarseValues = inventorySeries(coarse, field);
    const refinedValues = inventorySeries(refined, field).filter(
      (value, index) => index % 2 === 1
    );
    refinedValues.forEach((value, index) =>
      assertClose(value, coarseValues[index])
    );
  }
});
