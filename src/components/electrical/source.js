export const electricalSourceDefinition = {
  type: "electrical.source",
  version: "0.1.0",
  name: "Electrical source",

  parameters: {
    maximumPowerKw: {
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
      medium: "electricity.active-power",
      direction: "out"
    }
  ],

  outputs: {
    powerKw: { unit: "kW" }
  },

  editor: {
    groups: [
      { id: "rating", label: "Rating", parameters: ["maximumPowerKw"] }
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
        minimumPowerKw: 0,
        maximumPowerKw: runtimeComponent.parameters.maximumPowerKw
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      return {
        portFlows: {
          "electricity-out": { powerKw: actualCommand.powerKw }
        },
        outputs: {
          powerKw: actualCommand.powerKw
        },
        nextState: stepContext.state,
        diagnostics: []
      };
    }
  }
};
