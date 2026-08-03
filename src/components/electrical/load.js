function parameterValue(component, definition, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : definition.parameters[parameter].default;
}

function demandPowerKw(runtimeComponent, stepContext) {
  const seriesValue = stepContext.seriesValues[runtimeComponent.modelData.demandSeriesId];
  const demand = seriesValue * runtimeComponent.modelData.profileMultiplier;
  if (!Number.isFinite(demand) || demand < 0) {
    throw new RangeError("Electrical demand must be a finite, non-negative power in kW");
  }
  return demand;
}

export const electricalLoadDefinition = {
  type: "electrical.load",
  version: "0.1.0",
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
      medium: "electricity.active-power",
      direction: "in"
    }
  ],

  outputs: {
    demandPowerKw: { unit: "kW" },
    suppliedPowerKw: { unit: "kW" }
  },

  editor: {
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
      const demand = demandPowerKw(runtimeComponent, stepContext);
      return {
        minimumPowerKw: -demand,
        maximumPowerKw: -demand
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const demand = demandPowerKw(runtimeComponent, stepContext);
      return {
        portFlows: {
          "electricity-in": { powerKw: -actualCommand.powerKw }
        },
        outputs: {
          demandPowerKw: demand,
          suppliedPowerKw: -actualCommand.powerKw
        },
        nextState: stepContext.state,
        diagnostics: []
      };
    }
  }
};
