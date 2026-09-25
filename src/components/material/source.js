import { MATERIAL_MASS_FLOW_TYPE } from "../../core/flow-types.js";
import {
  createMaterialFlow,
  materialEnthalpyFlowkW
} from "../../core/material-flow.js";
import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

function massFlowKgPerSecond(runtimeComponent, stepContext) {
  const value = stepContext.seriesValues[runtimeComponent.modelData.massFlowSeriesId];
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Material-source mass flow must be finite and non-negative");
  }
  const scaledValue = value * runtimeComponent.parameters.profileMultiplier;
  if (!Number.isFinite(scaledValue) || scaledValue < 0) {
    throw new RangeError("Scaled material-source mass flow must be finite and non-negative");
  }
  return scaledValue;
}

export const materialSourceDefinition = {
  type: "material.source",
  version: "0.1.0",
  name: "Material source",

  parameters: {
    massFlowSeriesId: {
      unit: "scenario-series-id",
      default: "material-inflow"
    },
    profileMultiplier: {
      label: "Inflow profile multiplier",
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2, step: 0.05 }
    },
    specificEnthalpyKjPerKg: {
      unit: "kJ/kg",
      default: 100,
      editor: { minimum: 0, maximum: 2500, step: 5 }
    }
  },
  initialState: {},
  ports: [{
    id: "material-out",
    flowType: MATERIAL_MASS_FLOW_TYPE,
    direction: "out"
  }],
  outputs: {
    massFlowKgPerSecond: { unit: "kg/s" },
    specificEnthalpyKjPerKg: { unit: "kJ/kg" },
    enthalpyFlowkW: { unit: "kW" }
  },
  editor: {
    visualRole: "boundary",
    summaryOutput: "massFlowKgPerSecond"
  },

  validate(modelComponent) {
    const seriesId = modelComponent.parameters.massFlowSeriesId ??
      materialSourceDefinition.parameters.massFlowSeriesId.default;
    const specificEnthalpy = modelComponent.parameters.specificEnthalpyKjPerKg ??
      materialSourceDefinition.parameters.specificEnthalpyKjPerKg.default;
    const diagnostics = [];
    if (typeof seriesId !== "string" || seriesId.length === 0) {
      diagnostics.push({
          code: "material.source.mass-flow-series-id",
          message: "massFlowSeriesId must be a non-empty scenario series ID"
      });
    }
    if (!Number.isFinite(specificEnthalpy)) {
      diagnostics.push({
        code: "material.source.specific-enthalpy",
        message: "specificEnthalpyKjPerKg must be finite"
      });
    }
    return diagnostics;
  },

  resolution: {
    describe(runtimeComponent, context) {
      const connection = singleConnection(runtimeComponent, context, "material-out");
      if (connection.from.component !== runtimeComponent) {
        throw resolutionError(
          "runtime.unsupported-material-topology",
          `${runtimeComponent.id}.material-out must be the connection source`
        );
      }
      return resolutionDescription({ determines: [connection.id] });
    }
  },

  model: {
    prepare(modelComponent, context) {
      const massFlowSeriesId = modelComponent.parameters.massFlowSeriesId;
      const series = context.scenario.series.find(({ id }) => id === massFlowSeriesId);
      if (!series) {
        throw new Error(`Scenario series does not exist: ${massFlowSeriesId}`);
      }
      if (series.unit !== "kg/s") {
        throw new Error(`Scenario series ${massFlowSeriesId} must use kg/s, not ${series.unit}`);
      }
      return { massFlowSeriesId };
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      return {
        massFlowKgPerSecond: massFlowKgPerSecond(runtimeComponent, stepContext),
        specificEnthalpyKjPerKg:
          runtimeComponent.parameters.specificEnthalpyKjPerKg
      };
    },

    resolve(runtimeComponent, context) {
      const connection = singleConnection(runtimeComponent, context, "material-out");
      const flow = createMaterialFlow(context.operatingLimits);
      return {
        feasibleCommand: null,
        actualCommand: flow,
        connectionFlows: { [connection.id]: flow }
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      const flow = createMaterialFlow(actualCommand);
      return {
        portFlows: { "material-out": flow },
        outputs: {
          ...flow,
          enthalpyFlowkW: materialEnthalpyFlowkW(flow)
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
