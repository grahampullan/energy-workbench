import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";
import { createDiagnostic } from "../core/validation/validation-result.js";
import {
  commitComponentStates,
  evaluateRuntimeComponents,
  getComponentOperatingLimits,
  initialiseComponentStates,
  resolveRuntimeComponents
} from "./component-execution.js";
import { checkConnectionBalances } from "./connection-execution.js";
import { requestPolicyOperation } from "./policy-request.js";
import { prepareResolutionPlan } from "./prepare-resolution-plan.js";
import { prepareRuntimeModel } from "./prepare-runtime-model.js";

const DEFAULT_BALANCE_TOLERANCE_KILOWATTS = 1e-9;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runtimeDiagnostic(code, message, path = "") {
  return createDiagnostic({ code, message, path });
}

function failure(diagnostics) {
  return {
    completed: false,
    results: null,
    diagnostics
  };
}

function hasErrors(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function runtimeScenario(runtimeModel) {
  return Object.freeze({
    id: runtimeModel.scenarioId,
    name: runtimeModel.scenarioName,
    time: runtimeModel.time,
    series: runtimeModel.series
  });
}

function unresolvedSeriesDiagnostics(runtimeModel) {
  return runtimeModel.series.flatMap((series, seriesIndex) =>
    series.data.kind === "inline"
      ? []
      : [runtimeDiagnostic(
          "runtime.unresolved-series",
          `Scenario series must be materialised before running: ${series.id}`,
          `/series/${seriesIndex}/data`
        )]
  );
}

function seriesValuesForStep(runtimeModel, stepIndex) {
  return freezeJsonValue(Object.fromEntries(
    runtimeModel.series.map((series) => [series.id, series.data.values[stepIndex]])
  ));
}

function createStepContext(runtimeModel, states, stepIndex) {
  const timeStepSeconds = runtimeModel.time.timeStepSeconds;
  return Object.freeze({
    stepIndex,
    timeStepSeconds,
    durationHours: timeStepSeconds / 3600,
    elapsedSeconds: stepIndex * timeStepSeconds,
    seriesValues: seriesValuesForStep(runtimeModel, stepIndex),
    states
  });
}

function stepResults({
  runtimeModel,
  stepContext,
  operation,
  limitsByComponentId,
  resolutionPlan,
  resolution,
  evaluationsByComponentId,
  connections
}) {
  return {
    stepIndex: stepContext.stepIndex,
    elapsedSeconds: stepContext.elapsedSeconds,
    resolutionPlan: {
      stages: resolutionPlan.stages
    },
    components: runtimeModel.components.map((component) => {
      const evaluation = evaluationsByComponentId.get(component.id);
      return {
        componentId: component.id,
        requestedCommand: operation.targets[component.id] ?? null,
        operatingLimits: limitsByComponentId.get(component.id),
        feasibleCommand: resolution.feasibleCommands.get(component.id),
        actualCommand: resolution.actualCommands.get(component.id),
        portFlows: evaluation.portFlows,
        outputs: evaluation.outputs,
        state: evaluation.nextState
      };
    }),
    connections
  };
}

export function runScenario({ model, scenario, policy, registry, options = {} } = {}) {
  if (!policy || typeof policy.request !== "function") {
    throw new TypeError("A policy with a request function is required");
  }
  if (!isRecord(options)) {
    throw new TypeError("Runtime options must be an object");
  }
  const tolerancekW = options.balanceTolerancekW ?? DEFAULT_BALANCE_TOLERANCE_KILOWATTS;
  if (!Number.isFinite(tolerancekW) || tolerancekW < 0) {
    throw new TypeError("balanceTolerancekW must be a finite, non-negative number");
  }

  const preparation = prepareRuntimeModel({ model, scenario, registry });
  const diagnostics = [...preparation.diagnostics];
  if (!preparation.prepared) {
    return failure(diagnostics);
  }

  const { runtimeModel } = preparation;
  diagnostics.push(...unresolvedSeriesDiagnostics(runtimeModel));
  if (hasErrors(diagnostics)) {
    return failure(diagnostics);
  }

  let states = initialiseComponentStates(
    runtimeModel,
    runtimeScenario(runtimeModel),
    diagnostics
  );
  if (hasErrors(diagnostics)) {
    return failure(diagnostics);
  }

  const initialStates = runtimeModel.components.map((component) => ({
    componentId: component.id,
    state: cloneJsonValue(states[component.id])
  }));
  const steps = [];

  for (let stepIndex = 0; stepIndex < runtimeModel.time.stepCount; stepIndex += 1) {
    const stepContext = createStepContext(runtimeModel, states, stepIndex);
    const limitsByComponentId = getComponentOperatingLimits(
      runtimeModel,
      stepContext,
      diagnostics
    );
    if (hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    const operation = requestPolicyOperation(
      policy,
      runtimeModel,
      stepContext,
      limitsByComponentId,
      diagnostics
    );
    if (operation === null || hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    const planPreparation = prepareResolutionPlan({
      runtimeModel,
      operation,
      limitsByComponentId,
      stepIndex
    });
    diagnostics.push(...planPreparation.diagnostics);
    if (!planPreparation.prepared || hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    const resolution = resolveRuntimeComponents(
      runtimeModel,
      planPreparation.plan,
      operation,
      limitsByComponentId,
      stepContext,
      tolerancekW,
      diagnostics
    );
    if (!resolution.resolved) {
      return failure(diagnostics);
    }

    const evaluationsByComponentId = evaluateRuntimeComponents(
      runtimeModel,
      resolution.actualCommands,
      stepContext,
      diagnostics
    );
    if (hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    const connections = checkConnectionBalances(
      runtimeModel,
      evaluationsByComponentId,
      resolution.connectionFlows,
      stepIndex,
      tolerancekW,
      diagnostics
    );
    if (hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    steps.push(stepResults({
      runtimeModel,
      stepContext,
      operation,
      limitsByComponentId,
      resolutionPlan: planPreparation.plan,
      resolution,
      evaluationsByComponentId,
      connections
    }));
    states = commitComponentStates(runtimeModel, evaluationsByComponentId);
  }

  return {
    completed: true,
    results: {
      modelId: runtimeModel.modelId,
      scenarioId: runtimeModel.scenarioId,
      time: cloneJsonValue(runtimeModel.time),
      initialStates,
      steps
    },
    diagnostics
  };
}
