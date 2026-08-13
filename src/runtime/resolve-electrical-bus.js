import { createDiagnostic } from "../core/validation/validation-result.js";
import { THERMAL_FLOW_MEDIUM } from "../core/thermal-flow.js";

const ACTIVE_POWER_MEDIUM = "electricity.active-power";
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
  return component.ports.some((port) => port.medium === ACTIVE_POWER_MEDIUM);
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
          "The grid is the residual balancing component and must not receive a policy request",
          stepIndex,
          `/components/${component.id}`
        ));
      }
      feasibleCommands.set(component.id, null);
      continue;
    }
    if (!request) {
      if (limits.minimumPowerKw !== limits.maximumPowerKw) {
        diagnostics.push(resolverDiagnostic(
          "runtime.missing-policy-request",
          `Policy did not request operation for controllable component: ${component.id}`,
          stepIndex,
          `/components/${component.id}`
        ));
        continue;
      }
      feasibleCommands.set(component.id, { powerKw: limits.minimumPowerKw });
      continue;
    }

    feasibleCommands.set(component.id, {
      powerKw: clamp(
        request.powerKw,
        limits.minimumPowerKw,
        limits.maximumPowerKw
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
    if (connection.medium !== ACTIVE_POWER_MEDIUM) {
      if (connection.medium !== THERMAL_FLOW_MEDIUM) {
        diagnostics.push(resolverDiagnostic(
          "runtime.unsupported-medium",
          `Runtime does not support connection medium: ${connection.medium}`,
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
    const electricalPorts = component.ports.filter((port) => port.medium === ACTIVE_POWER_MEDIUM);
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
  toleranceKw,
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
      component === grid ? { powerKw: 0 } : { ...feasibleCommands.get(component.id) }
    );
  }

  const nonGridPowerKw = externalComponents.reduce(
    (total, component) => component === grid
      ? total
      : total + actualCommands.get(component.id).powerKw,
    0
  );
  const requiredGridPowerKw = nonGridPowerKw === 0 ? 0 : -nonGridPowerKw;
  const gridLimits = limitsByComponentId.get(grid.id);
  if (
    requiredGridPowerKw < gridLimits.minimumPowerKw - toleranceKw ||
    requiredGridPowerKw > gridLimits.maximumPowerKw + toleranceKw
  ) {
    diagnostics.push(resolverDiagnostic(
      "runtime.electrical-balance-infeasible",
      `Electrical bus requires grid power ${requiredGridPowerKw} kW but ${grid.id} permits ${gridLimits.minimumPowerKw} to ${gridLimits.maximumPowerKw} kW`,
      stepIndex,
      `/components/${grid.id}`
    ));
  } else {
    actualCommands.set(grid.id, { powerKw: requiredGridPowerKw });
  }

  return { actualCommands };
}

function bindConnectionFlows(runtimeModel, bus, actualCommands) {
  const connectionFlows = new Map();
  const busPortPowerKw = Object.fromEntries(bus.ports.map((port) => [port.id, 0]));

  for (const connection of runtimeModel.connections) {
    if (connection.medium !== ACTIVE_POWER_MEDIUM) {
      continue;
    }
    const busIsFrom = connection.from.component === bus;
    const externalEndpoint = busIsFrom ? connection.to : connection.from;
    const externalPowerKw = actualCommands.get(externalEndpoint.component.id).powerKw;
    const powerKw = busIsFrom ? -externalPowerKw : externalPowerKw;

    connectionFlows.set(connection.id, { powerKw });
    const busPort = busIsFrom ? connection.from.port : connection.to.port;
    busPortPowerKw[busPort.id] = busIsFrom ? powerKw : -powerKw;
  }

  actualCommands.set(bus.id, {
    powerKw: 0,
    portPowerKw: busPortPowerKw
  });

  return connectionFlows;
}

export function resolveElectricalBus({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  toleranceKw
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
    toleranceKw,
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
