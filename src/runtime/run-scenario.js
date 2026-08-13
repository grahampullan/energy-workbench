import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";
import { THERMAL_FLOW_MEDIUM } from "../core/thermal-flow.js";
import { createDiagnostic } from "../core/validation/validation-result.js";
import {
  commitComponentStates,
  evaluateRuntimeComponents,
  getComponentOperatingLimits,
  initialiseComponentStates
} from "./component-execution.js";
import { requestPolicyOperation } from "./policy-request.js";
import { prepareRuntimeModel } from "./prepare-runtime-model.js";
import { resolveEnergyModel } from "./resolve-energy-model.js";

const DEFAULT_BALANCE_TOLERANCE_KW = 1e-9;
const DEFAULT_TEMPERATURE_TOLERANCE_C = 1e-9;
const ACTIVE_POWER_MEDIUM = "electricity.active-power";

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
  connectionFlows,
  stepIndex,
  toleranceKw,
  diagnostics
) {
  return runtimeModel.connections.map((connection) => {
    const expectedFlow = connectionFlows.get(connection.id);
    const fromFlow = evaluationsByComponentId.get(connection.from.component.id)
      .portFlows[connection.from.port.id];
    const reportedToFlow = evaluationsByComponentId.get(connection.to.component.id)
      .portFlows[connection.to.port.id];

    if (connection.medium === ACTIVE_POWER_MEDIUM) {
      const expectedPowerKw = expectedFlow?.powerKw;
      const fromPowerKw = fromFlow.powerKw;
      const toPowerKw = connection.to.port.direction === "bidirectional"
        ? -reportedToFlow.powerKw
        : reportedToFlow.powerKw;
      const residualPowerKw = fromPowerKw - toPowerKw;
      if (
        !Number.isFinite(expectedPowerKw) ||
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
    }

    if (connection.medium === THERMAL_FLOW_MEDIUM) {
      const residualHeatFlowKw = fromFlow.heatFlowKw - reportedToFlow.heatFlowKw;
      const heatBalanced =
        expectedFlow &&
        Math.abs(fromFlow.heatFlowKw - expectedFlow.heatFlowKw) <= toleranceKw &&
        Math.abs(reportedToFlow.heatFlowKw - expectedFlow.heatFlowKw) <= toleranceKw;
      const temperaturesBalanced = expectedFlow && [fromFlow, reportedToFlow].every(
        (flow) =>
          Math.abs(
            flow.sourceTemperatureC - expectedFlow.sourceTemperatureC
          ) <= DEFAULT_TEMPERATURE_TOLERANCE_C &&
          Math.abs(
            flow.deliveryTemperatureC - expectedFlow.deliveryTemperatureC
          ) <= DEFAULT_TEMPERATURE_TOLERANCE_C
      );
      if (!heatBalanced || !temperaturesBalanced) {
        diagnostics.push(runtimeDiagnostic(
          "runtime.connection-balance",
          `Thermal connection ${connection.id} endpoint flows do not match its allocated heat and temperatures`,
          `/steps/${stepIndex}/connections/${connection.id}`
        ));
      }

      return {
        connectionId: connection.id,
        medium: connection.medium,
        heatFlowKw: expectedFlow?.heatFlowKw,
        sourceTemperatureC: expectedFlow?.sourceTemperatureC,
        deliveryTemperatureC: expectedFlow?.deliveryTemperatureC,
        residualHeatFlowKw
      };
    }

    diagnostics.push(runtimeDiagnostic(
      "runtime.unsupported-medium",
      `Runtime does not support connection medium: ${connection.medium}`,
      `/steps/${stepIndex}/connections/${connection.id}`
    ));
    return {
      connectionId: connection.id,
      medium: connection.medium
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

    const resolution = resolveEnergyModel({
      runtimeModel,
      requests,
      limitsByComponentId,
      stepContext,
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
      resolution.connectionFlows,
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
