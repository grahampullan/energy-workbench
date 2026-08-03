import { cloneJsonValue, NonJsonValueError } from "./json-value.js";
import { validateModel } from "./validation/validate-documents.js";
import { validateDocumentStructure } from "./validation/document-validator.js";
import { createDiagnostic } from "./validation/validation-result.js";

const commandHandlers = new Map([
  ["setParameter", setParameter],
  ["unsetParameter", unsetParameter],
  ["addComponent", addComponent],
  ["removeComponent", removeComponent],
  ["connectPorts", connectPorts],
  ["disconnectPorts", disconnectPorts]
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reject(model, diagnostics) {
  return {
    applied: false,
    model,
    inverseCommand: null,
    diagnostics
  };
}

function accept(model, inverseCommand, diagnostics) {
  return {
    applied: true,
    model,
    inverseCommand,
    diagnostics
  };
}

function commandError(code, message, path = "") {
  return createDiagnostic({ code, message, path });
}

function requireString(command, field, diagnostics) {
  const value = command[field];
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(commandError(
      "command.invalid-field",
      `${field} must be a non-empty string`,
      `/${field}`
    ));
    return null;
  }
  return value;
}

function insertionIndex(command, collectionLength, diagnostics) {
  if (command.index === undefined) {
    return collectionLength;
  }
  if (
    !Number.isInteger(command.index) ||
    command.index < 0 ||
    command.index > collectionLength
  ) {
    diagnostics.push(commandError(
      "command.invalid-index",
      `index must be an integer from 0 to ${collectionLength}`,
      "/index"
    ));
    return null;
  }
  return command.index;
}

function findComponent(model, componentId, diagnostics) {
  const componentIndex = model.components.findIndex((component) => component.id === componentId);
  if (componentIndex === -1) {
    diagnostics.push(commandError(
      "command.component-not-found",
      `Component does not exist: ${componentId}`,
      "/componentId"
    ));
    return null;
  }
  return { component: model.components[componentIndex], componentIndex };
}

function findParameter(model, command, registry, diagnostics) {
  const componentId = requireString(command, "componentId", diagnostics);
  const parameter = requireString(command, "parameter", diagnostics);
  if (!componentId || !parameter) {
    return null;
  }

  const found = findComponent(model, componentId, diagnostics);
  if (!found) {
    return null;
  }

  const { component } = found;
  const definition = registry.get(component.type, component.definitionVersion);
  if (!definition) {
    diagnostics.push(commandError(
      "command.component-definition-not-found",
      `No ${component.type} definition is registered at version ${component.definitionVersion}`,
      "/componentId"
    ));
    return null;
  }
  if (!Object.hasOwn(definition.parameters, parameter)) {
    diagnostics.push(commandError(
      "command.parameter-not-found",
      `${definition.type} does not declare parameter: ${parameter}`,
      "/parameter"
    ));
    return null;
  }

  return { ...found, componentId, parameter };
}

function setParameter(model, command, registry) {
  const diagnostics = [];
  const target = findParameter(model, command, registry, diagnostics);
  if (!Object.hasOwn(command, "value")) {
    diagnostics.push(commandError(
      "command.invalid-field",
      "setParameter requires a value",
      "/value"
    ));
  }
  if (!target || diagnostics.length > 0) {
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const component = candidate.components[target.componentIndex];
  const hadValue = Object.hasOwn(component.parameters, target.parameter);
  const previousValue = component.parameters[target.parameter];
  component.parameters[target.parameter] = cloneJsonValue(command.value);

  const inverseCommand = hadValue
    ? {
        type: "setParameter",
        componentId: target.componentId,
        parameter: target.parameter,
        value: cloneJsonValue(previousValue)
      }
    : {
        type: "unsetParameter",
        componentId: target.componentId,
        parameter: target.parameter
      };

  return { candidate, inverseCommand, diagnostics };
}

function unsetParameter(model, command, registry) {
  const diagnostics = [];
  const target = findParameter(model, command, registry, diagnostics);
  if (!target || diagnostics.length > 0) {
    return { diagnostics };
  }
  if (!Object.hasOwn(target.component.parameters, target.parameter)) {
    diagnostics.push(commandError(
      "command.parameter-not-set",
      `Parameter already uses its definition default: ${target.parameter}`,
      "/parameter"
    ));
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const component = candidate.components[target.componentIndex];
  const previousValue = cloneJsonValue(component.parameters[target.parameter]);
  delete component.parameters[target.parameter];

  return {
    candidate,
    inverseCommand: {
      type: "setParameter",
      componentId: target.componentId,
      parameter: target.parameter,
      value: previousValue
    },
    diagnostics
  };
}

function addComponent(model, command) {
  const diagnostics = [];
  if (!isRecord(command.component)) {
    diagnostics.push(commandError(
      "command.invalid-field",
      "addComponent requires a component object",
      "/component"
    ));
    return { diagnostics };
  }

  const index = insertionIndex(command, model.components.length, diagnostics);
  if (index === null) {
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const component = cloneJsonValue(command.component);
  candidate.components.splice(index, 0, component);

  return {
    candidate,
    inverseCommand: {
      type: "removeComponent",
      componentId: component.id
    },
    diagnostics
  };
}

function removeComponent(model, command) {
  const diagnostics = [];
  const componentId = requireString(command, "componentId", diagnostics);
  if (!componentId) {
    return { diagnostics };
  }

  const found = findComponent(model, componentId, diagnostics);
  if (!found) {
    return { diagnostics };
  }

  const incidentConnections = model.connections.filter((connection) =>
    connection.from.componentId === componentId || connection.to.componentId === componentId
  );
  if (incidentConnections.length > 0) {
    diagnostics.push(commandError(
      "command.component-connected",
      `Disconnect component ${componentId} before removing it`,
      "/componentId"
    ));
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const [component] = candidate.components.splice(found.componentIndex, 1);

  return {
    candidate,
    inverseCommand: {
      type: "addComponent",
      component,
      index: found.componentIndex
    },
    diagnostics
  };
}

function connectPorts(model, command) {
  const diagnostics = [];
  if (!isRecord(command.connection)) {
    diagnostics.push(commandError(
      "command.invalid-field",
      "connectPorts requires a connection object",
      "/connection"
    ));
    return { diagnostics };
  }

  const index = insertionIndex(command, model.connections.length, diagnostics);
  if (index === null) {
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const connection = cloneJsonValue(command.connection);
  candidate.connections.splice(index, 0, connection);

  return {
    candidate,
    inverseCommand: {
      type: "disconnectPorts",
      connectionId: connection.id
    },
    diagnostics
  };
}

function disconnectPorts(model, command) {
  const diagnostics = [];
  const connectionId = requireString(command, "connectionId", diagnostics);
  if (!connectionId) {
    return { diagnostics };
  }

  const connectionIndex = model.connections.findIndex((connection) => connection.id === connectionId);
  if (connectionIndex === -1) {
    diagnostics.push(commandError(
      "command.connection-not-found",
      `Connection does not exist: ${connectionId}`,
      "/connectionId"
    ));
    return { diagnostics };
  }

  const candidate = cloneJsonValue(model);
  const [connection] = candidate.connections.splice(connectionIndex, 1);

  return {
    candidate,
    inverseCommand: {
      type: "connectPorts",
      connection,
      index: connectionIndex
    },
    diagnostics
  };
}

/**
 * Applies one plain-data model command without mutating the input model.
 * Accepted commands return a validated model and an inverse command; rejected
 * commands return the original model and diagnostics.
 */
export function applyModelCommand(model, command, { registry } = {}) {
  if (!isRecord(command)) {
    return reject(model, [commandError(
      "command.invalid",
      "A model command must be an object"
    )]);
  }

  const handler = commandHandlers.get(command.type);
  if (!handler) {
    return reject(model, [commandError(
      "command.unknown-type",
      `Unknown model command type: ${command.type}`,
      "/type"
    )]);
  }
  if (!registry || typeof registry.get !== "function") {
    throw new TypeError("A component registry is required");
  }

  const currentStructure = validateDocumentStructure("model", model);
  if (!currentStructure.valid) {
    return reject(model, currentStructure.diagnostics);
  }

  let transformation;
  try {
    transformation = handler(model, command, registry);
  } catch (error) {
    if (error instanceof NonJsonValueError) {
      return reject(model, [commandError(
        "command.non-json-value",
        `Command data must be JSON-compatible: ${error.message}`
      )]);
    }
    throw error;
  }

  if (!transformation.candidate) {
    return reject(model, transformation.diagnostics);
  }

  const validation = validateModel(transformation.candidate, { registry });
  if (!validation.valid) {
    return reject(model, validation.diagnostics);
  }

  return accept(
    transformation.candidate,
    transformation.inverseCommand,
    validation.diagnostics
  );
}
