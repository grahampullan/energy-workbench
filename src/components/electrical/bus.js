import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  componentPowerFromConnection,
  connectionFlowForComponentPower
} from "./resolve-single-active-power-port.js";
import {
  resolutionDescription,
  resolutionError
} from "../model-resolution.js";

function busConnections(runtimeComponent, context) {
  const balancingConnections = context.connections.filter((connection) => {
    const remote = connection.from.componentId === runtimeComponent.id ? connection.to : connection.from;
    return remote.role === "electrical-balance";
  });
  if (balancingConnections.length !== 1) {
    throw resolutionError(
      "runtime.electrical-balancing-connection",
      `Bus ${runtimeComponent.id} requires exactly one connection to a balancing component`
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

  const connectionPowerkW = Object.fromEntries([...settledFlows].map(
    ([connection, flow]) => [
      connection.id,
      componentPowerFromConnection(runtimeComponent, connection, flow)
    ]
  ));

  return {
    feasibleCommand: { powerkW: 0 },
    actualCommand: { powerkW: 0, connectionPowerkW },
    connectionFlows: { [balancingConnection.id]: balancingFlow }
  };
}

export const electricalBusDefinition = {
  type: "electrical.bus",
  version: "0.3.0",
  name: "Electrical bus",
  explanation: {
    title: "Electrical power conservation",
    summary: "The bus connects electrical branches and conserves their instantaneous signed power.",
    equations: [{ label: "Terminal power balance", tex: String.raw`\sum_j P_j=0` }],
    symbols: [{ tex: "P_j", description: "Power at terminal j, positive into the bus and negative out", unit: "kW" }],
    notes: ["The bus is lossless and stores no energy. The model explicitly assigns the component that can accept residual power.", "Voltage, current, reactive power, and transmission losses are not represented."]
  },

  parameters: {},
  initialState: {},

  ports: [{
    id: "terminal",
    flowType: ACTIVE_POWER_FLOW_TYPE,
    direction: "bidirectional",
    cardinality: "many"
  }],

  outputs: {
    powerBalanceErrorkW: { unit: "kW" }
  },

  editor: { visualRole: "interaction" },

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
      const connectionFlows = Object.fromEntries(
        runtimeComponent.ports[0].connectionIds.map((connectionId) => [
          connectionId,
          { powerkW: actualCommand.connectionPowerkW[connectionId] }
        ])
      );
      const powerBalanceErrorkW = Object.values(connectionFlows).reduce(
        (total, flow) => total + flow.powerkW,
        0
      );

      return {
        portFlows: { terminal: connectionFlows },
        outputs: { powerBalanceErrorkW },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
