import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function connectionFlowForComponentPower(component, connection, powerkW) {
  return {
    powerkW: connection.from.componentId === component.id ? powerkW : -powerkW
  };
}

export function componentPowerFromConnection(component, connection, flow) {
  const powerkW = connection.from.componentId === component.id
    ? flow.powerkW
    : -flow.powerkW;
  return powerkW === 0 ? 0 : powerkW;
}

export function singlePortActivePowerResolution(portId) {
  return {
    describe(component, context) {
      const connection = singleConnection(component, context, portId);
      if (context.role === "electrical-balance") {
        return resolutionDescription({ connectionFlows: [connection.id] });
      }
      const { minimumPowerkW, maximumPowerkW } = context.operatingLimits;
      return resolutionDescription({
        targets: minimumPowerkW === maximumPowerkW ? [] : [component.id],
        determines: [connection.id]
      });
    }
  };
}

export function resolveSinglePortActivePower(component, context, portId) {
  const connection = singleConnection(component, context, portId);
  const { minimumPowerkW, maximumPowerkW } = context.operatingLimits;

  if (context.role === "electrical-balance") {
    const flow = context.getConnectionFlow(connection.id);
    if (flow === undefined) {
      return null;
    }
    const powerkW = componentPowerFromConnection(component, connection, flow);
    if (
      powerkW < minimumPowerkW - context.tolerancekW ||
      powerkW > maximumPowerkW + context.tolerancekW
    ) {
      throw resolutionError(
        "runtime.electrical-balance-infeasible",
        `Balancing requires ${powerkW} kW but ${component.id} permits ${minimumPowerkW} to ${maximumPowerkW} kW`
      );
    }
    return {
      feasibleCommand: null,
      actualCommand: { powerkW },
      connectionFlows: {}
    };
  }

  let powerkW;
  if (minimumPowerkW === maximumPowerkW) {
    if (context.target !== null) {
      throw resolutionError(
        "runtime.component-over-specified",
        `Fixed component ${component.id} cannot also receive a policy target`
      );
    }
    powerkW = minimumPowerkW;
  } else {
    if (!context.target || !Number.isFinite(context.target.powerkW)) {
      throw resolutionError(
        "runtime.missing-policy-target",
        `Policy did not provide a finite power target for ${component.id}`
      );
    }
    powerkW = clamp(context.target.powerkW, minimumPowerkW, maximumPowerkW);
  }

  const command = { powerkW };
  return {
    feasibleCommand: command,
    actualCommand: command,
    connectionFlows: {
      [connection.id]: connectionFlowForComponentPower(
        component,
        connection,
        powerkW
      )
    }
  };
}
