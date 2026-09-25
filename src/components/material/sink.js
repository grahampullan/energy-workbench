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
