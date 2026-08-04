function parameterValue(component, definition, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : definition.parameters[parameter].default;
}

function availablePowerKw(runtimeComponent, stepContext) {
  const seriesValue = stepContext.seriesValues[runtimeComponent.modelData.generationSeriesId];
  const availablePower = seriesValue * runtimeComponent.modelData.profileMultiplier;
  if (!Number.isFinite(availablePower) || availablePower < 0) {
    throw new RangeError("PV generation must be a finite, non-negative power in kW");
  }
  return availablePower;
}

export const electricalPvDefinition = {
  type: "electrical.pv",
  version: "0.1.0",
  name: "Solar PV",

  parameters: {
    generationSeriesId: {
      unit: "scenario-series-id",
      default: "solar-generation"
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
      id: "electricity-out",
      medium: "electricity.active-power",
      direction: "out"
    }
  ],

  outputs: {
    availablePowerKw: { unit: "kW" },
    powerKw: { unit: "kW" }
  },

  editor: {
    groups: [
      {
        id: "generation",
        label: "Generation",
        parameters: ["generationSeriesId", "profileMultiplier"]
      }
    ]
  },

  validate(modelComponent) {
    const generationSeriesId = parameterValue(
      modelComponent,
      electricalPvDefinition,
      "generationSeriesId"
    );
    if (typeof generationSeriesId !== "string" || generationSeriesId.length === 0) {
      return [{
        code: "electrical.pv.generation-series-id",
        message: "generationSeriesId must be a non-empty scenario series ID"
      }];
    }
    return [];
  },

  model: {
    prepare(modelComponent, context) {
      const generationSeriesId = modelComponent.parameters.generationSeriesId;
      const series = context.scenario.series.find(
        (candidate) => candidate.id === generationSeriesId
      );
      if (!series) {
        throw new Error(`Scenario series does not exist: ${generationSeriesId}`);
      }
      if (series.unit !== "kW") {
        throw new Error(
          `Scenario series ${generationSeriesId} must use kW, not ${series.unit}`
        );
      }
      return {
        generationSeriesId,
        profileMultiplier: modelComponent.parameters.profileMultiplier
      };
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const availablePower = availablePowerKw(runtimeComponent, stepContext);
      return {
        minimumPowerKw: availablePower,
        maximumPowerKw: availablePower
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const availablePower = availablePowerKw(runtimeComponent, stepContext);
      return {
        portFlows: {
          "electricity-out": { powerKw: actualCommand.powerKw }
        },
        outputs: {
          availablePowerKw: availablePower,
          powerKw: actualCommand.powerKw
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
