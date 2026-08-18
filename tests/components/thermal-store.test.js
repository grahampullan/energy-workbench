import assert from "node:assert/strict";
import test from "node:test";

import { thermalStoreDefinition } from
  "../../src/components/thermal/store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { prepareRuntimeModel } from "../../src/runtime/prepare-runtime-model.js";

function modelComponent({ parameters = {}, initialState = {} } = {}) {
  return {
    id: "store",
    type: thermalStoreDefinition.type,
    definitionVersion: thermalStoreDefinition.version,
    name: "Thermal store",
    parameters: {
      maximumMassKg: 1000,
      specificHeatCapacityKjPerKgK: 3.6,
      enthalpyReferenceTemperatureC: 0,
      maximumTemperatureC: 100,
      minimumUsefulTemperatureC: 70,
      heatLossCoefficientkWPerK: 0.1,
      maximumHeatInputkW: 50,
      maximumHeatOutputkW: 100,
      ...parameters
    },
    initialState: {
      massKg: 1000,
      containedEnthalpykWh: 60,
      ...initialState
    }
  };
}

function prepare(component = modelComponent()) {
  return prepareRuntimeModel({
    model: {
      schemaVersion: "0.1.0",
      id: "model.thermal-store-component",
      name: "Thermal-store component",
      components: [component],
      connections: []
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.thermal-store-component",
      name: "Thermal-store component scenario",
      time: { timeStepSeconds: 3600, stepCount: 1 },
      series: []
    },
    registry: createComponentRegistry([thermalStoreDefinition])
  });
}

function stepContext(component, {
  state = component.initialState,
  durationHours = 1,
  stepIndex = 0
} = {}) {
  return {
    stepIndex,
    timeStepSeconds: durationHours * 3600,
    durationHours,
    elapsedSeconds: stepIndex * durationHours * 3600,
    seriesValues: {},
    state
  };
}

function materialFlow(massFlowKgPerSecond = 0, specificEnthalpyKjPerKg = 216) {
  return { massFlowKgPerSecond, specificEnthalpyKjPerKg };
}

function heatFlow(heatFlowkW = 0, sourceTemperatureC = 60, deliveryTemperatureC = 60) {
  return { heatFlowkW, sourceTemperatureC, deliveryTemperatureC };
}

function command(overrides = {}) {
  return {
    materialInFlow: materialFlow(),
    materialOutFlow: materialFlow(),
    heatInFlows: {},
    heatOutFlow: heatFlow(),
    heatLossFlow: heatFlow(0, 60, 20),
    ...overrides
  };
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("one thermal store represents a closed fixed-mass thermal body", () => {
  const preparation = prepare();
  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  const component = preparation.runtimeModel.components[0];
  const context = stepContext(component);

  assert.deepEqual(
    component.definition.model.getOperatingLimits(component, context),
    {
      maximumMassOutflowKgPerSecond: 1000 / 3600,
      maximumHeatInputkW: 50,
      maximumHeatOutputkW: 0,
      containedMassKg: 1000,
      containedEnthalpykWh: 60,
      specificEnthalpyKjPerKg: 216,
      temperatureC: 60,
      sourceTemperatureC: 60,
      thermalCapacitykWhPerK: 1,
      heatLossCoefficientkWPerK: 0.1,
      minimumUsefulTemperatureC: 70,
      maximumTemperatureC: 100
    }
  );

  const evaluation = component.definition.model.evaluate(
    component,
    command({
      heatInFlows: {
        "heater-to-store": heatFlow(20, 100, 100)
      },
      heatLossFlow: heatFlow(4, 60, 20)
    }),
    context
  );

  assert.equal(evaluation.outputs.heatInputkW, 20);
  assert.equal(evaluation.outputs.heatLosskW, 4);
  assert.equal(evaluation.outputs.netEnergyFlowkW, 16);
  assert.equal(evaluation.outputs.temperatureC, 76);
  assert.deepEqual(evaluation.nextState, {
    massKg: 1000,
    containedEnthalpykWh: 76
  });
});

test("the same thermal store conserves mass and enthalpy with material flow", () => {
  const preparation = prepare(modelComponent({
    parameters: {
      maximumMassKg: 120,
      specificHeatCapacityKjPerKgK: 1,
      maximumTemperatureC: 200,
      minimumUsefulTemperatureC: 0,
      heatLossCoefficientkWPerK: 0,
      maximumHeatInputkW: 10
    },
    initialState: {
      massKg: 120,
      containedEnthalpykWh: 10 / 3
    }
  }));
  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  const component = preparation.runtimeModel.components[0];
  const durationHours = 6 / 3600;
  const evaluation = component.definition.model.evaluate(
    component,
    command({
      materialInFlow: materialFlow(0, 100),
      materialOutFlow: materialFlow(1, 100),
      heatInFlows: {
        "heater-to-store": heatFlow(10, 150, 150)
      },
      heatOutFlow: heatFlow(0, 100, 100),
      heatLossFlow: heatFlow(0, 100, 100)
    }),
    stepContext(component, { durationHours })
  );

  assert.equal(evaluation.nextState.massKg, 114);
  assertClose(
    evaluation.nextState.containedEnthalpykWh,
    10 / 3 + (10 - 100) * durationHours
  );
  assert.equal(evaluation.outputs.massOutflowKgPerSecond, 1);
  assert.equal(evaluation.outputs.enthalpyOutflowkW, 100);
  assert.equal(evaluation.outputs.heatInputkW, 10);
});

test("an empty thermal store can accept material and heat in the same step", () => {
  const preparation = prepare(modelComponent({
    parameters: {
      maximumMassKg: 120,
      specificHeatCapacityKjPerKgK: 1,
      maximumTemperatureC: 200,
      minimumUsefulTemperatureC: 0,
      heatLossCoefficientkWPerK: 0,
      maximumHeatInputkW: 10
    },
    initialState: {
      massKg: 0,
      containedEnthalpykWh: 0
    }
  }));
  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  const component = preparation.runtimeModel.components[0];
  const durationHours = 6 / 3600;
  const evaluation = component.definition.model.evaluate(
    component,
    command({
      materialInFlow: materialFlow(1, 100),
      materialOutFlow: materialFlow(0, 0),
      heatInFlows: {
        "heater-to-store": heatFlow(10, 150, 150)
      },
      heatOutFlow: heatFlow(0, 0, 0),
      heatLossFlow: heatFlow(0, 0, 0)
    }),
    stepContext(component, { durationHours })
  );

  assert.equal(evaluation.nextState.massKg, 6);
  assertClose(evaluation.outputs.temperatureC, 110);
});

test("thermal-store evaluation rejects commands that contradict its physics", () => {
  const preparation = prepare();
  const component = preparation.runtimeModel.components[0];
  const context = stepContext(component);

  assert.throws(
    () => component.definition.model.evaluate(
      component,
      command({
        heatInFlows: { heater: heatFlow(51, 100, 100) },
        heatLossFlow: heatFlow(4, 60, 20)
      }),
      context
    ),
    /heat input exceeds/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      command({
        heatInFlows: { heater: heatFlow(10, 55, 55) },
        heatLossFlow: heatFlow(4, 60, 20)
      }),
      context
    ),
    /delivery temperature at least as high/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      command({ heatLossFlow: heatFlow(3, 60, 20) }),
      context
    ),
    /governing heat-loss equation/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      { ...command(), extra: true },
      context
    ),
    /must contain exactly/u
  );
});

test("thermal-store heat loss is ambient-bounded and refines explicitly", () => {
  const preparation = prepare(modelComponent({
    parameters: { heatLossCoefficientkWPerK: 0.1 },
    initialState: { massKg: 1000, containedEnthalpykWh: 80 }
  }));
  const component = preparation.runtimeModel.components[0];
  const evaluateLoss = (state, durationHours, heatLosskW) =>
    component.definition.model.evaluate(
      component,
      command({
        materialInFlow: materialFlow(0, state.containedEnthalpykWh * 3.6),
        materialOutFlow: materialFlow(0, state.containedEnthalpykWh * 3.6),
        heatOutFlow: heatFlow(0, state.containedEnthalpykWh, state.containedEnthalpykWh),
        heatLossFlow: heatFlow(
          heatLosskW,
          state.containedEnthalpykWh,
          20
        )
      }),
      stepContext(component, { state, durationHours })
    );
  const initialState = { massKg: 1000, containedEnthalpykWh: 80 };
  const coarse = evaluateLoss(initialState, 1, 6);
  const firstHalf = evaluateLoss(initialState, 0.5, 6);
  const secondHalf = evaluateLoss(firstHalf.nextState, 0.5, 5.7);

  assertClose(coarse.outputs.temperatureC, 74);
  assertClose(secondHalf.outputs.temperatureC, 74.15);
  assert.ok(secondHalf.outputs.temperatureC > coarse.outputs.temperatureC);

  const highLossPreparation = prepare(modelComponent({
    parameters: {
      minimumUsefulTemperatureC: 0,
      heatLossCoefficientkWPerK: 10
    },
    initialState: { massKg: 1000, containedEnthalpykWh: 21 }
  }));
  const highLossStore = highLossPreparation.runtimeModel.components[0];
  const ambientBounded = highLossStore.definition.model.evaluate(
    highLossStore,
    command({
      materialInFlow: materialFlow(0, 75.6),
      materialOutFlow: materialFlow(0, 75.6),
      heatOutFlow: heatFlow(0, 21, 21),
      heatLossFlow: heatFlow(1, 21, 20)
    }),
    stepContext(highLossStore)
  );
  assert.equal(ambientBounded.outputs.temperatureC, 20);
});

test("thermal-store validation rejects impossible state and properties", () => {
  const invalid = prepare(modelComponent({
    parameters: {
      maximumMassKg: 0,
      specificHeatCapacityKjPerKgK: 0,
      maximumTemperatureC: 70,
      minimumUsefulTemperatureC: 70
    },
    initialState: {
      massKg: 1001,
      containedEnthalpykWh: 100
    }
  }));

  assert.equal(invalid.prepared, false);
  assert.deepEqual(
    invalid.diagnostics.map((diagnostic) => diagnostic.code),
    [
      "thermal.store.maximum-mass",
      "thermal.store.specific-heat-capacity",
      "thermal.store.temperature-range",
      "thermal.store.initial-mass"
    ]
  );
});

test("thermal-store ports make material transfer optional and heat input repeatable", () => {
  assert.deepEqual(
    thermalStoreDefinition.ports.map(({ id, cardinality }) => [
      id,
      cardinality ?? "one"
    ]),
    [
      ["material-in", "one"],
      ["material-out", "one"],
      ["heat-in", "many"],
      ["heat-out", "one"],
      ["heat-loss", "one"]
    ]
  );
});
