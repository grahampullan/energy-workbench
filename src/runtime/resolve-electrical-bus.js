import { createDiagnostic } from "../core/validation/validation-result.js";
import {
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../core/flow-types.js";
const BUS_TYPE = "electrical.bus";
const GRID_TYPE = "electrical.grid";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolverDiagnostic(code, message, stepIndex, path = "") {
  return createDiagnostic({
    code,
    message,
    path: `/steps/${stepIndex}${path}`
  });
}

function hasActivePowerPort(component) {
  return component.ports.some((port) => port.flowType === ACTIVE_POWER_FLOW_TYPE);
}

function prepareFeasibleCommands({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  diagnostics
}) {
  const feasibleCommands = new Map();

  for (const component of runtimeModel.components) {
    if (!hasActivePowerPort(component)) {
      continue;
    }
    const limits = limitsByComponentId.get(component.id);
    const request = requests[component.id];
    if (component.type === GRID_TYPE) {
      if (request) {
        diagnostics.push(resolverDiagnostic(
          "runtime.grid-policy-request",
          "The grid is the automatic balancing component and must not receive a policy request",
          stepIndex,
          `/components/${component.id}`
        ));
      }
      feasibleCommands.set(component.id, null);
      continue;
    }
    if (!request) {
      if (limits.minimumPowerkW !== limits.maximumPowerkW) {
        diagnostics.push(resolverDiagnostic(
          "runtime.missing-policy-request",
          `Policy did not request operation for controllable component: ${component.id}`,
          stepIndex,
          `/components/${component.id}`
        ));
        continue;
      }
      feasibleCommands.set(component.id, { powerkW: limits.minimumPowerkW });
      continue;
    }

    feasibleCommands.set(component.id, {
      powerkW: clamp(
        request.powerkW,
        limits.minimumPowerkW,
        limits.maximumPowerkW
      )
    });
  }

  return feasibleCommands;
}

function validateBusTopology(runtimeModel, stepIndex, diagnostics) {
  const buses = runtimeModel.components.filter((component) => component.type === BUS_TYPE);
  if (buses.length !== 1) {
    diagnostics.push(resolverDiagnostic(
      "runtime.electrical-bus-count",
      `Electrical bus runtime requires exactly one bus; received ${buses.length}`,
      stepIndex
    ));
    return null;
  }
  const [bus] = buses;
  const grids = runtimeModel.components.filter((component) => component.type === GRID_TYPE);
  if (grids.length !== 1) {
    diagnostics.push(resolverDiagnostic(
      "runtime.electrical-grid-count",
      `Electrical bus runtime requires exactly one grid boundary; received ${grids.length}`,
      stepIndex
    ));
    return null;
  }
  const [grid] = grids;

  for (const connection of runtimeModel.connections) {
    if (connection.flowType !== ACTIVE_POWER_FLOW_TYPE) {
      if (connection.flowType !== THERMAL_HEAT_FLOW_TYPE) {
        diagnostics.push(resolverDiagnostic(
          "runtime.unsupported-flow-type",
          `Runtime does not support connection flowType: ${connection.flowType}`,
          stepIndex,
          `/connections/${connection.id}`
        ));
      }
      continue;
    }
    const fromIsBus = connection.from.component === bus;
    const toIsBus = connection.to.component === bus;
    if (fromIsBus === toIsBus) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-electrical-topology",
        `Connection ${connection.id} must join the electrical bus to one external component`,
        stepIndex,
        `/connections/${connection.id}`
      ));
    }
  }

  for (const component of runtimeModel.components) {
    const electricalPorts = component.ports.filter((port) => port.flowType === ACTIVE_POWER_FLOW_TYPE);
    if (electricalPorts.length === 0) {
      continue;
    }
    if (component === bus) {
      if (electricalPorts.some((port) => port.connectionIds.length > 1)) {
        diagnostics.push(resolverDiagnostic(
          "runtime.unsupported-electrical-topology",
          `Each electrical bus terminal can have at most one connection: ${component.id}`,
          stepIndex,
          `/components/${component.id}`
        ));
      }
      continue;
    }
    if (electricalPorts.length !== 1 || electricalPorts[0].connectionIds.length !== 1) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-electrical-topology",
        `Bus-connected component ${component.id} requires exactly one connected electrical port`,
        stepIndex,
        `/components/${component.id}`
      ));
    }
  }

  return { bus, grid };
}

function allocateBalancedCommands({
  runtimeModel,
  bus,
  grid,
  feasibleCommands,
  limitsByComponentId,
  tolerancekW,
  stepIndex,
  diagnostics
}) {
  const actualCommands = new Map();
  const externalComponents = runtimeModel.components.filter(
    (component) => component !== bus && hasActivePowerPort(component)
  );

  for (const component of externalComponents) {
    actualCommands.set(
      component.id,
      component === grid ? { powerkW: 0 } : { ...feasibleCommands.get(component.id) }
    );
  }

  const nonGridPowerkW = externalComponents.reduce(
    (total, component) => component === grid
      ? total
      : total + actualCommands.get(component.id).powerkW,
    0
  );
  const requiredGridPowerkW = nonGridPowerkW === 0 ? 0 : -nonGridPowerkW;
  const gridLimits = limitsByComponentId.get(grid.id);
  if (
    requiredGridPowerkW < gridLimits.minimumPowerkW - tolerancekW ||
    requiredGridPowerkW > gridLimits.maximumPowerkW + tolerancekW
  ) {
    diagnostics.push(resolverDiagnostic(
      "runtime.electrical-balance-infeasible",
      `Electrical bus requires grid power ${requiredGridPowerkW} kW but ${grid.id} permits ${gridLimits.minimumPowerkW} to ${gridLimits.maximumPowerkW} kW`,
      stepIndex,
      `/components/${grid.id}`
    ));
  } else {
    actualCommands.set(grid.id, { powerkW: requiredGridPowerkW });
  }

  return { actualCommands };
}

function bindConnectionFlows(runtimeModel, bus, actualCommands) {
  const connectionFlows = new Map();
  const busPortPowerkW = Object.fromEntries(bus.ports.map((port) => [port.id, 0]));

  for (const connection of runtimeModel.connections) {
    if (connection.flowType !== ACTIVE_POWER_FLOW_TYPE) {
      continue;
    }
    const busIsFrom = connection.from.component === bus;
    const externalEndpoint = busIsFrom ? connection.to : connection.from;
    const externalPowerkW = actualCommands.get(externalEndpoint.component.id).powerkW;
    const powerkW = busIsFrom ? -externalPowerkW : externalPowerkW;

    connectionFlows.set(connection.id, { powerkW });
    const busPort = busIsFrom ? connection.from.port : connection.to.port;
    busPortPowerkW[busPort.id] = busIsFrom ? powerkW : -powerkW;
  }

  actualCommands.set(bus.id, {
    powerkW: 0,
    portPowerkW: busPortPowerkW
  });

  return connectionFlows;
}

export function resolveElectricalBus({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  tolerancekW
}) {
  const diagnostics = [];
  const topology = validateBusTopology(runtimeModel, stepIndex, diagnostics);
  const feasibleCommands = prepareFeasibleCommands({
    runtimeModel,
    requests,
    limitsByComponentId,
    stepIndex,
    diagnostics
  });

  if (!topology || diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }
  const { bus, grid } = topology;

  const { actualCommands } = allocateBalancedCommands({
    runtimeModel,
    bus,
    grid,
    feasibleCommands,
    limitsByComponentId,
    tolerancekW,
    stepIndex,
    diagnostics
  });
  if (diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }

  const connectionFlows = bindConnectionFlows(runtimeModel, bus, actualCommands);

  return {
    resolved: true,
    feasibleCommands,
    actualCommands,
    connectionFlows,
    diagnostics
  };
}
