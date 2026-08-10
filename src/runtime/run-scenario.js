import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";
import { createDiagnostic } from "../core/validation/validation-result.js";
import {
  commitComponentStates,
  evaluateRuntimeComponents,
  getComponentOperatingLimits,
  initialiseComponentStates
} from "./component-execution.js";
import { requestPolicyOperation } from "./policy-request.js";
import { prepareRuntimeModel } from "./prepare-runtime-model.js";
import { resolveElectricalBus } from "./resolve-electrical-bus.js";

const DEFAULT_BALANCE_TOLERANCE_KW = 1e-9;

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

function checkConnectionBalances(
  runtimeModel,
  evaluationsByComponentId,
  connectionPowerKw,
  stepIndex,
  toleranceKw,
  diagnostics
) {
  return runtimeModel.connections.map((connection) => {
    const expectedPowerKw = connectionPowerKw.get(connection.id);
    const reportedFromPowerKw = evaluationsByComponentId.get(connection.from.component.id)
      .portFlows[connection.from.port.id].powerKw;
    const reportedToPowerKw = evaluationsByComponentId.get(connection.to.component.id)
      .portFlows[connection.to.port.id].powerKw;
    const fromPowerKw = reportedFromPowerKw;
    const toPowerKw = connection.to.port.direction === "bidirectional"
      ? -reportedToPowerKw
      : reportedToPowerKw;
    const residualPowerKw = fromPowerKw - toPowerKw;

    if (
      Math.abs(fromPowerKw - expectedPowerKw) > toleranceKw ||
      Math.abs(toPowerKw - expectedPowerKw) > toleranceKw
    ) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.connection-balance",
        `Connection ${connection.id} expected ${expectedPowerKw} kW but endpoints evaluated ${fromPowerKw} and ${toPowerKw} kW`,
        `/steps/${stepIndex}/connections/${connection.id}`
      ));
    }

    return {
      connectionId: connection.id,
      medium: connection.medium,
      powerKw: expectedPowerKw,
      residualPowerKw
    };
  });
}

function stepResults({
  runtimeModel,
  stepContext,
  requests,
  limitsByComponentId,
  resolution,
  evaluationsByComponentId,
  connections
}) {
  return {
    stepIndex: stepContext.stepIndex,
    elapsedSeconds: stepContext.elapsedSeconds,
    components: runtimeModel.components.map((component) => {
      const evaluation = evaluationsByComponentId.get(component.id);
      return {
        componentId: component.id,
        requestedCommand: requests[component.id] ?? null,
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
  const toleranceKw = options.balanceToleranceKw ?? DEFAULT_BALANCE_TOLERANCE_KW;
  if (!Number.isFinite(toleranceKw) || toleranceKw < 0) {
    throw new TypeError("balanceToleranceKw must be a finite, non-negative number");
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

    const requests = requestPolicyOperation(
      policy,
      runtimeModel,
      stepContext,
      limitsByComponentId,
      diagnostics
    );
    if (requests === null || hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    const resolution = resolveElectricalBus({
      runtimeModel,
      requests,
      limitsByComponentId,
      stepIndex,
      toleranceKw
    });
    diagnostics.push(...resolution.diagnostics);
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
      resolution.connectionPowerKw,
      stepIndex,
      toleranceKw,
      diagnostics
    );
    if (hasErrors(diagnostics)) {
      return failure(diagnostics);
    }

    steps.push(stepResults({
      runtimeModel,
      stepContext,
      requests,
      limitsByComponentId,
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
