import { cloneJsonValue } from "./json-value.js";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/u;
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/u;
const SEMANTIC_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PORT_DIRECTIONS = new Set(["in", "out", "bidirectional"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
}

function assertStableId(value, label) {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a stable ID`);
  }
}

function assertFieldName(value, label) {
  if (!FIELD_NAME_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a field name`);
  }
}

function assertNumericRange(range, label) {
  if (range === undefined) {
    return;
  }
  assertRecord(range, label);
  for (const bound of ["minimum", "maximum"]) {
    if (range[bound] !== undefined && typeof range[bound] !== "number") {
      throw new TypeError(`${label}.${bound} must be a number`);
    }
  }
  if (
    range.minimum !== undefined &&
    range.maximum !== undefined &&
    range.minimum > range.maximum
  ) {
    throw new TypeError(`${label}.minimum cannot exceed maximum`);
  }
}

function assertJsonValue(value, label) {
  try {
    cloneJsonValue(value);
  } catch (error) {
    throw new TypeError(`${label} must be JSON-compatible: ${error.message}`);
  }
}

function assertParameterSpecifications(parameters, definitionType) {
  for (const [parameter, specification] of Object.entries(parameters)) {
    assertFieldName(parameter, `${definitionType} parameter`);
    assertRecord(specification, `${definitionType}.parameters.${parameter}`);
    if (typeof specification.unit !== "string" || specification.unit.length === 0) {
      throw new TypeError(`${definitionType}.parameters.${parameter}.unit is required`);
    }
    if (!Object.hasOwn(specification, "default")) {
      throw new TypeError(`${definitionType}.parameters.${parameter}.default is required`);
    }
    assertJsonValue(specification.default, `${definitionType}.parameters.${parameter}.default`);
    assertNumericRange(specification.hardBounds, `${definitionType}.parameters.${parameter}.hardBounds`);
    assertNumericRange(specification.validityRange, `${definitionType}.parameters.${parameter}.validityRange`);
    if (specification.hardBounds) {
      if (typeof specification.default !== "number") {
        throw new TypeError(`${definitionType}.parameters.${parameter}.default must be numeric when hard bounds are declared`);
      }
      if (
        specification.hardBounds.minimum !== undefined &&
        specification.default < specification.hardBounds.minimum
      ) {
        throw new TypeError(`${definitionType}.parameters.${parameter}.default is below its hard minimum`);
      }
      if (
        specification.hardBounds.maximum !== undefined &&
        specification.default > specification.hardBounds.maximum
      ) {
        throw new TypeError(`${definitionType}.parameters.${parameter}.default is above its hard maximum`);
      }
    }
  }
}

function assertInitialStateSpecifications(initialState, definitionType) {
  for (const [stateField, specification] of Object.entries(initialState)) {
    assertFieldName(stateField, `${definitionType} initial-state field`);
    assertRecord(specification, `${definitionType}.initialState.${stateField}`);
    if (typeof specification.unit !== "string" || specification.unit.length === 0) {
      throw new TypeError(`${definitionType}.initialState.${stateField}.unit is required`);
    }
    if (!Object.hasOwn(specification, "default")) {
      throw new TypeError(`${definitionType}.initialState.${stateField}.default is required`);
    }
    assertJsonValue(
      specification.default,
      `${definitionType}.initialState.${stateField}.default`
    );
  }
}

function assertPorts(ports, definitionType) {
  if (!Array.isArray(ports)) {
    throw new TypeError(`${definitionType}.ports must be an array`);
  }

  const portIds = new Set();
  for (const port of ports) {
    assertRecord(port, `${definitionType}.ports entry`);
    assertStableId(port.id, `${definitionType}.ports[].id`);
    assertStableId(port.medium, `${definitionType}.ports.${port.id}.medium`);
    if (!PORT_DIRECTIONS.has(port.direction)) {
      throw new TypeError(`${definitionType}.ports.${port.id}.direction is invalid`);
    }
    if (portIds.has(port.id)) {
      throw new TypeError(`${definitionType} declares duplicate port ID: ${port.id}`);
    }
    portIds.add(port.id);
  }
}

function assertOutputs(outputs, definitionType) {
  for (const [output, specification] of Object.entries(outputs)) {
    assertFieldName(output, `${definitionType} output`);
    assertRecord(specification, `${definitionType}.outputs.${output}`);
    if (typeof specification.unit !== "string" || specification.unit.length === 0) {
      throw new TypeError(`${definitionType}.outputs.${output}.unit is required`);
    }
  }
}

function assertComponentDefinition(definition) {
  assertRecord(definition, "Component definition");
  assertStableId(definition.type, "Component definition type");
  if (typeof definition.version !== "string" || !SEMANTIC_VERSION_PATTERN.test(definition.version)) {
    throw new TypeError(`${definition.type}.version must be a semantic version`);
  }
  if (typeof definition.name !== "string" || definition.name.length === 0) {
    throw new TypeError(`${definition.type}.name is required`);
  }

  assertRecord(definition.parameters, `${definition.type}.parameters`);
  assertParameterSpecifications(definition.parameters, definition.type);
  assertRecord(definition.initialState, `${definition.type}.initialState`);
  assertInitialStateSpecifications(definition.initialState, definition.type);
  assertPorts(definition.ports, definition.type);
  assertRecord(definition.outputs, `${definition.type}.outputs`);
  assertOutputs(definition.outputs, definition.type);
  assertRecord(definition.editor, `${definition.type}.editor`);
  assertFunction(definition.validate, `${definition.type}.validate`);
  assertRecord(definition.model, `${definition.type}.model`);
  assertFunction(definition.model.prepare, `${definition.type}.model.prepare`);
  assertFunction(definition.model.initialise, `${definition.type}.model.initialise`);
  assertFunction(definition.model.getOperatingLimits, `${definition.type}.model.getOperatingLimits`);
  assertFunction(definition.model.evaluate, `${definition.type}.model.evaluate`);
}

function definitionKey(type, version) {
  return `${type}@${version}`;
}

export function createComponentRegistry(definitions = []) {
  if (!Array.isArray(definitions)) {
    throw new TypeError("Component definitions must be an array");
  }

  const definitionsByKey = new Map();

  function register(definition) {
    assertComponentDefinition(definition);
    const key = definitionKey(definition.type, definition.version);
    if (definitionsByKey.has(key)) {
      throw new Error(`Component definition is already registered: ${key}`);
    }
    definitionsByKey.set(key, definition);
    return definition;
  }

  function get(type, version) {
    return definitionsByKey.get(definitionKey(type, version));
  }

  function has(type, version) {
    return definitionsByKey.has(definitionKey(type, version));
  }

  function hasType(type) {
    return [...definitionsByKey.values()].some((definition) => definition.type === type);
  }

  function list() {
    return [...definitionsByKey.values()].sort((left, right) => {
      const typeOrder = left.type.localeCompare(right.type);
      return typeOrder || left.version.localeCompare(right.version);
    });
  }

  for (const definition of definitions) {
    register(definition);
  }

  return Object.freeze({ register, get, has, hasType, list });
}
