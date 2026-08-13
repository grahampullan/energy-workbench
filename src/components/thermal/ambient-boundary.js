import {
  ABSOLUTE_ZERO_C,
  createThermalFlow,
  THERMAL_FLOW_MEDIUM
} from "../../core/thermal-flow.js";

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : ambientBoundaryDefinition.parameters[parameter].default;
}

function ambientTemperatureC(runtimeComponent, stepContext) {
  const temperature = stepContext.seriesValues[
    runtimeComponent.modelData.temperatureSeriesId
  ];
  if (!Number.isFinite(temperature) || temperature < ABSOLUTE_ZERO_C) {
    throw new RangeError(
      "Ambient temperature must be finite and no lower than absolute zero"
    );
  }
  return temperature;
}

export const ambientBoundaryDefinition = {
  type: "thermal.ambient-boundary",
  version: "0.1.0",
  name: "Ambient boundary",

  parameters: {
    temperatureSeriesId: {
      unit: "scenario-series-id",
      default: "ambient-temperature"
    }
  },

  initialState: {},

  ports: [{
    id: "heat-in",
    medium: THERMAL_FLOW_MEDIUM,
    direction: "in"
  }],

  outputs: {
    ambientTemperatureC: { unit: "°C" },
    receivedHeatFlowKw: { unit: "kW" }
  },

  editor: {
    groups: [{
      id: "boundary",
      label: "Boundary",
      parameters: ["temperatureSeriesId"]
    }]
  },

  validate(modelComponent) {
    const temperatureSeriesId = parameterValue(modelComponent, "temperatureSeriesId");
    if (typeof temperatureSeriesId !== "string" || temperatureSeriesId.length === 0) {
      return [{
        code: "thermal.ambient-boundary.temperature-series-id",
        message: "temperatureSeriesId must be a non-empty scenario series ID"
      }];
    }
    return [];
  },

  model: {
    prepare(modelComponent, context) {
      const temperatureSeriesId = modelComponent.parameters.temperatureSeriesId;
      const series = context.scenario.series.find(
        (candidate) => candidate.id === temperatureSeriesId
      );
      if (!series) {
        throw new Error(`Scenario series does not exist: ${temperatureSeriesId}`);
      }
      if (series.unit !== "°C") {
        throw new Error(
          `Scenario series ${temperatureSeriesId} must use °C, not ${series.unit}`
        );
      }
      return { temperatureSeriesId };
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      return { ambientTemperatureC: ambientTemperatureC(runtimeComponent, stepContext) };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      if (!actualCommand || !Number.isFinite(actualCommand.sourceTemperatureC)) {
        throw new TypeError("Ambient heat receipt requires a finite sourceTemperatureC");
      }
      const temperatureC = ambientTemperatureC(runtimeComponent, stepContext);
      const flow = createThermalFlow({
        heatFlowKw: actualCommand.heatFlowKw,
        sourceTemperatureC: actualCommand.sourceTemperatureC,
        deliveryTemperatureC: temperatureC
      });
      return {
        portFlows: { "heat-in": flow },
        outputs: {
          ambientTemperatureC: temperatureC,
          receivedHeatFlowKw: flow.heatFlowKw
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
