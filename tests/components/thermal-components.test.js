import assert from "node:assert/strict";
import test from "node:test";

import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { electricHeaterDefinition } from "../../src/components/thermal/electric-heater.js";
import { heatDemandDefinition } from "../../src/components/thermal/heat-demand.js";
import { createComponentRegistry } from "../helpers/registry.js";
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

test("electric heater conserves its declared conversion efficiency", () => {
  const component = preparedComponent(electricHeaterDefinition, {
    parameters: {
      maximumElectricalInputPowerkW: 400,
      efficiency: 0.9,
      supplyTemperatureC: 85
    }
  });
  const limits = component.definition.model.getOperatingLimits(component);
  const evaluation = component.definition.model.evaluate(component, {
    powerkW: -100,
    heatOutputkW: 90
  }, stepContext(component));

  assert.deepEqual(limits, {
    minimumPowerkW: -400,
    maximumPowerkW: 0,
    heatOutputPerElectricalInput: 0.9,
    maximumHeatOutputkW: 360,
    supplyTemperatureC: 85
  });
  assert.deepEqual(evaluation.portFlows, {
    "electricity-in": { powerkW: 100 },
    "heat-out": {
      heatFlowkW: 90,
      sourceTemperatureC: 85,
      deliveryTemperatureC: 85
    }
  });
  assert.deepEqual(evaluation.outputs, {
    electricalInputPowerkW: 100,
    heatOutputkW: 90,
    supplyTemperatureC: 85
  });
  assert.equal(
    evaluation.outputs.heatOutputkW,
    evaluation.outputs.electricalInputPowerkW * component.parameters.efficiency
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
      { powerkW: 1, heatOutputkW: 0 },
      stepContext(component)
    ),
    /powerkW and heatOutputkW/u
  );
  assert.throws(
    () => component.definition.model.evaluate(
      component,
      { powerkW: -10, heatOutputkW: 5 },
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
    heatFlowkW: 60,
    sourceTemperatureC: 80,
    deliveryTemperatureC: 75
  }, context);
  const tooCold = component.definition.model.evaluate(component, {
    heatFlowkW: 60,
    sourceTemperatureC: 65,
    deliveryTemperatureC: 65
  }, context);

  assert.deepEqual(limits, {
    maximumHeatFlowkW: 80,
    minimumDeliveryTemperatureC: 70
  });
  assert.deepEqual(served.outputs, {
    demandHeatFlowkW: 80,
    servedHeatFlowkW: 60,
    unmetHeatFlowkW: 20,
    deliveryTemperatureC: 75,
    deliveryTemperatureMarginK: 5
  });
  assert.deepEqual(
    served.diagnostics.map((diagnostic) => diagnostic.code),
    ["thermal.heat-demand.unmet-heat"]
  );
  assert.equal(tooCold.outputs.servedHeatFlowkW, 0);
  assert.equal(tooCold.outputs.unmetHeatFlowkW, 80);
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

test("constant-temperature boundary provides its imposed timestep temperature", () => {
  const component = preparedComponent(constantTemperatureDefinition, {
    parameters: { temperatureSeriesId: "ambient-temperature" },
    scenarioSeries: [series("ambient-temperature", "°C", [15])]
  });
  const context = stepContext(component, {
    seriesValues: { "ambient-temperature": 15 }
  });
  const evaluation = component.definition.model.evaluate(component, {
    connectionFlows: {
      "first-loss": {
        heatFlowkW: 10,
        sourceTemperatureC: 60,
        deliveryTemperatureC: 15
      },
      "second-loss": {
        heatFlowkW: 5,
        sourceTemperatureC: 45,
        deliveryTemperatureC: 15
      }
    }
  }, context);

  assert.deepEqual(
    component.definition.model.getOperatingLimits(component, context),
    {
      temperatureC: 15,
      fixedTemperatureBoundary: true
    }
  );
  assert.deepEqual(evaluation.portFlows["heat-in"]["first-loss"], {
    heatFlowkW: 10,
    sourceTemperatureC: 60,
    deliveryTemperatureC: 15
  });
  assert.deepEqual(evaluation.portFlows["heat-in"]["second-loss"], {
    heatFlowkW: 5,
    sourceTemperatureC: 45,
    deliveryTemperatureC: 15
  });
  assert.deepEqual(evaluation.outputs, {
    temperatureC: 15,
    receivedHeatFlowkW: 15
  });
});
