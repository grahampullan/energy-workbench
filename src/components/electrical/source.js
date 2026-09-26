import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolveSinglePortActivePower,
  singlePortActivePowerResolution
} from "./resolve-single-active-power-port.js";

export const electricalSourceDefinition = {
  type: "electrical.source",
  version: "0.2.0",
  name: "Electrical source",
  explanation: {
    title: "Controllable electrical supply",
    summary: "The source supplies electrical power within its declared output rating.",
    equations: [{ label: "Output capability", tex: String.raw`0\leq P\leq P_{\max}` }],
    symbols: [
      { tex: "P", description: "Actual electrical output", unit: "kW" },
      { tex: String.raw`P_{\max}`, description: "Maximum output rating", unit: "kW" }
    ],
    notes: ["Operation follows a policy target or an explicitly assigned balancing role. Fuel, conversion loss, ramp rate, and stored energy are not modelled."]
  },

  parameters: {
    maximumPowerkW: {
      unit: "kW",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 1000, step: 10 }
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
    powerkW: { unit: "kW" }
  },

  editor: {
    visualRole: "equipment",
    groups: [
      { id: "rating", label: "Rating", parameters: ["maximumPowerkW"] }
    ]
  },

  validate() {
    return [];
  },

  resolution: singlePortActivePowerResolution("electricity-out"),

  model: {
    prepare() {
      return {};
    },

    initialise(runtimeComponent) {
      return runtimeComponent.initialState;
    },

    getOperatingLimits(runtimeComponent) {
      return {
        minimumPowerkW: 0,
        maximumPowerkW: runtimeComponent.parameters.maximumPowerkW
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
      return {
        portFlows: {
          "electricity-out": { powerkW: actualCommand.powerkW }
        },
        outputs: {
          powerkW: actualCommand.powerkW
        },
        nextState: stepContext.state,
        diagnostics: []
      };
    }
  }
};
