import { cloneJsonValue } from "../core/json-value.js";
import {
  connectionFlowsMatch,
  flowValidationMessage
} from "../core/flow-types.js";
import { createDiagnostic } from "../core/validation/validation-result.js";

function runtimeDiagnostic(code, message, path) {
  return createDiagnostic({ code, message, path });
}

function evaluatedEndpointFlow(evaluationsByComponentId, endpoint, connectionId) {
  const portFlowValue = evaluationsByComponentId.get(endpoint.component.id)
    .portFlows[endpoint.port.id];
  return endpoint.port.cardinality === "many"
    ? portFlowValue?.[connectionId]
    : portFlowValue;
}

export function checkConnectionBalances(
  runtimeModel,
  evaluationsByComponentId,
  connectionFlows,
  stepIndex,
  tolerance,
  diagnostics
) {
  return runtimeModel.connections.map((connection) => {
    const expectedFlow = connectionFlows.get(connection.id);
    const fromFlow = evaluatedEndpointFlow(
      evaluationsByComponentId,
      connection.from,
      connection.id
    );
    const toFlow = evaluatedEndpointFlow(
      evaluationsByComponentId,
      connection.to,
      connection.id
    );
    const path = `/steps/${stepIndex}/connections/${connection.id}`;
    const validationMessage = flowValidationMessage(
      connection.flowType,
      expectedFlow,
      { direction: connection.from.port.direction }
    );

    if (validationMessage) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.connection-flow-contract",
        `Connection ${connection.id} has an invalid settled flow: ${validationMessage}`,
        path
      ));
    } else if (!connectionFlowsMatch(
      connection.flowType,
      expectedFlow,
      fromFlow,
      toFlow,
      {
        toDirection: connection.to.port.direction,
        powerTolerancekW: tolerance
      }
    )) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.connection-balance",
        `Connection ${connection.id} endpoint flows do not match its settled flow`,
        path
      ));
    }

    return {
      connectionId: connection.id,
      flowType: connection.flowType,
      flow: expectedFlow === undefined ? null : cloneJsonValue(expectedFlow)
    };
  });
}
