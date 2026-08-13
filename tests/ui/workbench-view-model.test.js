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
import { createPvBatterySelfConsumptionPolicy } from
  "../../src/policies/pv-battery-self-consumption.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import {
  createWorkbenchView,
  formatEngineeringValue,
  formatFieldLabel
} from "../../src/ui/workbench-view-model.js";

const exampleDirectory = new URL("../../examples/blog-electrical/", import.meta.url);

async function readExampleJson(filename) {
  return JSON.parse(await readFile(new URL(filename, exampleDirectory), "utf8"));
}

const [model, scenario] = await Promise.all([
  readExampleJson("model.json"),
  readExampleJson("scenario.json")
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
  policy: createPvBatterySelfConsumptionPolicy({
    batteryComponentId: "battery",
    balancingComponentId: "grid"
  })
});

test("browser presentation derives the selected timestep from canonical results", () => {
  assert.equal(run.completed, true, JSON.stringify(run.diagnostics));
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex: 720
  });
  const runtimeStep = run.results.steps[720];
  const runtimeBattery = runtimeStep.components.find(
    (component) => component.componentId === "battery"
  );
  const batteryView = view.components.find((component) => component.id === "battery");

  assert.equal(view.timelineLabel, "12:00 · step 721 of 1440");
  assert.equal(view.components.length, model.components.length);
  assert.equal(view.connections.length, model.connections.length);
  assert.equal(batteryView.metric.value, runtimeBattery.actualCommand.powerkW);
  assert.equal(
    batteryView.outputFields.find((field) => field.id === "storedEnergykWh").value,
    runtimeBattery.outputs.storedEnergykWh
  );
  assert.deepEqual(
    view.connections.map((connection) => connection.signedFlow),
    runtimeStep.connections.map((connection) => connection.flow.powerkW)
  );
});

test("inspector labels and units come from component definition metadata", () => {
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex: 0
  });
  const battery = view.components.find((component) => component.id === "battery");
  const capacity = battery.parameterGroups
    .flatMap((group) => group.fields)
    .find((field) => field.id === "capacitykWh");

  assert.equal(capacity.label, "Capacity");
  assert.equal(capacity.unit, electricalBatteryDefinition.parameters.capacitykWh.unit);
  assert.deepEqual(capacity.editor, electricalBatteryDefinition.parameters.capacitykWh.editor);
  assert.equal(capacity.displayValue, "5 kWh");
  assert.equal(formatFieldLabel("maximumChargePowerkW"), "Maximum charge power kW");
  assert.equal(formatEngineeringValue(-0, "kW"), "0 kW");
});

test("presentation rejects an unavailable timestep", () => {
  assert.throws(
    () => createWorkbenchView({
      model,
      registry,
      results: run.results,
      stepIndex: run.results.steps.length
    }),
    /stepIndex must be between/u
  );
});

test("temporary parameter values do not replace canonical runtime results", () => {
  const view = createWorkbenchView({
    model,
    registry,
    results: run.results,
    stepIndex: 0,
    parameterOverrides: [{
      componentId: "battery",
      parameter: "capacitykWh",
      value: 9
    }]
  });
  const battery = view.components.find((component) => component.id === "battery");
  const capacity = battery.parameterGroups
    .flatMap((group) => group.fields)
    .find((field) => field.id === "capacitykWh");
  const runtimeBattery = run.results.steps[0].components.find(
    (component) => component.componentId === "battery"
  );

  assert.equal(capacity.value, 9);
  assert.equal(battery.metric.value, runtimeBattery.actualCommand.powerkW);
});
