import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolveSinglePortActivePower,
  singlePortActivePowerResolution
} from "./resolve-single-active-power-port.js";

export const electricalGridDefinition = {
  type: "electrical.grid",
  version: "0.2.0",
  name: "Electrical grid",

  parameters: {
    maximumImportPowerkW: {
      unit: "kW",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 1000, step: 10 }
    },
    maximumExportPowerkW: {
      unit: "kW",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 1000, step: 10 }
    }
  },

  initialState: {},

  ports: [
    {
      id: "electricity",
      flowType: ACTIVE_POWER_FLOW_TYPE,
      direction: "bidirectional"
    }
  ],

  outputs: {
    importPowerkW: { unit: "kW" },
    exportPowerkW: { unit: "kW" },
    netPowerkW: { unit: "kW" }
  },

  editor: {
    visualRole: "boundary",
    groups: [
      {
        id: "limits",
        label: "Grid limits",
        parameters: ["maximumImportPowerkW", "maximumExportPowerkW"]
      }
    ]
  },

  validate() {
    return [];
  },

  resolution: singlePortActivePowerResolution("electricity"),

  model: {
    prepare() {
      return {};
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent) {
      return {
        minimumPowerkW: -runtimeComponent.parameters.maximumExportPowerkW,
        maximumPowerkW: runtimeComponent.parameters.maximumImportPowerkW
      };
    },

    resolve(runtimeComponent, context) {
      return resolveSinglePortActivePower(runtimeComponent, context, "electricity");
    },

    evaluate(runtimeComponent, actualCommand) {
      const netPowerkW = actualCommand.powerkW;
      return {
        portFlows: {
          electricity: { powerkW: netPowerkW }
        },
        outputs: {
          importPowerkW: Math.max(0, netPowerkW),
          exportPowerkW: Math.max(0, -netPowerkW),
          netPowerkW
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
