import assert from "node:assert/strict";
import test from "node:test";

import { batchThermalMassDefinition } from
  "../../src/components/process/batch-thermal-mass.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { prepareRuntimeModel } from "../../src/runtime/prepare-runtime-model.js";

function modelComponent({ parameters = {}, initialState = {} } = {}) {
  return {
    id: "batch",
    type: batchThermalMassDefinition.type,
    definitionVersion: batchThermalMassDefinition.version,
    name: "Batch",
    parameters: {
      massKg: 1000,
      specificHeatCapacityKjPerKgK: 3.6,
      maximumTemperatureC: 100,
      heatLossCoefficientkWPerK: 0.1,
      maximumHeatInputkW: 50,
      requiredTemperatureC: 70,
      ...parameters
    },
    initialState: {
      temperatureC: 60,
      ...initialState
    }
  };
}

function prepare(component = modelComponent()) {
  return prepareRuntimeModel({
    model: {
      schemaVersion: "0.1.0",
      id: "model.batch-component",
      name: "Batch component",
      components: [component],
      connections: []
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.batch-component",
      name: "Batch component scenario",
      time: { timeStepSeconds: 3600, stepCount: 1 },
      series: []
    },
    registry: createComponentRegistry([batchThermalMassDefinition])
  });
}

function stepContext(component, overrides = {}) {
  return {
    stepIndex: 0,
    timeStepSeconds: 3600,
    durationHours: 1,
    elapsedSeconds: 0,
    seriesValues: {},
    state: component.initialState,
    ...overrides
  };
}

function command(overrides = {}) {
  return {
    heatInputkW: 20,
    heatSourceTemperatureC: 100,
    heatDeliveryTemperatureC: 100,
    ambientTemperatureC: 20,
    ...overrides
  };
}

test("batch thermal mass applies heat input, standing loss, and thermal capacity", () => {
  const preparation = prepare();
  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  const component = preparation.runtimeModel.components[0];
  const context = stepContext(component);

  assert.deepEqual(
    component.definition.model.getOperatingLimits(component, context),
    {
      maximumHeatInputkW: 40,
      temperatureC: 60,
      thermalCapacitykWhPerK: 1,
      heatLossCoefficientkWPerK: 0.1,
      maximumTemperatureC: 100,
      requiredTemperatureC: 70
    }
  );

  const evaluation = component.definition.model.evaluate(
    component,
    command(),
    context
  );
  assert.deepEqual(evaluation.outputs, {
    heatInputkW: 20,
    heatLosskW: 4,
    netHeatFlowkW: 16,
    temperatureC: 76,
    requiredTemperatureMarginK: 6
  });
  assert.deepEqual(evaluation.nextState, { temperatureC: 76 });
  assert.deepEqual(evaluation.portFlows["heat-loss"], {
    heatFlowkW: 4,
    sourceTemperatureC: 60,
    deliveryTemperatureC: 20
  });
  assert.deepEqual(evaluation.diagnostics, []);
});

test("batch thermal mass rejects infeasible commands", () => {
  const preparation = prepare();
  const component = preparation.runtimeModel.components[0];
  const context = stepContext(component);

  assert.throws(
    () => component.definition.model.evaluate(
      component,
      command({ heatInputkW: 41 }),
      context
    ),
    /exceeds its operating limit/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      command({ heatDeliveryTemperatureC: 55 }),
      context
    ),
    /delivery temperature at least as high/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      { ...command(), extra: 1 },
      context
    ),
    /must contain exactly/u
  );
});

test("batch thermal mass validates physical model inputs", () => {
  const invalid = prepare(modelComponent({
    parameters: {
      massKg: 0,
      specificHeatCapacityKjPerKgK: 0,
      maximumTemperatureC: 100,
      requiredTemperatureC: 110
    },
    initialState: { temperatureC: 120 }
  }));

  assert.equal(invalid.prepared, false);
  assert.deepEqual(
    invalid.diagnostics.map((diagnostic) => diagnostic.code),
    [
      "process.batch-thermal-mass.mass",
      "process.batch-thermal-mass.specific-heat-capacity",
      "process.batch-thermal-mass.temperature-range",
      "process.batch-thermal-mass.initial-temperature"
    ]
  );
});
