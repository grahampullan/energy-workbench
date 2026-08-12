import { applyModelCommand } from "../core/model-commands.js";

export function parameterOverrideKey(componentId, parameter) {
  return `${componentId}\u0000${parameter}`;
}

export function resolvedParameterValue({ model, registry, componentId, parameter }) {
  const component = model.components.find((candidate) => candidate.id === componentId);
  if (!component) {
    throw new Error(`Component does not exist: ${componentId}`);
  }
  const definition = registry.get(component.type, component.definitionVersion);
  if (!definition || !Object.hasOwn(definition.parameters, parameter)) {
    throw new Error(`${component.type} does not declare parameter: ${parameter}`);
  }
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : definition.parameters[parameter].default;
}

export function applyParameterOverrides({ model, registry, overrides }) {
  if (!Array.isArray(overrides)) {
    throw new TypeError("Parameter overrides must be an array");
  }

  let candidate = model;
  const diagnostics = [];
  const inverseCommands = [];

  for (const override of overrides) {
    const result = applyModelCommand(candidate, {
      type: "setParameter",
      componentId: override.componentId,
      parameter: override.parameter,
      value: override.value
    }, { registry });
    diagnostics.push(...result.diagnostics);
    if (!result.applied) {
      return {
        applied: false,
        model,
        inverseCommands: [],
        diagnostics
      };
    }
    candidate = result.model;
    inverseCommands.unshift(result.inverseCommand);
  }

  return {
    applied: true,
    model: candidate,
    inverseCommands,
    diagnostics
  };
}
