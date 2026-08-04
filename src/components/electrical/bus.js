const terminalIds = ["terminal-1", "terminal-2", "terminal-3", "terminal-4"];

export const electricalBusDefinition = {
  type: "electrical.bus",
  version: "0.1.0",
  name: "Electrical bus",

  parameters: {},
  initialState: {},

  ports: terminalIds.map((id) => ({
    id,
    medium: "electricity.active-power",
    direction: "bidirectional"
  })),

  outputs: {
    balanceResidualPowerKw: { unit: "kW" }
  },

  editor: {},

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

    getOperatingLimits() {
      return {
        minimumPowerKw: 0,
        maximumPowerKw: 0
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      const portFlows = Object.fromEntries(runtimeComponent.ports.map((port) => [
        port.id,
        { powerKw: actualCommand.portPowerKw[port.id] }
      ]));
      const balanceResidualPowerKw = Object.values(portFlows).reduce(
        (total, flow) => total + flow.powerKw,
        0
      );

      return {
        portFlows,
        outputs: { balanceResidualPowerKw },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
