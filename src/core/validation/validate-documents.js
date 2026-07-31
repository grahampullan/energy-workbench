import { validateDocumentStructure } from "./document-validator.js";
import { createDiagnostic, createValidationResult } from "./validation-result.js";

function requireRegistry(registry) {
  if (!registry || typeof registry.get !== "function" || typeof registry.hasType !== "function") {
    throw new TypeError("A component registry is required");
  }
}

function requireModel(model) {
  if (!model || !Array.isArray(model.components)) {
    throw new TypeError("A structurally valid model is required");
  }
}

function reportDuplicateValues(items, valueForItem, diagnostics, { code, label, pathSegment }) {
  const firstIndexByValue = new Map();

  items.forEach((item, index) => {
    const value = valueForItem(item);
    if (!firstIndexByValue.has(value)) {
      firstIndexByValue.set(value, index);
      return;
    }

    diagnostics.push(createDiagnostic({
      code,
      message: `${label} is duplicated: ${value}`,
      path: `/${pathSegment}/${index}`
    }));
  });
}

function validateParameterValue({
  value,
  specification,
  diagnostics,
  path,
  hardBoundsCode,
  validityRangeCode
}) {
  const { hardBounds, validityRange } = specification;

  if (hardBounds) {
    if (typeof value !== "number") {
      diagnostics.push(createDiagnostic({
        code: hardBoundsCode,
        message: "A parameter with numeric hard bounds must have a numeric value",
        path
      }));
    } else {
      if (hardBounds.minimum !== undefined && value < hardBounds.minimum) {
        diagnostics.push(createDiagnostic({
          code: hardBoundsCode,
          message: `Value ${value} is below hard minimum ${hardBounds.minimum}`,
          path
        }));
      }
      if (hardBounds.maximum !== undefined && value > hardBounds.maximum) {
        diagnostics.push(createDiagnostic({
          code: hardBoundsCode,
          message: `Value ${value} is above hard maximum ${hardBounds.maximum}`,
          path
        }));
      }
    }
  }

  if (validityRange && typeof value === "number") {
    if (validityRange.minimum !== undefined && value < validityRange.minimum) {
      diagnostics.push(createDiagnostic({
        severity: "warning",
        code: validityRangeCode,
        message: `Value ${value} is below model validity minimum ${validityRange.minimum}`,
        path
      }));
    }
    if (validityRange.maximum !== undefined && value > validityRange.maximum) {
      diagnostics.push(createDiagnostic({
        severity: "warning",
        code: validityRangeCode,
        message: `Value ${value} is above model validity maximum ${validityRange.maximum}`,
        path
      }));
    }
  }
}

function validateComponentParameters(component, definition, componentIndex, diagnostics) {
  const parameterSpecifications = definition.parameters;

  for (const parameter of Object.keys(component.parameters)) {
    if (!Object.hasOwn(parameterSpecifications, parameter)) {
      diagnostics.push(createDiagnostic({
        code: "model.unknown-parameter",
        message: `${definition.type} does not declare parameter: ${parameter}`,
        path: `/components/${componentIndex}/parameters/${parameter}`
      }));
    }
  }

  for (const [parameter, specification] of Object.entries(parameterSpecifications)) {
    const value = Object.hasOwn(component.parameters, parameter)
      ? component.parameters[parameter]
      : specification.default;

    validateParameterValue({
      value,
      specification,
      diagnostics,
      path: `/components/${componentIndex}/parameters/${parameter}`,
      hardBoundsCode: "model.parameter-hard-bound",
      validityRangeCode: "model.parameter-validity-range"
    });
  }
}

function appendComponentDiagnostics(component, definition, componentIndex, model, registry, diagnostics) {
  let returnedDiagnostics;
  try {
    returnedDiagnostics = definition.validate(component, { model, registry });
  } catch (error) {
    diagnostics.push(createDiagnostic({
      code: "model.component-validation-failed",
      message: `${definition.type} validation failed: ${error.message}`,
      path: `/components/${componentIndex}`
    }));
    return;
  }

  if (returnedDiagnostics === undefined) {
    return;
  }
  if (!Array.isArray(returnedDiagnostics)) {
    diagnostics.push(createDiagnostic({
      code: "model.component-validation-contract",
      message: `${definition.type}.validate must return an array or undefined`,
      path: `/components/${componentIndex}`
    }));
    return;
  }

  try {
    for (const diagnostic of returnedDiagnostics) {
      diagnostics.push(createDiagnostic({
        severity: diagnostic.severity ?? "error",
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.path ?? `/components/${componentIndex}`
      }));
    }
  } catch (error) {
    diagnostics.push(createDiagnostic({
      code: "model.component-validation-contract",
      message: `${definition.type}.validate returned an invalid diagnostic: ${error.message}`,
      path: `/components/${componentIndex}`
    }));
  }
}

function resolvePort({ endpoint, endpointName, connectionIndex, componentsById, definitionsByComponentId, diagnostics }) {
  const component = componentsById.get(endpoint.componentId);
  if (!component) {
    diagnostics.push(createDiagnostic({
      code: "model.dangling-component-reference",
      message: `Connection references missing component: ${endpoint.componentId}`,
      path: `/connections/${connectionIndex}/${endpointName}/componentId`
    }));
    return null;
  }

  const definition = definitionsByComponentId.get(component.id);
  if (!definition) {
    return null;
  }

  const port = definition.ports.find((candidate) => candidate.id === endpoint.portId);
  if (!port) {
    diagnostics.push(createDiagnostic({
      code: "model.dangling-port-reference",
      message: `${definition.type} does not declare port: ${endpoint.portId}`,
      path: `/connections/${connectionIndex}/${endpointName}/portId`
    }));
    return null;
  }

  return port;
}

export function validateModel(model, { registry } = {}) {
  const structuralResult = validateDocumentStructure("model", model);
  if (!structuralResult.valid) {
    return structuralResult;
  }
  requireRegistry(registry);

  const diagnostics = [];
  reportDuplicateValues(model.components, (component) => component.id, diagnostics, {
    code: "model.duplicate-component-id",
    label: "Component ID",
    pathSegment: "components"
  });
  reportDuplicateValues(model.connections, (connection) => connection.id, diagnostics, {
    code: "model.duplicate-connection-id",
    label: "Connection ID",
    pathSegment: "connections"
  });

  const componentsById = new Map(model.components.map((component) => [component.id, component]));
  const definitionsByComponentId = new Map();

  model.components.forEach((component, componentIndex) => {
    const definition = registry.get(component.type, component.definitionVersion);
    if (!definition) {
      const knownType = registry.hasType(component.type);
      diagnostics.push(createDiagnostic({
        code: knownType ? "model.unsupported-definition-version" : "model.unknown-component-type",
        message: knownType
          ? `No ${component.type} definition is registered at version ${component.definitionVersion}`
          : `No component definition is registered for type ${component.type}`,
        path: `/components/${componentIndex}/${knownType ? "definitionVersion" : "type"}`
      }));
      return;
    }

    definitionsByComponentId.set(component.id, definition);
    validateComponentParameters(component, definition, componentIndex, diagnostics);
    appendComponentDiagnostics(component, definition, componentIndex, model, registry, diagnostics);
  });

  model.connections.forEach((connection, connectionIndex) => {
    if (connection.from.componentId === connection.to.componentId) {
      diagnostics.push(createDiagnostic({
        code: "model.self-connection",
        message: "A connection must join two different components",
        path: `/connections/${connectionIndex}`
      }));
    }

    const fromPort = resolvePort({
      endpoint: connection.from,
      endpointName: "from",
      connectionIndex,
      componentsById,
      definitionsByComponentId,
      diagnostics
    });
    const toPort = resolvePort({
      endpoint: connection.to,
      endpointName: "to",
      connectionIndex,
      componentsById,
      definitionsByComponentId,
      diagnostics
    });

    if (!fromPort || !toPort) {
      return;
    }
    if (fromPort.direction !== "out" && fromPort.direction !== "bidirectional") {
      diagnostics.push(createDiagnostic({
        code: "model.invalid-from-port-direction",
        message: `From port ${fromPort.id} does not permit outgoing flow`,
        path: `/connections/${connectionIndex}/from/portId`
      }));
    }
    if (toPort.direction !== "in" && toPort.direction !== "bidirectional") {
      diagnostics.push(createDiagnostic({
        code: "model.invalid-to-port-direction",
        message: `To port ${toPort.id} does not permit incoming flow`,
        path: `/connections/${connectionIndex}/to/portId`
      }));
    }
    if (fromPort.medium !== toPort.medium) {
      diagnostics.push(createDiagnostic({
        code: "model.incompatible-port-media",
        message: `Cannot connect ${fromPort.medium} to ${toPort.medium}`,
        path: `/connections/${connectionIndex}`
      }));
    }
  });

  return createValidationResult(diagnostics);
}

export function validateScenario(scenario) {
  const structuralResult = validateDocumentStructure("scenario", scenario);
  if (!structuralResult.valid) {
    return structuralResult;
  }

  const diagnostics = [];
  reportDuplicateValues(scenario.series, (series) => series.id, diagnostics, {
    code: "scenario.duplicate-series-id",
    label: "Series ID",
    pathSegment: "series"
  });

  scenario.series.forEach((series, seriesIndex) => {
    if (series.data.kind === "inline" && series.data.values.length !== scenario.time.stepCount) {
      diagnostics.push(createDiagnostic({
        code: "scenario.series-length",
        message: `Expected ${scenario.time.stepCount} values but received ${series.data.values.length}`,
        path: `/series/${seriesIndex}/data/values`
      }));
    }
  });

  return createValidationResult(diagnostics);
}

export function validateLayout(layout, { model } = {}) {
  const structuralResult = validateDocumentStructure("layout", layout);
  if (!structuralResult.valid) {
    return structuralResult;
  }
  requireModel(model);

  const diagnostics = [];
  if (layout.modelId !== model.id) {
    diagnostics.push(createDiagnostic({
      code: "layout.model-id",
      message: `Layout targets ${layout.modelId}, not supplied model ${model.id}`,
      path: "/modelId"
    }));
  }

  reportDuplicateValues(layout.components, (component) => component.componentId, diagnostics, {
    code: "layout.duplicate-component-id",
    label: "Layout component ID",
    pathSegment: "components"
  });

  const componentIds = new Set(model.components.map((component) => component.id));
  layout.components.forEach((component, componentIndex) => {
    if (!componentIds.has(component.componentId)) {
      diagnostics.push(createDiagnostic({
        code: "layout.dangling-component-reference",
        message: `Layout references missing component: ${component.componentId}`,
        path: `/components/${componentIndex}/componentId`
      }));
    }
  });

  return createValidationResult(diagnostics);
}

export function validateVariant(variant, { model, registry } = {}) {
  const structuralResult = validateDocumentStructure("variant", variant);
  if (!structuralResult.valid) {
    return structuralResult;
  }
  requireModel(model);
  requireRegistry(registry);

  const diagnostics = [];
  if (variant.baseModelId !== model.id) {
    diagnostics.push(createDiagnostic({
      code: "variant.model-id",
      message: `Variant targets ${variant.baseModelId}, not supplied model ${model.id}`,
      path: "/baseModelId"
    }));
  }

  reportDuplicateValues(
    variant.parameterOverrides,
    (override) => `${override.componentId}.${override.parameter}`,
    diagnostics,
    {
      code: "variant.duplicate-parameter-override",
      label: "Parameter override",
      pathSegment: "parameterOverrides"
    }
  );

  const componentsById = new Map(model.components.map((component) => [component.id, component]));
  variant.parameterOverrides.forEach((override, overrideIndex) => {
    const component = componentsById.get(override.componentId);
    if (!component) {
      diagnostics.push(createDiagnostic({
        code: "variant.dangling-component-reference",
        message: `Variant references missing component: ${override.componentId}`,
        path: `/parameterOverrides/${overrideIndex}/componentId`
      }));
      return;
    }

    const definition = registry.get(component.type, component.definitionVersion);
    if (!definition) {
      diagnostics.push(createDiagnostic({
        code: "variant.unknown-component-definition",
        message: `No ${component.type} definition is registered at version ${component.definitionVersion}`,
        path: `/parameterOverrides/${overrideIndex}/componentId`
      }));
      return;
    }
    const specification = definition.parameters[override.parameter];
    if (!specification) {
      diagnostics.push(createDiagnostic({
        code: "variant.unknown-parameter",
        message: `${definition.type} does not declare parameter: ${override.parameter}`,
        path: `/parameterOverrides/${overrideIndex}/parameter`
      }));
      return;
    }

    validateParameterValue({
      value: override.value,
      specification,
      diagnostics,
      path: `/parameterOverrides/${overrideIndex}/value`,
      hardBoundsCode: "variant.parameter-hard-bound",
      validityRangeCode: "variant.parameter-validity-range"
    });
  });

  return createValidationResult(diagnostics);
}
