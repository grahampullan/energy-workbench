import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolveSinglePortActivePower,
  singlePortActivePowerResolution
} from "./resolve-single-active-power-port.js";

export const electricalGridDefinition = {
  type: "electrical.grid",
  version: "0.2.0",
  name: "Electrical grid",
  explanation: {
    title: "Grid import and export",
    summary: "A bidirectional boundary supplies or receives electrical power within declared import and export limits.",
    equations: [
      { label: "Power limits", tex: String.raw`-P_{\mathrm{export,max}}\leq P\leq P_{\mathrm{import,max}}` },
      { label: "Import and export", tex: String.raw`\begin{aligned}P_{\mathrm{import}}&=\max(0,P)\\P_{\mathrm{export}}&=\max(0,-P)\end{aligned}` }
    ],
    symbols: [
      { tex: "P", description: "Net power; positive supplies the model and negative exports from it", unit: "kW" },
      { tex: String.raw`P_{\mathrm{import}},P_{\mathrm{export}}`, description: "Non-negative import and export rates", unit: "kW" },
      { tex: String.raw`P_{\mathrm{import,max}},P_{\mathrm{export,max}}`, description: "Import and export limits", unit: "kW" }
    ],
    notes: ["When assigned the balancing role, the grid accepts the power required at its connected terminal. Otherwise an explicit power target is required.", "The boundary has no energy storage, voltage, frequency, tariff, or emissions model."]
  },

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
