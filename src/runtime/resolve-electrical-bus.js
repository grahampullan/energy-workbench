import { createDiagnostic } from "../core/validation/validation-result.js";

const ACTIVE_POWER_MEDIUM = "electricity.active-power";
const BUS_TYPE = "electrical.bus";

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

function prepareFeasibleCommands({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  diagnostics
}) {
  const feasibleCommands = new Map();

  for (const component of runtimeModel.components) {
    const limits = limitsByComponentId.get(component.id);
    const request = requests[component.id];
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

  for (const connection of runtimeModel.connections) {
    if (connection.medium !== ACTIVE_POWER_MEDIUM) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-medium",
        `Electrical bus runtime does not support medium: ${connection.medium}`,
        stepIndex,
        `/connections/${connection.id}`
      ));
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

  return bus;
}

function allocateBalancedCommands({
  runtimeModel,
  bus,
  feasibleCommands,
  limitsByComponentId,
  toleranceKw,
  stepIndex,
  diagnostics
}) {
  const actualCommands = new Map();
  const externalComponents = runtimeModel.components.filter((component) => component !== bus);

  for (const component of externalComponents) {
    actualCommands.set(component.id, { ...feasibleCommands.get(component.id) });
  }

  let residualPowerKw = externalComponents.reduce(
    (total, component) => total + actualCommands.get(component.id).powerKw,
    0
  );
  const controllableComponents = externalComponents.filter((component) => {
    const limits = limitsByComponentId.get(component.id);
    return limits.minimumPowerKw !== limits.maximumPowerKw;
  });

  if (controllableComponents.length > 1) {
    diagnostics.push(resolverDiagnostic(
      "runtime.unsupported-electrical-dispatch",
      "Electrical bus runtime currently permits only one controllable balancing component",
      stepIndex,
      `/components/${bus.id}`
    ));
    return { actualCommands, residualPowerKw };
  }

  if (residualPowerKw > toleranceKw) {
    for (const component of controllableComponents) {
      const actual = actualCommands.get(component.id);
      const minimum = limitsByComponentId.get(component.id).minimumPowerKw;
      const reduction = Math.min(residualPowerKw, actual.powerKw - minimum);
      actual.powerKw -= reduction;
      residualPowerKw -= reduction;
      if (residualPowerKw <= toleranceKw) {
        break;
      }
    }
  } else if (residualPowerKw < -toleranceKw) {
    for (const component of controllableComponents) {
      const actual = actualCommands.get(component.id);
      const maximum = limitsByComponentId.get(component.id).maximumPowerKw;
      const increase = Math.min(-residualPowerKw, maximum - actual.powerKw);
      actual.powerKw += increase;
      residualPowerKw += increase;
      if (residualPowerKw >= -toleranceKw) {
        break;
      }
    }
  }

  if (Math.abs(residualPowerKw) > toleranceKw) {
    diagnostics.push(resolverDiagnostic(
      "runtime.electrical-balance-infeasible",
      `Electrical bus cannot resolve a ${residualPowerKw} kW power residual within component limits`,
      stepIndex,
      `/components/${bus.id}`
    ));
  }

  return { actualCommands, residualPowerKw };
}

function bindConnectionFlows(runtimeModel, bus, actualCommands) {
  const connectionPowerKw = new Map();
  const busPortPowerKw = Object.fromEntries(bus.ports.map((port) => [port.id, 0]));

  for (const connection of runtimeModel.connections) {
    const busIsFrom = connection.from.component === bus;
    const externalEndpoint = busIsFrom ? connection.to : connection.from;
    const externalPowerKw = actualCommands.get(externalEndpoint.component.id).powerKw;
    const powerKw = busIsFrom ? -externalPowerKw : externalPowerKw;

    connectionPowerKw.set(connection.id, powerKw);
    const busPort = busIsFrom ? connection.from.port : connection.to.port;
    busPortPowerKw[busPort.id] = busIsFrom ? powerKw : -powerKw;
  }

  actualCommands.set(bus.id, {
    powerKw: 0,
    portPowerKw: busPortPowerKw
  });

  return connectionPowerKw;
}

export function resolveElectricalBus({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  toleranceKw
}) {
  const diagnostics = [];
  const bus = validateBusTopology(runtimeModel, stepIndex, diagnostics);
  const feasibleCommands = prepareFeasibleCommands({
    runtimeModel,
    requests,
    limitsByComponentId,
    stepIndex,
    diagnostics
  });

  if (!bus || diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }

  const { actualCommands } = allocateBalancedCommands({
    runtimeModel,
    bus,
    feasibleCommands,
    limitsByComponentId,
    toleranceKw,
    stepIndex,
    diagnostics
  });
  if (diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }

  const connectionPowerKw = bindConnectionFlows(runtimeModel, bus, actualCommands);

  return {
    resolved: true,
    feasibleCommands,
    actualCommands,
    connectionPowerKw,
    diagnostics
  };
}
