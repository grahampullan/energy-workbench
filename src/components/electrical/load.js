import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolveSinglePortActivePower,
  singlePortActivePowerResolution
} from "./resolve-single-active-power-port.js";

function parameterValue(component, definition, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : definition.parameters[parameter].default;
}

function demandPowerkW(runtimeComponent, stepContext) {
  const seriesValue = stepContext.seriesValues[runtimeComponent.modelData.demandSeriesId];
  const demand = seriesValue * runtimeComponent.modelData.profileMultiplier;
  if (!Number.isFinite(demand) || demand < 0) {
    throw new RangeError("Electrical demand must be a finite, non-negative power in kW");
  }
  return demand;
}

export const electricalLoadDefinition = {
  type: "electrical.load",
  version: "0.2.0",
  name: "Electrical load",

  parameters: {
    demandSeriesId: {
      unit: "scenario-series-id",
      default: "electrical-demand"
    },
    profileMultiplier: {
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 5, step: 0.1 }
    }
  },

  initialState: {},

  ports: [
    {
      id: "electricity-in",
      flowType: ACTIVE_POWER_FLOW_TYPE,
      direction: "in"
    }
  ],

  outputs: {
    demandPowerkW: { unit: "kW" },
    suppliedPowerkW: { unit: "kW" }
  },

  editor: {
    visualRole: "boundary",
    groups: [
      {
        id: "demand",
        label: "Demand",
        parameters: ["demandSeriesId", "profileMultiplier"]
      }
    ]
  },

  validate(modelComponent) {
    const demandSeriesId = parameterValue(
      modelComponent,
      electricalLoadDefinition,
      "demandSeriesId"
    );
    if (typeof demandSeriesId !== "string" || demandSeriesId.length === 0) {
      return [{
        code: "electrical.load.demand-series-id",
        message: "demandSeriesId must be a non-empty scenario series ID"
      }];
    }
    return [];
  },

  resolution: singlePortActivePowerResolution("electricity-in"),

  model: {
    prepare(modelComponent, context) {
      const demandSeriesId = modelComponent.parameters.demandSeriesId;
      const series = context.scenario.series.find((candidate) => candidate.id === demandSeriesId);
      if (!series) {
        throw new Error(`Scenario series does not exist: ${demandSeriesId}`);
      }
      if (series.unit !== "kW") {
        throw new Error(`Scenario series ${demandSeriesId} must use kW, not ${series.unit}`);
      }
      return {
        demandSeriesId,
        profileMultiplier: modelComponent.parameters.profileMultiplier
      };
    },

    initialise(runtimeComponent) {
      return runtimeComponent.initialState;
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const demand = demandPowerkW(runtimeComponent, stepContext);
      return {
        minimumPowerkW: -demand,
        maximumPowerkW: -demand
      };
    },

    resolve(runtimeComponent, context) {
      return resolveSinglePortActivePower(
        runtimeComponent,
        context,
        "electricity-in"
      );
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const demand = demandPowerkW(runtimeComponent, stepContext);
      return {
        portFlows: {
          "electricity-in": { powerkW: -actualCommand.powerkW }
        },
        outputs: {
          demandPowerkW: demand,
          suppliedPowerkW: -actualCommand.powerkW
        },
        nextState: stepContext.state,
        diagnostics: []
      };
    }
  }
};
