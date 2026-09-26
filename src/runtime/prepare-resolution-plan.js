import { freezeJsonValue } from "../core/json-value.js";
import { createDiagnostic } from "../core/validation/validation-result.js";
import { createPhysicalContext } from "./physical-context.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, message, stepIndex, path) {
  return createDiagnostic({
    code,
    message,
    path: `/steps/${stepIndex}${path}`
  });
}

function connectionsFor(runtimeModel, component) {
  return runtimeModel.connections.filter((connection) =>
    connection.from.component === component || connection.to.component === component
  );
}

function hasUniqueStrings(values) {
  return Array.isArray(values) &&
    values.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(values).size === values.length;
}

function normaliseDescription(description) {
  if (
    !isRecord(description) ||
    !isRecord(description.requires) ||
    !hasUniqueStrings(description.requires.targets) ||
    !hasUniqueStrings(description.requires.connectionFlows) ||
    !hasUniqueStrings(description.determines)
  ) {
    return null;
  }
  return {
    requires: {
      targets: [...description.requires.targets],
      connectionFlows: [...description.requires.connectionFlows]
    },
    determines: [...description.determines]
  };
}

function describeComponents({
  runtimeModel,
  operation,
  limitsByComponentId,
  stepIndex,
  diagnostics
}) {
  const descriptions = [];
  for (const component of runtimeModel.components) {
    let returnedDescription;
    try {
      returnedDescription = component.definition.resolution.describe(
        component,
        createPhysicalContext({ runtimeModel, component, operation, limitsByComponentId })
      );
    } catch (error) {
      diagnostics.push(diagnostic(
        error.code ?? "runtime.component-resolution-declaration-failed",
        `${component.type} resolution declaration failed: ${error.message}`,
        stepIndex,
        `/components/${component.id}/resolution`
      ));
      continue;
    }

    const description = normaliseDescription(returnedDescription);
    if (description === null) {
      diagnostics.push(diagnostic(
        "runtime.component-resolution-declaration-contract",
        `${component.type}.resolution.describe must return requires and determines declarations`,
        stepIndex,
        `/components/${component.id}/resolution`
      ));
      continue;
    }
    descriptions.push({ component, ...description });
  }
  return descriptions;
}

function determineConnectionOwnership({
  runtimeModel,
  descriptions,
  operation,
  stepIndex,
  diagnostics
}) {
  const connectionsById = new Map(
    runtimeModel.connections.map((connection) => [connection.id, connection])
  );
  const determinersByConnectionId = new Map(
    runtimeModel.connections.map((connection) => [connection.id, []])
  );

  for (const description of descriptions) {
    const componentId = description.component.id;
    const connectedIds = new Set(
      connectionsFor(runtimeModel, description.component).map(({ id }) => id)
    );
    const targetOwners = new Set([componentId]);
    for (const connection of connectionsFor(runtimeModel, description.component)) {
      const remote = connection.from.component === description.component ? connection.to : connection.from;
      const port = remote.component.definition.ports.find(({ id }) => id === remote.port.id);
      if (port.boundary?.target?.length) targetOwners.add(remote.component.id);
    }
    for (const targetId of description.requires.targets) {
      if (!targetOwners.has(targetId)) {
        diagnostics.push(diagnostic(
          "runtime.component-resolution-declaration-contract",
          `${componentId} requires a target not published through its connections: ${targetId}`,
          stepIndex,
          `/components/${componentId}/resolution/requires/targets`
        ));
      } else if (!Object.hasOwn(operation.targets, targetId)) {
        diagnostics.push(diagnostic(
          "runtime.missing-policy-target",
          `Resolution of ${componentId} requires a policy target for ${targetId}`,
          stepIndex,
          `/components/${componentId}/resolution/requires/targets`
        ));
      }
    }
    for (const connectionId of [
      ...description.requires.connectionFlows,
      ...description.determines
    ]) {
      if (!connectionsById.has(connectionId) || !connectedIds.has(connectionId)) {
        diagnostics.push(diagnostic(
          "runtime.component-resolution-declaration-contract",
          `${componentId} declared unconnected flow ${connectionId}`,
          stepIndex,
          `/components/${componentId}/resolution`
        ));
      }
    }
    for (const connectionId of description.determines) {
      determinersByConnectionId.get(connectionId)?.push(componentId);
    }
  }

  for (const connection of runtimeModel.connections) {
    const determiners = determinersByConnectionId.get(connection.id);
    if (determiners.length === 0) {
      diagnostics.push(diagnostic(
        "runtime.missing-connection-determiner",
        `Connection ${connection.id} has no component that determines its flow`,
        stepIndex,
        `/connections/${connection.id}`
      ));
    } else if (determiners.length > 1) {
      diagnostics.push(diagnostic(
        "runtime.conflicting-connection-determiners",
        `Connection ${connection.id} is determined by more than one component: ${determiners.join(", ")}`,
        stepIndex,
        `/connections/${connection.id}`
      ));
    }
  }
  return determinersByConnectionId;
}

function deriveStages({
  runtimeModel,
  descriptions,
  determinersByConnectionId,
  stepIndex,
  diagnostics
}) {
  const componentIds = runtimeModel.components.map(({ id }) => id);
  const dependencies = new Map(componentIds.map((id) => [id, new Set()]));
  const dependants = new Map(componentIds.map((id) => [id, new Set()]));

  for (const description of descriptions) {
    for (const connectionId of description.requires.connectionFlows) {
      const determiners = determinersByConnectionId.get(connectionId) ?? [];
      if (determiners.length === 1) {
        dependencies.get(description.component.id).add(determiners[0]);
        dependants.get(determiners[0]).add(description.component.id);
      }
    }
  }

  const remaining = new Map(
    componentIds.map((id) => [id, dependencies.get(id).size])
  );
  const stages = [];
  let ready = componentIds.filter((id) => remaining.get(id) === 0);
  let plannedCount = 0;
  while (ready.length > 0) {
    stages.push(ready);
    plannedCount += ready.length;
    const nextReady = new Set();
    for (const componentId of ready) {
      for (const dependantId of dependants.get(componentId)) {
        remaining.set(dependantId, remaining.get(dependantId) - 1);
        if (remaining.get(dependantId) === 0) {
          nextReady.add(dependantId);
        }
      }
    }
    ready = componentIds.filter((id) => nextReady.has(id));
  }

  if (plannedCount !== componentIds.length) {
    const cyclicIds = componentIds.filter((id) => remaining.get(id) > 0);
    diagnostics.push(diagnostic(
      "runtime.resolution-dependency-cycle",
      `Same-step resolution dependency cycle involves: ${cyclicIds.join(", ")}`,
      stepIndex,
      "/resolution-plan"
    ));
  }
  return stages;
}

export function prepareResolutionPlan({
  runtimeModel,
  operation,
  limitsByComponentId,
  stepIndex = 0
} = {}) {
  const diagnostics = [];
  const descriptions = describeComponents({
    runtimeModel,
    operation,
    limitsByComponentId,
    stepIndex,
    diagnostics
  });
  if (descriptions.length !== runtimeModel.components.length) {
    return { prepared: false, plan: null, diagnostics };
  }
  const determinersByConnectionId = determineConnectionOwnership({
    runtimeModel,
    descriptions,
    operation,
    stepIndex,
    diagnostics
  });
  const stages = deriveStages({
    runtimeModel,
    descriptions,
    determinersByConnectionId,
    stepIndex,
    diagnostics
  });
  const prepared = diagnostics.every(({ severity }) => severity !== "error");
  return {
    prepared,
    plan: prepared
      ? freezeJsonValue({
          stages,
          components: descriptions.map(({ component, requires, determines }) => ({
            componentId: component.id,
            requires,
            determines
          }))
        })
      : null,
    diagnostics
  };
}
