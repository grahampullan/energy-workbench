export const electricalSourceDefinition = {
  type: "electrical.source",
  version: "0.2.0",
  name: "Electrical source",

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
    groups: [
      { id: "rating", label: "Rating", parameters: ["maximumPowerkW"] }
    ]
  },

  validate() {
    return [];
  },

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
import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
