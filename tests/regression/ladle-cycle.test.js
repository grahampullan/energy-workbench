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
import { createComponentRegistry } from "../helpers/registry.js";
import { materialDischarge } from "../../src/core/material-discharge.js";
import { integrateStepPowerkWh } from
  "../../src/core/energy-integration.js";
import {
  validateLayout,
  validateModel,
  validateScenario
} from "../../src/core/validation/validate-documents.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

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

const temperatureModel = await readExampleJson("model-temperature-led.json");
function run(strategy, scenarioDocument = scenario, modelDocument = model) {
  const configured = structuredClone(modelDocument);
  if (strategy === "minimum-fuel") {
    configured.components.find(({ id }) => id === "burner").policy = temperatureModel.components.find(({ id }) => id === "burner").policy;
    configured.informationConnections = temperatureModel.informationConnections;
    configured.informationSources = temperatureModel.informationSources;
  }
  return runScenario({ model: configured, scenario: scenarioDocument, registry });
}

function componentAtStep(step, componentId) {
  return step.components.find(({ componentId: id }) => id === componentId);
}

function outputSeries(result, componentId, field) {
  return result.results.steps.map(
    (step) => componentAtStep(step, componentId).outputs[field]
  );
}

function integrate(result, componentId, field) {
  return integrateStepPowerkWh(
    outputSeries(result, componentId, field),
    result.results.time.timeStepSeconds
  );
}

function integrateMass(result, field) {
  return outputSeries(result, "metal", field).reduce(
    (total, value) => total + value * result.results.time.timeStepSeconds,
    0
  );
}

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function assertReviewedResult(strategy) {
  const result = run(strategy);
  const expected = expectedResults.policies[strategy];
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.results.time.timeStepSeconds,
    expectedResults.numericContract.timeStepSeconds
  );
  assert.equal(result.results.steps.length, expectedResults.numericContract.stepCount);

  for (const checkpoint of expected.checkpoints) {
    const step = result.results.steps[checkpoint.stepIndex];
    const refractory = componentAtStep(step, "refractory").outputs;
    const metal = componentAtStep(step, "metal").outputs;
    const burner = componentAtStep(step, "burner").outputs;
    assertClose(refractory.temperatureC, checkpoint.refractoryTemperatureC);
    assertClose(metal.containedMassKg, checkpoint.metalMassKg);
    assertClose(metal.temperatureC, checkpoint.metalTemperatureC);
    assertClose(burner.heatOutputkW, checkpoint.burnerHeatOutputkW);
  }
  return result;
}

test("synthetic ladle documents are valid and expose the checked dependency order", () => {
  assert.equal(validateModel(model, { registry }).valid, true);
  assert.equal(validateScenario(scenario).valid, true);
  assert.equal(validateLayout(layout, { model }).valid, true);
  const result = run("historical");
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.results.steps[0].resolutionPlan.stages, [
    [
      "material-source",
      "metal-refractory-contact",
      "refractory-loss",
      "metal-loss"
    ],
    ["refractory", "metal", "ambient"],
    ["burner", "material-sink"]
  ]);
});

test("historical ladle cycle matches the reviewed synthetic fixture", () => {
  assertReviewedResult("historical");
});

test("historical heating and discharge follow their schedules independently of process-mode labels", () => {
  const relabelled = structuredClone(scenario);
  relabelled.series.find(({ id }) => id === "process-mode").data.values.fill(0);
  const result = run("historical", relabelled);
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.results.steps, run("historical").results.steps);
});

test("reduced and zero inflow report an unmet tapping request without losing mass or enthalpy", () => {
  for (const strategy of ["historical", "minimum-fuel"]) {
    for (const multiplier of [0, 0.05, 0.2, 0.8, 0.95, 1]) {
      const candidate = structuredClone(model);
      candidate.components.find(({ id }) => id === "material-source")
        .parameters.profileMultiplier = multiplier;
      const result = run(strategy, scenario, candidate);
      assert.equal(result.completed, true,
        `${strategy} ${multiplier}: ${JSON.stringify(result.diagnostics)}`);
      const requestedKg = result.results.steps.reduce((total, step) => total +
        materialDischarge(componentAtStep(step, "metal")).requestedKgPerSecond * 60, 0);
      const unmetKg = result.results.steps.reduce((total, step) => total +
        materialDischarge(componentAtStep(step, "metal")).unmetKgPerSecond * 60, 0);
      const actualKg = integrateMass(result, "massOutflowKgPerSecond");
      assertClose(requestedKg, 5700);
      assertClose(actualKg, Math.min(6000 * multiplier, 5700));
      assertClose(unmetKg, Math.max(0, 5700 - 6000 * multiplier));
      for (let index = 0; index < result.results.steps.length; index += 1) {
        const metal = componentAtStep(result.results.steps[index], "metal");
        const previous = index === 0
          ? result.results.initialStates.find(({ componentId }) => componentId === "metal").state
          : componentAtStep(result.results.steps[index - 1], "metal").state;
        assertClose(metal.state.massKg, previous.massKg + 60 *
          (metal.outputs.massInflowKgPerSecond - metal.outputs.massOutflowKgPerSecond));
        assertClose(metal.state.containedEnthalpykWh,
          previous.containedEnthalpykWh + metal.outputs.netEnergyFlowkW / 60);
        assert.ok(metal.state.massKg >= 0);
        if (metal.state.massKg === 0) {
          assert.equal(metal.state.containedEnthalpykWh, 0);
        }
      }
    }
  }
});

test("minimum-fuel ladle cycle matches the reviewed synthetic fixture", () => {
  assertReviewedResult("minimum-fuel");
});

test("ladle cycle conserves system mass and enthalpy", () => {
  const result = run("historical");
  const totalMassInKg = integrateMass(result, "massInflowKgPerSecond");
  const totalMassOutKg = integrateMass(result, "massOutflowKgPerSecond");
  const finalStep = result.results.steps.at(-1);
  const finalMetal = componentAtStep(finalStep, "metal").outputs;
  const finalRefractory = componentAtStep(finalStep, "refractory").outputs;
  const initialEnthalpykWh = result.results.initialStates.reduce(
    (total, entry) => total + (entry.state.containedEnthalpykWh ?? 0),
    0
  );
  const finalEnthalpykWh =
    finalMetal.containedEnthalpykWh + finalRefractory.containedEnthalpykWh;
  const externalEnergyInKWh =
    integrate(result, "metal", "enthalpyInflowkW") +
    integrate(result, "burner", "heatOutputkW");
  const externalEnergyOutKWh =
    integrate(result, "metal", "enthalpyOutflowkW") +
    integrate(result, "refractory-loss", "heatFlowkW") +
    integrate(result, "metal-loss", "heatFlowkW");

  assertClose(totalMassInKg - totalMassOutKg, finalMetal.containedMassKg);
  assertClose(
    initialEnthalpykWh + externalEnergyInKWh - externalEnergyOutKWh,
    finalEnthalpykWh
  );
  assertClose(
    integrate(result, "burner", "fuelInputPowerkW") * 0.6,
    integrate(result, "burner", "heatOutputkW")
  );
});

test("minimum-fuel policy reduces fuel while preserving tap temperature", () => {
  const historical = run("historical");
  const improved = run("minimum-fuel");
  const historicalFuel = integrate(historical, "burner", "fuelInputPowerkW");
  const improvedFuel = integrate(improved, "burner", "fuelInputPowerkW");
  const tapTemperatures = outputSeries(improved, "metal", "materialOutflowTemperatureC")
    .filter((value, stepIndex) =>
      componentAtStep(
        improved.results.steps[stepIndex],
        "metal"
      ).outputs.massOutflowKgPerSecond > 0
    );

  assert.ok(improvedFuel < historicalFuel);
  assert.ok(Math.min(...tapTemperatures) > 1450);
  assert.ok(
    componentAtStep(improved.results.steps[39], "refractory")
      .outputs.temperatureC > 800
  );
});

test("ladle cycle reports material delivered below its temperature requirement", () => {
  const constrainedModel = structuredClone(model);
  constrainedModel.components.find(({ id }) => id === "metal")
    .parameters.minimumUsefulTemperatureC = 1590;
  const result = run("historical", scenario, constrainedModel);

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some(({ code, path }) =>
    code === "thermal.store.material-delivery-temperature" &&
    path.startsWith("/steps/90/components/metal")
  ));
});

test("ladle result converges under aligned timestep refinement", () => {
  function refinedScenario(factor) {
    const refined = structuredClone(scenario);
    refined.time.timeStepSeconds /= factor;
    refined.time.stepCount *= factor;
    for (const series of refined.series) {
      series.data.values = series.data.values.flatMap(
        (value) => Array.from({ length: factor }, () => value)
      );
    }
    return refined;
  }

  const coarse = run("minimum-fuel");
  const medium = run("minimum-fuel", refinedScenario(2));
  const fine = run("minimum-fuel", refinedScenario(4));
  const deliveredTemperature = (result, stepIndex) =>
    componentAtStep(result.results.steps[stepIndex], "metal")
      .outputs.materialOutflowTemperatureC;
  const coarseTemperatureC = deliveredTemperature(coarse, 99);
  const mediumTemperatureC = deliveredTemperature(medium, 199);
  const fineTemperatureC = deliveredTemperature(fine, 399);

  assert.ok(Math.abs(fineTemperatureC - mediumTemperatureC) <
    Math.abs(mediumTemperatureC - coarseTemperatureC));
  assert.ok([coarseTemperatureC, mediumTemperatureC, fineTemperatureC]
    .every((temperatureC) => temperatureC > 1450));
});
