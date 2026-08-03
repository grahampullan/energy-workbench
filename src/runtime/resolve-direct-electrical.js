import { createDiagnostic } from "../core/validation/validation-result.js";

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

function validateDirectTopology(runtimeModel, stepIndex, diagnostics) {
  for (const component of runtimeModel.components) {
    const electricalPorts = component.ports.filter(
      (port) => port.medium === "electricity.active-power"
    );
    if (electricalPorts.length !== 1 || electricalPorts[0].connectionIds.length !== 1) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-electrical-topology",
        `Direct electrical runtime requires exactly one connected electrical port on ${component.id}`,
        stepIndex,
        `/components/${component.id}`
      ));
    }
  }

  for (const connection of runtimeModel.connections) {
    if (connection.medium !== "electricity.active-power") {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-medium",
        `Direct electrical runtime does not support medium: ${connection.medium}`,
        stepIndex,
        `/connections/${connection.id}`
      ));
    }
  }
}

export function resolveDirectElectrical({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepIndex,
  toleranceKw
}) {
  const diagnostics = [];
  validateDirectTopology(runtimeModel, stepIndex, diagnostics);
  const feasibleCommands = prepareFeasibleCommands({
    runtimeModel,
    requests,
    limitsByComponentId,
    stepIndex,
    diagnostics
  });

  if (diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }

  const actualCommands = new Map();
  const connectionPowerKw = new Map();

  for (const connection of runtimeModel.connections) {
    const source = connection.from.component;
    const load = connection.to.component;
    const sourceLimits = limitsByComponentId.get(source.id);
    const loadLimits = limitsByComponentId.get(load.id);

    if (
      sourceLimits.minimumPowerKw < -toleranceKw ||
      loadLimits.maximumPowerKw > toleranceKw ||
      Math.abs(loadLimits.maximumPowerKw - loadLimits.minimumPowerKw) > toleranceKw
    ) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-electrical-role",
        `Connection ${connection.id} must join a non-negative source to a fixed non-positive load`,
        stepIndex,
        `/connections/${connection.id}`
      ));
      continue;
    }

    const requiredPowerKw = -loadLimits.minimumPowerKw;
    if (
      requiredPowerKw < sourceLimits.minimumPowerKw - toleranceKw ||
      requiredPowerKw > sourceLimits.maximumPowerKw + toleranceKw
    ) {
      diagnostics.push(resolverDiagnostic(
        "runtime.electrical-balance-infeasible",
        `Connection ${connection.id} requires ${requiredPowerKw} kW but source ${source.id} permits ${sourceLimits.minimumPowerKw} to ${sourceLimits.maximumPowerKw} kW`,
        stepIndex,
        `/connections/${connection.id}`
      ));
      continue;
    }

    actualCommands.set(source.id, { powerKw: requiredPowerKw });
    actualCommands.set(load.id, { powerKw: -requiredPowerKw });
    connectionPowerKw.set(connection.id, requiredPowerKw);
  }

  return {
    resolved: diagnostics.length === 0,
    feasibleCommands,
    actualCommands,
    connectionPowerKw,
    diagnostics
  };
}
