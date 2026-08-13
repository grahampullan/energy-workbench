const terminalIds = ["terminal-1", "terminal-2", "terminal-3", "terminal-4"];

export const electricalBusDefinition = {
  type: "electrical.bus",
  version: "0.2.0",
  name: "Electrical bus",

  parameters: {},
  initialState: {},

  ports: terminalIds.map((id) => ({
    id,
    flowType: ACTIVE_POWER_FLOW_TYPE,
    direction: "bidirectional"
  })),

  outputs: {
    powerBalanceErrorkW: { unit: "kW" }
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
        minimumPowerkW: 0,
        maximumPowerkW: 0
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      const portFlows = Object.fromEntries(runtimeComponent.ports.map((port) => [
        port.id,
        { powerkW: actualCommand.portPowerkW[port.id] }
      ]));
      const powerBalanceErrorkW = Object.values(portFlows).reduce(
        (total, flow) => total + flow.powerkW,
        0
      );

      return {
        portFlows,
        outputs: { powerBalanceErrorkW },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
