export const electricalGridDefinition = {
  type: "electrical.grid",
  version: "0.1.0",
  name: "Electrical grid",

  parameters: {
    maximumImportPowerKw: {
      unit: "kW",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 1000, step: 10 }
    },
    maximumExportPowerKw: {
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
      medium: "electricity.active-power",
      direction: "bidirectional"
    }
  ],

  outputs: {
    importPowerKw: { unit: "kW" },
    exportPowerKw: { unit: "kW" },
    netPowerKw: { unit: "kW" }
  },

  editor: {
    groups: [
      {
        id: "limits",
        label: "Grid limits",
        parameters: ["maximumImportPowerKw", "maximumExportPowerKw"]
      }
    ]
  },

  validate() {
    return [];
  },

  model: {
    prepare() {
      return {};
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent) {
      return {
        minimumPowerKw: -runtimeComponent.parameters.maximumExportPowerKw,
        maximumPowerKw: runtimeComponent.parameters.maximumImportPowerKw
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      const netPowerKw = actualCommand.powerKw;
      return {
        portFlows: {
          electricity: { powerKw: netPowerKw }
        },
        outputs: {
          importPowerKw: Math.max(0, netPowerKw),
          exportPowerKw: Math.max(0, -netPowerKw),
          netPowerKw
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
