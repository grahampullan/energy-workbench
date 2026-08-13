import assert from "node:assert/strict";
import test from "node:test";

import { ambientBoundaryDefinition } from "../../src/components/thermal/ambient-boundary.js";
import { electricHeaterDefinition } from "../../src/components/thermal/electric-heater.js";
import { heatDemandDefinition } from "../../src/components/thermal/heat-demand.js";
import { hotWaterStoreDefinition } from "../../src/components/thermal/hot-water-store.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import { prepareRuntimeModel } from "../../src/runtime/prepare-runtime-model.js";

function series(id, unit, values) {
  return {
    id,
    name: id,
    unit,
    data: { kind: "inline", values }
  };
}

function prepareDefinition(definition, {
  parameters = {},
  initialState = {},
  scenarioSeries = [],
  timeStepSeconds = 3600
} = {}) {
  const stepCount = scenarioSeries[0]?.data.values.length ?? 1;
  const preparation = prepareRuntimeModel({
    model: {
      schemaVersion: "0.1.0",
      id: "model.thermal-component",
      name: "Thermal component",
      components: [{
        id: "component",
        type: definition.type,
        definitionVersion: definition.version,
        name: definition.name,
        parameters,
        initialState
      }],
      connections: []
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.thermal-component",
      name: "Thermal component scenario",
      time: { timeStepSeconds, stepCount },
      series: scenarioSeries
    },
    registry: createComponentRegistry([definition])
  });

  return preparation;
}

function preparedComponent(definition, options) {
  const preparation = prepareDefinition(definition, options);
  assert.equal(
    preparation.prepared,
    true,
    preparation.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
  );
  return preparation.runtimeModel.components[0];
}

function stepContext(component, {
  state = component.definition.model.initialise(component),
  seriesValues = {},
  durationHours = 1,
  stepIndex = 0
} = {}) {
  return {
    stepIndex,
    timeStepSeconds: durationHours * 3600,
    durationHours,
    elapsedSeconds: stepIndex * durationHours * 3600,
    seriesValues,
    state
  };
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function storeOptions(overrides = {}) {
  return {
    parameters: {
      volumeM3: 1,
      waterDensityKgPerM3: 1000,
      specificHeatCapacityKjPerKgK: 3.6,
      maximumTemperatureC: 100,
      heatLossCoefficientKwPerK: 0,
      maximumChargeHeatFlowKw: 100,
      maximumDischargeHeatFlowKw: 100,
      minimumUsefulTemperatureC: 70,
      ...overrides.parameters
    },
    initialState: {
      temperatureC: 80,
      ...overrides.initialState
    },
    timeStepSeconds: overrides.timeStepSeconds ?? 3600
  };
}

function storeCommand(overrides = {}) {
  return {
    chargeHeatFlowKw: 0,
    chargeSourceTemperatureC: 100,
    chargeDeliveryTemperatureC: 100,
    dischargeHeatFlowKw: 0,
    ambientTemperatureC: 20,
    ...overrides
  };
}

test("electric heater conserves its declared conversion efficiency", () => {
  const component = preparedComponent(electricHeaterDefinition, {
    parameters: {
      maximumElectricalInputPowerKw: 400,
      efficiency: 0.9,
      supplyTemperatureC: 85
    }
  });
  const limits = component.definition.model.getOperatingLimits(component);
  const evaluation = component.definition.model.evaluate(component, {
    powerKw: -100,
    heatOutputKw: 90
  }, stepContext(component));

  assert.deepEqual(limits, {
    minimumPowerKw: -400,
    maximumPowerKw: 0,
    heatOutputPerElectricalInput: 0.9,
    maximumHeatOutputKw: 360,
    supplyTemperatureC: 85
  });
  assert.deepEqual(evaluation.portFlows, {
    "electricity-in": { powerKw: 100 },
    "heat-out": {
      heatFlowKw: 90,
      sourceTemperatureC: 85,
      deliveryTemperatureC: 85
    }
  });
  assert.deepEqual(evaluation.outputs, {
    electricalInputPowerKw: 100,
    heatOutputKw: 90,
    supplyTemperatureC: 85
  });
  assert.equal(
    evaluation.outputs.heatOutputKw,
    evaluation.outputs.electricalInputPowerKw * component.parameters.efficiency
  );
});

test("electric heater rejects zero efficiency and invalid actual power direction", () => {
  const invalid = prepareDefinition(electricHeaterDefinition, {
    parameters: { efficiency: 0 }
  });
  assert.equal(invalid.prepared, false);
  assert.ok(invalid.diagnostics.some(
    (diagnostic) => diagnostic.code === "thermal.electric-heater.efficiency"
  ));

  const component = preparedComponent(electricHeaterDefinition);
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      { powerKw: 1, heatOutputKw: 0 },
      stepContext(component)
    ),
    /powerKw and heatOutputKw/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      { powerKw: -10, heatOutputKw: 5 },
      stepContext(component)
    ),
    /conversion efficiency/u
  );
});

test("heat demand distinguishes served, unmet, and low-temperature heat", () => {
  const component = preparedComponent(heatDemandDefinition, {
    parameters: {
      demandSeriesId: "thermal-demand",
      profileMultiplier: 1,
      minimumDeliveryTemperatureC: 70
    },
    scenarioSeries: [series("thermal-demand", "kW", [80])]
  });
  const context = stepContext(component, {
    seriesValues: { "thermal-demand": 80 }
  });
  const limits = component.definition.model.getOperatingLimits(component, context);
  const served = component.definition.model.evaluate(component, {
    heatFlowKw: 60,
    sourceTemperatureC: 80,
    deliveryTemperatureC: 75
  }, context);
  const tooCold = component.definition.model.evaluate(component, {
    heatFlowKw: 60,
    sourceTemperatureC: 65,
    deliveryTemperatureC: 65
  }, context);

  assert.deepEqual(limits, {
    maximumHeatFlowKw: 80,
    minimumDeliveryTemperatureC: 70
  });
  assert.deepEqual(served.outputs, {
    demandHeatFlowKw: 80,
    servedHeatFlowKw: 60,
    unmetHeatFlowKw: 20,
    deliveryTemperatureC: 75,
    deliveryTemperatureMarginK: 5
  });
  assert.deepEqual(
    served.diagnostics.map((diagnostic) => diagnostic.code),
    ["thermal.heat-demand.unmet-heat"]
  );
  assert.equal(tooCold.outputs.servedHeatFlowKw, 0);
  assert.equal(tooCold.outputs.unmetHeatFlowKw, 80);
  assert.equal(tooCold.outputs.deliveryTemperatureMarginK, -5);
});

test("heat demand preparation rejects a scenario series with the wrong unit", () => {
  const preparation = prepareDefinition(heatDemandDefinition, {
    parameters: { demandSeriesId: "thermal-demand" },
    scenarioSeries: [series("thermal-demand", "MW", [0.08])]
  });

  assert.equal(preparation.prepared, false);
  assert.deepEqual(
    preparation.diagnostics.map((diagnostic) => diagnostic.code),
    ["runtime.component-preparation-failed"]
  );
});

test("ambient boundary provides the timestep temperature for rejected heat", () => {
  const component = preparedComponent(ambientBoundaryDefinition, {
    parameters: { temperatureSeriesId: "ambient-temperature" },
    scenarioSeries: [series("ambient-temperature", "°C", [15])]
  });
  const context = stepContext(component, {
    seriesValues: { "ambient-temperature": 15 }
  });
  const evaluation = component.definition.model.evaluate(component, {
    heatFlowKw: 10,
    sourceTemperatureC: 60
  }, context);

  assert.deepEqual(
    component.definition.model.getOperatingLimits(component, context),
    { ambientTemperatureC: 15 }
  );
  assert.deepEqual(evaluation.portFlows["heat-in"], {
    heatFlowKw: 10,
    sourceTemperatureC: 60,
    deliveryTemperatureC: 15
  });
  assert.deepEqual(evaluation.outputs, {
    ambientTemperatureC: 15,
    receivedHeatFlowKw: 10
  });
});

test("hot-water store limits charge and useful discharge by state and timestep", () => {
  const component = preparedComponent(hotWaterStoreDefinition, storeOptions());
  const oneHour = component.definition.model.getOperatingLimits(
    component,
    stepContext(component)
  );
  const halfHour = component.definition.model.getOperatingLimits(
    component,
    stepContext(component, { durationHours: 0.5 })
  );

  assert.deepEqual(oneHour, {
    maximumChargeHeatFlowKw: 20,
    maximumDischargeHeatFlowKw: 10,
    sourceTemperatureC: 80,
    thermalCapacityKwhPerK: 1,
    heatLossCoefficientKwPerK: 0,
    minimumUsefulTemperatureC: 70,
    maximumTemperatureC: 100
  });
  assert.deepEqual(halfHour, {
    maximumChargeHeatFlowKw: 40,
    maximumDischargeHeatFlowKw: 20,
    sourceTemperatureC: 80,
    thermalCapacityKwhPerK: 1,
    heatLossCoefficientKwPerK: 0,
    minimumUsefulTemperatureC: 70,
    maximumTemperatureC: 100
  });

  const belowUseful = preparedComponent(hotWaterStoreDefinition, storeOptions({
    initialState: { temperatureC: 65 }
  }));
  assert.equal(
    belowUseful.definition.model.getOperatingLimits(
      belowUseful,
      stepContext(belowUseful)
    ).maximumDischargeHeatFlowKw,
    0
  );
});

test("hot-water store conserves charge, discharge, loss, and state energy", () => {
  const component = preparedComponent(hotWaterStoreDefinition, storeOptions({
    parameters: { heatLossCoefficientKwPerK: 0.1 }
  }));
  const context = stepContext(component);
  const evaluation = component.definition.model.evaluate(
    component,
    storeCommand({ dischargeHeatFlowKw: 4 }),
    context
  );
  const storedEnergyChangeKwh = component.modelData.thermalCapacityKwhPerK *
    (evaluation.nextState.temperatureC - context.state.temperatureC);

  assert.deepEqual(evaluation.portFlows["heat-out"], {
    heatFlowKw: 4,
    sourceTemperatureC: 80,
    deliveryTemperatureC: 80
  });
  assert.deepEqual(evaluation.portFlows["heat-loss"], {
    heatFlowKw: 6,
    sourceTemperatureC: 80,
    deliveryTemperatureC: 20
  });
  assert.deepEqual(evaluation.outputs, {
    chargeHeatFlowKw: 0,
    dischargeHeatFlowKw: 4,
    heatLossKw: 6,
    netHeatFlowKw: -10,
    temperatureC: 70,
    usableEnergyKwh: 0,
    deliveryTemperatureMarginK: 10
  });
  assertClose(
    storedEnergyChangeKwh,
    evaluation.outputs.netHeatFlowKw * context.durationHours
  );
});

test("hot-water store accepts bounded charging at a sufficient temperature", () => {
  const component = preparedComponent(hotWaterStoreDefinition, storeOptions());
  const evaluation = component.definition.model.evaluate(
    component,
    storeCommand({ chargeHeatFlowKw: 10 }),
    stepContext(component)
  );

  assert.equal(evaluation.nextState.temperatureC, 90);
  assert.equal(evaluation.outputs.usableEnergyKwh, 20);
  assert.deepEqual(evaluation.portFlows["heat-in"], {
    heatFlowKw: 10,
    sourceTemperatureC: 100,
    deliveryTemperatureC: 100
  });

  assert.throws(
    () => component.definition.model.evaluate(
      component,
      storeCommand({
        chargeHeatFlowKw: 10,
        chargeSourceTemperatureC: 75,
        chargeDeliveryTemperatureC: 75
      }),
      stepContext(component)
    ),
    /at least as high as the store temperature/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      storeCommand({
        chargeHeatFlowKw: 10,
        chargeSourceTemperatureC: 85,
        chargeDeliveryTemperatureC: 85
      }),
      stepContext(component)
    ),
    /above the heat delivery temperature/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      storeCommand({ chargeHeatFlowKw: 21 }),
      stepContext(component)
    ),
    /operating limit/u
  );
});

test("hot-water store loss cannot cool it through the ambient boundary", () => {
  const component = preparedComponent(hotWaterStoreDefinition, storeOptions({
    parameters: {
      heatLossCoefficientKwPerK: 10,
      minimumUsefulTemperatureC: 0
    },
    initialState: { temperatureC: 21 }
  }));
  const evaluation = component.definition.model.evaluate(
    component,
    storeCommand(),
    stepContext(component)
  );

  assert.equal(evaluation.outputs.heatLossKw, 1);
  assert.equal(evaluation.nextState.temperatureC, 20);
});

test("hot-water store explicit heat loss converges under timestep refinement", () => {
  const component = preparedComponent(hotWaterStoreDefinition, storeOptions({
    parameters: { heatLossCoefficientKwPerK: 0.1 }
  }));
  const initialState = { temperatureC: 80 };
  const coarse = component.definition.model.evaluate(
    component,
    storeCommand(),
    stepContext(component, { state: initialState, durationHours: 1 })
  );
  const firstHalf = component.definition.model.evaluate(
    component,
    storeCommand(),
    stepContext(component, { state: initialState, durationHours: 0.5 })
  );
  const secondHalf = component.definition.model.evaluate(
    component,
    storeCommand(),
    stepContext(component, {
      state: firstHalf.nextState,
      durationHours: 0.5,
      stepIndex: 1
    })
  );
  const analyticalTemperatureC = 20 + 60 * Math.exp(-0.1);

  assert.equal(coarse.nextState.temperatureC, 74);
  assert.equal(secondHalf.nextState.temperatureC, 74.15);
  assert.ok(
    Math.abs(secondHalf.nextState.temperatureC - analyticalTemperatureC) <
      Math.abs(coarse.nextState.temperatureC - analyticalTemperatureC)
  );
});

test("hot-water store validation rejects impossible physical definitions", () => {
  const invalidCases = [
    {
      options: storeOptions({ parameters: { volumeM3: 0 } }),
      code: "thermal.hot-water-store.volume"
    },
    {
      options: storeOptions({
        parameters: {
          maximumTemperatureC: 70,
          minimumUsefulTemperatureC: 70
        }
      }),
      code: "thermal.hot-water-store.temperature-range"
    },
    {
      options: storeOptions({ initialState: { temperatureC: 101 } }),
      code: "thermal.hot-water-store.initial-temperature"
    }
  ];

  for (const { options, code } of invalidCases) {
    const preparation = prepareDefinition(hotWaterStoreDefinition, options);
    assert.equal(preparation.prepared, false);
    assert.ok(preparation.diagnostics.some(
      (diagnostic) => diagnostic.code === code
    ));
  }
});
