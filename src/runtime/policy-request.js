import {
  cloneJsonValue,
  freezeJsonValue,
  NonJsonValueError
} from "../core/json-value.js";
import { createDiagnostic } from "../core/validation/validation-result.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function policyDiagnostic(code, message, stepIndex, path = "") {
  return createDiagnostic({
    code,
    message,
    path: `/steps/${stepIndex}/policy${path}`
  });
}

export function requestPolicyOperation(policy, runtimeModel, stepContext, diagnostics) {
  let returnedRequests;
  try {
    returnedRequests = policy.request(runtimeModel, stepContext);
  } catch (error) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-failed",
      `Policy request failed: ${error.message}`,
      stepContext.stepIndex
    ));
    return null;
  }

  if (!isRecord(returnedRequests)) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-contract",
      "Policy request must return an object keyed by component ID",
      stepContext.stepIndex
    ));
    return null;
  }

  let requests;
  try {
    requests = freezeJsonValue(cloneJsonValue(returnedRequests));
  } catch (error) {
    if (!(error instanceof NonJsonValueError)) {
      throw error;
    }
    diagnostics.push(policyDiagnostic(
      "runtime.policy-contract",
      `Policy requests must be JSON-compatible: ${error.message}`,
      stepContext.stepIndex
    ));
    return null;
  }

  const componentIds = new Set(runtimeModel.components.map((component) => component.id));
  for (const [componentId, command] of Object.entries(requests)) {
    if (!componentIds.has(componentId)) {
      diagnostics.push(policyDiagnostic(
        "runtime.policy-unknown-component",
        `Policy requested operation for unknown component: ${componentId}`,
        stepContext.stepIndex,
        `/${componentId}`
      ));
      continue;
    }
    if (
      !isRecord(command) ||
      Object.keys(command).length !== 1 ||
      !Object.hasOwn(command, "powerKw") ||
      !Number.isFinite(command.powerKw)
    ) {
      diagnostics.push(policyDiagnostic(
        "runtime.policy-command-contract",
        "An electrical policy command must contain only a finite powerKw value",
        stepContext.stepIndex,
        `/${componentId}`
      ));
    }
  }

  return requests;
}
