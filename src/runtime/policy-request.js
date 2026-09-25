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

function createPolicyContext(limitsByComponentId) {
  const operatingLimitsByComponentId = freezeJsonValue(cloneJsonValue(
    Object.fromEntries(limitsByComponentId)
  ));
  return Object.freeze({ operatingLimitsByComponentId });
}

export function requestPolicyOperation(
  policy,
  runtimeModel,
  stepContext,
  limitsByComponentId,
  diagnostics
) {
  let returnedOperation;
  try {
    returnedOperation = policy.request(
      runtimeModel,
      stepContext,
      createPolicyContext(limitsByComponentId)
    );
  } catch (error) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-failed",
      `Policy request failed: ${error.message}`,
      stepContext.stepIndex
    ));
    return null;
  }

  if (
    !isRecord(returnedOperation) ||
    !isRecord(returnedOperation.targets) ||
    !Object.hasOwn(returnedOperation, "balancingComponentId")
  ) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-contract",
      "Policy request must return targets and balancingComponentId",
      stepContext.stepIndex
    ));
    return null;
  }

  let operation;
  try {
    operation = freezeJsonValue(cloneJsonValue(returnedOperation));
  } catch (error) {
    if (!(error instanceof NonJsonValueError)) {
      throw error;
    }
    diagnostics.push(policyDiagnostic(
      "runtime.policy-contract",
      `Policy operation must be JSON-compatible: ${error.message}`,
      stepContext.stepIndex
    ));
    return null;
  }

  const componentIds = new Set(runtimeModel.components.map((component) => component.id));
  for (const [componentId, target] of Object.entries(operation.targets)) {
    if (!componentIds.has(componentId)) {
      diagnostics.push(policyDiagnostic(
        "runtime.policy-unknown-component",
        `Policy requested operation for unknown component: ${componentId}`,
        stepContext.stepIndex,
        `/${componentId}`
      ));
      continue;
    }
    if (!isRecord(target)) {
      diagnostics.push(policyDiagnostic(
        "runtime.policy-target-contract",
        "A policy target must be an object",
        stepContext.stepIndex,
        `/${componentId}`
      ));
    }
  }

  if (
    operation.balancingComponentId !== null &&
    (
      typeof operation.balancingComponentId !== "string" ||
      operation.balancingComponentId.length === 0 ||
      !componentIds.has(operation.balancingComponentId)
    )
  ) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-balancing-component",
      `Policy balancing component does not exist: ${operation.balancingComponentId}`,
      stepContext.stepIndex,
      "/balancingComponentId"
    ));
  }
  if (
    operation.balancingComponentId !== null &&
    Object.hasOwn(operation.targets, operation.balancingComponentId)
  ) {
    diagnostics.push(policyDiagnostic(
      "runtime.policy-over-specified",
      "The balancing component cannot also receive a target",
      stepContext.stepIndex,
      `/targets/${operation.balancingComponentId}`
    ));
  }

  return operation;
}
