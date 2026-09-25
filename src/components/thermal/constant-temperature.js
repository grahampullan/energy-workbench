import {
  ABSOLUTE_ZERO_C,
  createThermalFlow
} from "../../core/thermal-flow.js";
import { THERMAL_HEAT_FLOW_TYPE } from "../../core/flow-types.js";
import { resolutionDescription } from "../model-resolution.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : constantTemperatureDefinition.parameters[parameter].default;
}

function boundaryTemperatureC(runtimeComponent, stepContext) {
  const temperatureC = stepContext.seriesValues[
    runtimeComponent.modelData.temperatureSeriesId
  ];
  if (!Number.isFinite(temperatureC) || temperatureC < ABSOLUTE_ZERO_C) {
    throw new RangeError(
      "Constant temperature must be finite and no lower than absolute zero"
    );
  }
  return temperatureC;
}

function resolvedConnectionFlows(context) {
  const temperatureC = context.operatingLimits.temperatureC;
  const connectionFlows = {};
  for (const connection of context.connections) {
    const flow = context.getConnectionFlow(connection.id);
    if (flow === undefined) {
      return null;
    }
    connectionFlows[connection.id] = createThermalFlow({
      heatFlowkW: flow.heatFlowkW,
      sourceTemperatureC: flow.sourceTemperatureC,
      deliveryTemperatureC: temperatureC
    });
  }
  return connectionFlows;
}

function evaluatedConnectionFlows(actualCommand, temperatureC) {
  if (
    !isRecord(actualCommand) ||
    Object.keys(actualCommand).length !== 1 ||
    !isRecord(actualCommand.connectionFlows)
  ) {
    throw new TypeError(
      "Constant-temperature command must contain exactly its connection flows"
    );
  }
  return Object.fromEntries(Object.entries(actualCommand.connectionFlows).map(
    ([connectionId, flow]) => [connectionId, createThermalFlow({
      heatFlowkW: flow?.heatFlowkW,
      sourceTemperatureC: flow?.sourceTemperatureC,
      deliveryTemperatureC: temperatureC
    })]
  ));
}

export const constantTemperatureDefinition = {
  type: "thermal.constant-temperature",
  version: "0.1.0",
  name: "Constant temperature",

  parameters: {
    temperatureSeriesId: {
      unit: "scenario-series-id",
      default: "ambient-temperature"
    }
  },

  initialState: {},

  ports: [{
    id: "heat-in",
    flowType: THERMAL_HEAT_FLOW_TYPE,
    direction: "in",
    cardinality: "many"
  }],

  outputs: {
    temperatureC: { unit: "°C" },
    receivedHeatFlowkW: { unit: "kW" }
  },

  editor: {
    visualRole: "boundary",
    summaryOutput: "temperatureC",
    groups: [{
      id: "boundary",
      label: "Boundary",
      parameters: ["temperatureSeriesId"]
    }]
  },

  validate(modelComponent) {
    const temperatureSeriesId = parameterValue(
      modelComponent,
      "temperatureSeriesId"
    );
    if (
      typeof temperatureSeriesId !== "string" ||
      temperatureSeriesId.length === 0
    ) {
      return [{
        code: "thermal.constant-temperature.temperature-series-id",
        message: "temperatureSeriesId must be a non-empty scenario series ID"
      }];
    }
    return [];
  },

  resolution: {
    describe(runtimeComponent, context) {
      return resolutionDescription({
        connectionFlows: context.connections.map((connection) => connection.id)
      });
    }
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
      return {
        temperatureC: boundaryTemperatureC(runtimeComponent, stepContext),
        fixedTemperatureBoundary: true
      };
    },

    resolve(runtimeComponent, context) {
      const connectionFlows = resolvedConnectionFlows(context);
      if (connectionFlows === null) {
        return null;
      }
      return {
        feasibleCommand: null,
        actualCommand: { connectionFlows },
        connectionFlows: {}
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const temperatureC = boundaryTemperatureC(runtimeComponent, stepContext);
      const connectionFlows = evaluatedConnectionFlows(
        actualCommand,
        temperatureC
      );
      return {
        portFlows: { "heat-in": connectionFlows },
        outputs: {
          temperatureC,
          receivedHeatFlowkW: Object.values(connectionFlows).reduce(
            (total, flow) => total + flow.heatFlowkW,
            0
          )
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
