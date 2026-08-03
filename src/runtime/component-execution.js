import {
  cloneJsonValue,
  freezeJsonValue,
  NonJsonValueError
} from "../core/json-value.js";
import { createDiagnostic } from "../core/validation/validation-result.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runtimeDiagnostic(code, message, path = "") {
  return createDiagnostic({ code, message, path });
}

function cloneAndFreeze(value) {
  return freezeJsonValue(cloneJsonValue(value));
}

function componentStepContext(stepContext, component) {
  return Object.freeze({
    ...stepContext,
    state: stepContext.states[component.id]
  });
}

function hasExactFields(value, declaredFields) {
  const fields = Object.keys(value);
  return fields.length === declaredFields.size &&
    fields.every((field) => declaredFields.has(field));
}

export function initialiseComponentStates(runtimeModel, scenario, diagnostics) {
  const states = {};

  runtimeModel.components.forEach((component, componentIndex) => {
    let returnedState;
    try {
      returnedState = component.definition.model.initialise(component, scenario);
    } catch (error) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-initialisation-failed",
        `${component.type} initialisation failed: ${error.message}`,
        `/components/${componentIndex}`
      ));
      return;
    }

    if (!isRecord(returnedState)) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-initialisation-contract",
        `${component.type}.model.initialise must return a plain object`,
        `/components/${componentIndex}`
      ));
      return;
    }

    try {
      const state = cloneAndFreeze(returnedState);
      const declaredStateIds = new Set(Object.keys(component.definition.initialState));
      if (!hasExactFields(state, declaredStateIds)) {
        diagnostics.push(runtimeDiagnostic(
          "runtime.component-initialisation-contract",
          `${component.type}.model.initialise must return every declared state field and no others`,
          `/components/${componentIndex}`
        ));
        return;
      }
      states[component.id] = state;
    } catch (error) {
      if (!(error instanceof NonJsonValueError)) {
        throw error;
      }
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-initialisation-contract",
        `${component.type}.model.initialise must return JSON-compatible state: ${error.message}`,
        `/components/${componentIndex}`
      ));
    }
  });

  return freezeJsonValue(states);
}

export function getComponentOperatingLimits(runtimeModel, stepContext, diagnostics) {
  const limitsByComponentId = new Map();

  runtimeModel.components.forEach((component) => {
    const path = `/steps/${stepContext.stepIndex}/components/${component.id}`;
    let limits;
    try {
      limits = component.definition.model.getOperatingLimits(
        component,
        componentStepContext(stepContext, component)
      );
    } catch (error) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-limits-failed",
        `${component.type} operating limits failed: ${error.message}`,
        path
      ));
      return;
    }

    if (
      !isRecord(limits) ||
      Object.keys(limits).length !== 2 ||
      !Number.isFinite(limits.minimumPowerKw) ||
      !Number.isFinite(limits.maximumPowerKw) ||
      limits.minimumPowerKw > limits.maximumPowerKw
    ) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-limits-contract",
        `${component.type}.model.getOperatingLimits must return finite minimumPowerKw and maximumPowerKw values in order`,
        path
      ));
      return;
    }

    limitsByComponentId.set(component.id, Object.freeze({
      minimumPowerKw: limits.minimumPowerKw,
      maximumPowerKw: limits.maximumPowerKw
    }));
  });

  return limitsByComponentId;
}

function appendEvaluationDiagnostics(
  returnedDiagnostics,
  component,
  stepIndex,
  diagnostics
) {
  if (!Array.isArray(returnedDiagnostics)) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-evaluation-contract",
      `${component.type}.model.evaluate diagnostics must be an array`,
      `/steps/${stepIndex}/components/${component.id}`
    ));
    return;
  }

  try {
    for (const diagnostic of returnedDiagnostics) {
      diagnostics.push(createDiagnostic({
        severity: diagnostic.severity ?? "error",
        code: diagnostic.code,
        message: diagnostic.message,
        path: `/steps/${stepIndex}/components/${component.id}${diagnostic.path ?? ""}`
      }));
    }
  } catch (error) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-evaluation-contract",
      `${component.type}.model.evaluate returned an invalid diagnostic: ${error.message}`,
      `/steps/${stepIndex}/components/${component.id}`
    ));
  }
}

function validateEvaluationShape(evaluation, component, stepIndex, diagnostics) {
  const path = `/steps/${stepIndex}/components/${component.id}`;
  if (
    !isRecord(evaluation) ||
    !isRecord(evaluation.portFlows) ||
    !isRecord(evaluation.outputs) ||
    !isRecord(evaluation.nextState)
  ) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-evaluation-contract",
      `${component.type}.model.evaluate must return portFlows, outputs, nextState, and diagnostics`,
      path
    ));
    return;
  }

  appendEvaluationDiagnostics(
    evaluation.diagnostics,
    component,
    stepIndex,
    diagnostics
  );

  const declaredPortIds = new Set(component.ports.map((port) => port.id));
  if (!hasExactFields(evaluation.portFlows, declaredPortIds)) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-port-flow-contract",
      `${component.type}.model.evaluate must return one flow for every declared port`,
      `${path}/portFlows`
    ));
  }
  for (const [portId, flow] of Object.entries(evaluation.portFlows)) {
    if (!isRecord(flow) || !Number.isFinite(flow.powerKw) || flow.powerKw < 0) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-port-flow-contract",
        `Port ${portId} must return a finite, non-negative powerKw flow`,
        `${path}/portFlows/${portId}`
      ));
    }
  }

  const declaredOutputIds = new Set(Object.keys(component.definition.outputs));
  if (
    !hasExactFields(evaluation.outputs, declaredOutputIds) ||
    Object.values(evaluation.outputs).some((value) => !Number.isFinite(value))
  ) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-output-contract",
      `${component.type}.model.evaluate must return one finite number for every declared output`,
      `${path}/outputs`
    ));
  }

  const declaredStateIds = new Set(Object.keys(component.definition.initialState));
  if (!hasExactFields(evaluation.nextState, declaredStateIds)) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-state-contract",
      `${component.type}.model.evaluate must return every declared state field and no others`,
      `${path}/nextState`
    ));
  }
}

export function evaluateRuntimeComponents(
  runtimeModel,
  actualCommands,
  stepContext,
  diagnostics
) {
  const evaluationsByComponentId = new Map();

  for (const component of runtimeModel.components) {
    let returnedEvaluation;
    try {
      returnedEvaluation = component.definition.model.evaluate(
        component,
        actualCommands.get(component.id),
        componentStepContext(stepContext, component)
      );
    } catch (error) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-evaluation-failed",
        `${component.type} evaluation failed: ${error.message}`,
        `/steps/${stepContext.stepIndex}/components/${component.id}`
      ));
      continue;
    }

    let evaluation;
    try {
      evaluation = cloneJsonValue(returnedEvaluation);
    } catch (error) {
      if (!(error instanceof NonJsonValueError)) {
        throw error;
      }
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-evaluation-contract",
        `${component.type}.model.evaluate must return JSON-compatible data: ${error.message}`,
        `/steps/${stepContext.stepIndex}/components/${component.id}`
      ));
      continue;
    }

    validateEvaluationShape(
      evaluation,
      component,
      stepContext.stepIndex,
      diagnostics
    );
    evaluationsByComponentId.set(component.id, evaluation);
  }

  return evaluationsByComponentId;
}

export function commitComponentStates(runtimeModel, evaluationsByComponentId) {
  return freezeJsonValue(Object.fromEntries(
    runtimeModel.components.map((component) => [
      component.id,
      cloneAndFreeze(evaluationsByComponentId.get(component.id).nextState)
    ])
  ));
}
