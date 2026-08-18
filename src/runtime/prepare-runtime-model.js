import {
  cloneJsonValue,
  freezeJsonValue,
  NonJsonValueError
} from "../core/json-value.js";
import {
  validateModel,
  validateScenario
} from "../core/validation/validate-documents.js";
import { createDiagnostic } from "../core/validation/validation-result.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(diagnostics) {
  return {
    prepared: false,
    runtimeModel: null,
    diagnostics
  };
}

function success(runtimeModel, diagnostics) {
  return {
    prepared: true,
    runtimeModel,
    diagnostics
  };
}

function runtimeDiagnostic(code, message, path = "") {
  return createDiagnostic({ code, message, path });
}

function cloneInputs(model, scenario) {
  try {
    return {
      model: freezeJsonValue(cloneJsonValue(model)),
      scenario: freezeJsonValue(cloneJsonValue(scenario))
    };
  } catch (error) {
    if (error instanceof NonJsonValueError) {
      return {
        diagnostic: runtimeDiagnostic(
          "runtime.non-json-input",
          `Model and scenario must be JSON-compatible: ${error.message}`
        )
      };
    }
    throw error;
  }
}

function resolveValues(values, specifications) {
  return Object.fromEntries(
    Object.entries(specifications).map(([field, specification]) => [
      field,
      cloneJsonValue(Object.hasOwn(values, field) ? values[field] : specification.default)
    ])
  );
}

function resolvedModelComponent(component, definition) {
  return freezeJsonValue({
    ...cloneJsonValue(component),
    parameters: resolveValues(component.parameters, definition.parameters),
    initialState: resolveValues(component.initialState, definition.initialState)
  });
}

function resolveModel(model, registry) {
  return freezeJsonValue({
    ...cloneJsonValue(model),
    components: model.components.map((component) => resolvedModelComponent(
      component,
      registry.get(component.type, component.definitionVersion)
    ))
  });
}

function prepareComponent(component, definition, context, componentIndex, diagnostics) {
  let returnedData;
  try {
    returnedData = definition.model.prepare(component, context);
  } catch (error) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-preparation-failed",
      `${definition.type} preparation failed: ${error.message}`,
      `/components/${componentIndex}`
    ));
    return null;
  }

  if (!isRecord(returnedData)) {
    diagnostics.push(runtimeDiagnostic(
      "runtime.component-preparation-contract",
      `${definition.type}.model.prepare must return a plain object`,
      `/components/${componentIndex}`
    ));
    return null;
  }

  try {
    return freezeJsonValue(cloneJsonValue(returnedData));
  } catch (error) {
    if (error instanceof NonJsonValueError) {
      diagnostics.push(runtimeDiagnostic(
        "runtime.component-preparation-contract",
        `${definition.type}.model.prepare must return JSON-compatible data: ${error.message}`,
        `/components/${componentIndex}`
      ));
      return null;
    }
    throw error;
  }
}

function buildRuntimeComponents(model, scenario, registry, diagnostics) {
  const context = Object.freeze({ model, scenario });

  return model.components.map((component, componentIndex) => {
    const definition = registry.get(component.type, component.definitionVersion);
    const modelData = prepareComponent(
      component,
      definition,
      context,
      componentIndex,
      diagnostics
    );

    if (modelData === null) {
      return null;
    }

    return {
      id: component.id,
      type: component.type,
      definitionVersion: component.definitionVersion,
      name: component.name,
      definition,
      parameters: component.parameters,
      initialState: component.initialState,
      modelData,
      ports: definition.ports.map((port) => ({
        id: port.id,
        flowType: port.flowType,
        direction: port.direction,
        cardinality: port.cardinality ?? "one",
        connectionIds: []
      }))
    };
  });
}

function buildRuntimeConnections(model, runtimeComponents) {
  const componentsById = new Map(
    runtimeComponents.map((component) => [component.id, component])
  );

  const connections = model.connections.map((connection) => {
    const fromComponent = componentsById.get(connection.from.componentId);
    const toComponent = componentsById.get(connection.to.componentId);
    const fromPort = fromComponent.ports.find((port) => port.id === connection.from.portId);
    const toPort = toComponent.ports.find((port) => port.id === connection.to.portId);

    fromPort.connectionIds.push(connection.id);
    toPort.connectionIds.push(connection.id);

    return Object.freeze({
      id: connection.id,
      name: connection.name,
      flowType: fromPort.flowType,
      from: Object.freeze({ component: fromComponent, port: fromPort }),
      to: Object.freeze({ component: toComponent, port: toPort })
    });
  });

  for (const component of runtimeComponents) {
    for (const port of component.ports) {
      Object.freeze(port.connectionIds);
      Object.freeze(port);
    }
    Object.freeze(component.ports);
    Object.freeze(component);
  }

  return connections;
}

/**
 * Prepares detached, validated model and scenario documents for one runtime.
 * This resolves definitions, defaults, component-owned model data, ports, and
 * connections. It does not initialise state, load external data, or run steps.
 */
export function prepareRuntimeModel({ model, scenario, registry } = {}) {
  if (!registry || typeof registry.get !== "function" || typeof registry.hasType !== "function") {
    throw new TypeError("A component registry is required");
  }

  const inputs = cloneInputs(model, scenario);
  if (inputs.diagnostic) {
    return failure([inputs.diagnostic]);
  }

  const modelValidation = validateModel(inputs.model, { registry });
  const scenarioValidation = validateScenario(inputs.scenario);
  const diagnostics = [
    ...modelValidation.diagnostics,
    ...scenarioValidation.diagnostics
  ];

  if (!modelValidation.valid || !scenarioValidation.valid) {
    return failure(diagnostics);
  }

  const resolvedModel = resolveModel(inputs.model, registry);
  const components = buildRuntimeComponents(
    resolvedModel,
    inputs.scenario,
    registry,
    diagnostics
  );
  if (components.some((component) => component === null)) {
    return failure(diagnostics);
  }

  const connections = buildRuntimeConnections(resolvedModel, components);
  const runtimeModel = Object.freeze({
    modelId: inputs.model.id,
    modelName: inputs.model.name,
    scenarioId: inputs.scenario.id,
    scenarioName: inputs.scenario.name,
    time: inputs.scenario.time,
    series: inputs.scenario.series,
    components: Object.freeze(components),
    connections: Object.freeze(connections)
  });

  return success(runtimeModel, diagnostics);
}
