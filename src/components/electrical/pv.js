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

function availablePowerkW(runtimeComponent, stepContext) {
  const seriesValue = stepContext.seriesValues[runtimeComponent.modelData.generationSeriesId];
  const availablePower = seriesValue * runtimeComponent.modelData.profileMultiplier;
  if (!Number.isFinite(availablePower) || availablePower < 0) {
    throw new RangeError("PV generation must be a finite, non-negative power in kW");
  }
  return availablePower;
}

export const electricalPvDefinition = {
  type: "electrical.pv",
  version: "0.2.0",
  name: "Solar PV",
  information: {
    outputs: {
      "power": { label: "Solar power", quantity: "active-power", unit: "kW", read: ({ limits }) => limits.minimumPowerkW }
    }
  },

  explanation: {
    title: "Prescribed solar generation",
    summary: "Solar power as function of time.",
    equations: [{ label: "Electrical output", tex: String.raw`P(t)=\alpha P_{\mathrm{profile}}(t)` }],
    symbols: [
      { tex: String.raw`P,P_{\mathrm{profile}}`, description: "Actual output and scenario generation", unit: "kW" },
      { tex: String.raw`\alpha`, description: "Generation profile multiplier", unit: "1" },
      { tex: "t", description: "Simulation time", unit: "s" }
    ],
    notes: []
  },

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
      flowType: ACTIVE_POWER_FLOW_TYPE,
      direction: "out"
    }
  ],

  outputs: {
    availablePowerkW: { unit: "kW" },
    powerkW: { unit: "kW" }
  },

  editor: {
    visualRole: "equipment",
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

  resolution: singlePortActivePowerResolution("electricity-out"),

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
      const availablePower = availablePowerkW(runtimeComponent, stepContext);
      return {
        minimumPowerkW: availablePower,
        maximumPowerkW: availablePower
      };
    },

    resolve(runtimeComponent, context) {
      return resolveSinglePortActivePower(
        runtimeComponent,
        context,
        "electricity-out"
      );
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const availablePower = availablePowerkW(runtimeComponent, stepContext);
      return {
        portFlows: {
          "electricity-out": { powerkW: actualCommand.powerkW }
        },
        outputs: {
          availablePowerkW: availablePower,
          powerkW: actualCommand.powerkW
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
