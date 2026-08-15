import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  componentPowerFromConnection,
  connectionFlowForComponentPower
} from "./resolve-single-active-power-port.js";
import {
  resolutionDescription,
  resolutionError
} from "../model-resolution.js";

const terminalIds = ["terminal-1", "terminal-2", "terminal-3", "terminal-4"];

function busConnections(runtimeComponent, context) {
  for (const port of runtimeComponent.ports) {
    const connectionCount = context.connections.filter((connection) =>
      (connection.from.component === runtimeComponent && connection.from.port === port) ||
      (connection.to.component === runtimeComponent && connection.to.port === port)
    ).length;
    if (connectionCount > 1) {
      throw resolutionError(
        "runtime.electrical-bus-terminal-count",
        `Bus terminal ${runtimeComponent.id}.${port.id} has more than one connection`
      );
    }
  }

  const balancingConnections = context.connections.filter((connection) => {
    const otherComponent = connection.from.component === runtimeComponent
      ? connection.to.component
      : connection.from.component;
    return otherComponent.id === context.balancingComponentId;
  });
  if (balancingConnections.length !== 1) {
    throw resolutionError(
      "runtime.electrical-balancing-connection",
      `Bus ${runtimeComponent.id} requires exactly one connection to balancing component ${context.balancingComponentId}`
    );
  }

  return {
    balancingConnection: balancingConnections[0],
    nonBalancingConnections: context.connections.filter(
      (connection) => connection !== balancingConnections[0]
    )
  };
}

function describeBusResolution(runtimeComponent, context) {
  const { balancingConnection, nonBalancingConnections } = busConnections(
    runtimeComponent,
    context
  );
  return resolutionDescription({
    connectionFlows: nonBalancingConnections.map((connection) => connection.id),
    determines: [balancingConnection.id]
  });
}

function resolveBus(runtimeComponent, context) {
  const { balancingConnection, nonBalancingConnections } = busConnections(
    runtimeComponent,
    context
  );

  const settledFlows = new Map();
  for (const connection of nonBalancingConnections) {
    const flow = context.getConnectionFlow(connection.id);
    if (flow === undefined) {
      return null;
    }
    settledFlows.set(connection, flow);
  }

  const nonBalancingPowerkW = [...settledFlows].reduce(
    (total, [connection, flow]) =>
      total + componentPowerFromConnection(runtimeComponent, connection, flow),
    0
  );
  const balancingPortPowerkW = nonBalancingPowerkW === 0
    ? 0
    : -nonBalancingPowerkW;
  const balancingFlow = connectionFlowForComponentPower(
    runtimeComponent,
    balancingConnection,
    balancingPortPowerkW
  );
  settledFlows.set(balancingConnection, balancingFlow);

  const portPowerkW = Object.fromEntries(
    runtimeComponent.ports.map((port) => [port.id, 0])
  );
  for (const [connection, flow] of settledFlows) {
    const port = connection.from.component === runtimeComponent
      ? connection.from.port
      : connection.to.port;
    portPowerkW[port.id] = componentPowerFromConnection(
      runtimeComponent,
      connection,
      flow
    );
  }

  return {
    feasibleCommand: { powerkW: 0 },
    actualCommand: { powerkW: 0, portPowerkW },
    connectionFlows: { [balancingConnection.id]: balancingFlow }
  };
}

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

  resolution: {
    describe(runtimeComponent, context) {
      return describeBusResolution(runtimeComponent, context);
    }
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

    resolve(runtimeComponent, context) {
      return resolveBus(runtimeComponent, context);
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
