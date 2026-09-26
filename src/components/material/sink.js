import { MATERIAL_MASS_FLOW_TYPE } from "../../core/flow-types.js";
import {
  createMaterialFlow,
  materialEnthalpyFlowkW
} from "../../core/material-flow.js";
import {
  singleConnection,
  singlePortFlowConsumerResolution
} from "../model-resolution.js";

export const materialSinkDefinition = {
  type: "material.sink",
  version: "0.1.0",
  name: "Material sink",
  explanation: {
    title: "Material leaving the model",
    summary: "The sink records the material flow and specific enthalpy supplied by its upstream component.",
    equations: [{ label: "Received enthalpy", tex: String.raw`\dot H=\dot m h` }],
    symbols: [
      { tex: String.raw`\dot m`, description: "Received mass-flow rate", unit: "kg/s" },
      { tex: "h", description: "Received specific enthalpy", unit: "kJ/kg" },
      { tex: String.raw`\dot H`, description: "Received material enthalpy rate", unit: "kW" }
    ],
    notes: ["This boundary has no inventory, heat loss, or processing model. The upstream component determines the actual discharge."]
  },

  parameters: {},
  initialState: {},
  ports: [{
    id: "material-in",
    flowType: MATERIAL_MASS_FLOW_TYPE,
    direction: "in"
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
  validate() {
    return [];
  },
  resolution: singlePortFlowConsumerResolution("material-in"),

  model: {
    prepare() {
      return {};
    },
    initialise() {
      return {};
    },
    getOperatingLimits() {
      return {};
    },
    resolve(runtimeComponent, context) {
      const connection = singleConnection(runtimeComponent, context, "material-in");
      const flow = context.getConnectionFlow(connection.id);
      return flow === undefined
        ? null
        : { feasibleCommand: null, actualCommand: flow, connectionFlows: {} };
    },
    evaluate(runtimeComponent, actualCommand) {
      const flow = createMaterialFlow(actualCommand);
      return {
        portFlows: { "material-in": flow },
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
