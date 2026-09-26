import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";
import { informationOrder, scheduleOutput, policySettings } from "../core/information-model.js";
import { createDiagnostic } from "../core/validation/validation-result.js";

const outputKey = (endpoint) => `${endpoint.componentId ?? endpoint.sourceId}/${endpoint.portId}`;

function checkedValue(value, port, name) {
  if (port.unit === "boolean" ? typeof value !== "boolean" : !Number.isFinite(value)) {
    throw new Error(`${name} must publish ${port.unit === "boolean" ? "a boolean" : "a finite number"}`);
  }
  return value;
}

export function prepareInformation(runtimeModel, registry) {
  const sources = runtimeModel.informationSources.map((source) => {
    const series = runtimeModel.series.find(({ id }) => id === source.seriesId);
    if (!series || series.unit !== source.unit) throw new Error(`${source.name}: schedule ${source.seriesId} must exist and use ${source.unit}`);
    if (series.data.kind !== "inline") throw new Error(`${source.name}: schedule must be materialised`);
    if (source.activeValue !== undefined && series.data.values.some((value) => !Number.isInteger(value))) {
      throw new Error(`${source.name}: process modes must be integers`);
    }
    // Schedule look-ahead is explicit here, never available to a policy.
    const remainingHours = Array(series.data.values.length).fill(0);
    if (source.activeValue !== undefined) {
      let steps = 0;
      for (let index = remainingHours.length - 1; index >= 0; index -= 1) {
        if (series.data.values[index] === source.activeValue) {
          steps += 1;
          remainingHours[index] = steps * runtimeModel.time.timeStepSeconds / 3600;
        } else { steps = 0; }
      }
    }
    return { source, values: series.data.values, remainingHours };
  });
  return {
    stages: informationOrder(runtimeModel), sources,
    policies: runtimeModel.components.filter(({ policy }) => policy).map((component) => ({
      component, definition: registry.getPolicy(component.policy.type),
      settings: freezeJsonValue(policySettings(registry.getPolicy(component.policy.type), component.policy))
    }))
  };
}

function connectedInputs(runtimeModel, values, componentId, specifications, prefix = "") {
  return freezeJsonValue(Object.fromEntries(Object.entries(specifications).map(([id, port]) => {
    const connections = runtimeModel.informationConnections.filter(({ to }) => to.componentId === componentId && to.portId === `${prefix}${id}`);
    const received = connections.map(({ from }) => {
      const key = outputKey(from);
      if (!values.has(key)) throw new Error(`Information output is not available: ${key}`);
      return values.get(key);
    });
    return [id, port.cardinality === "many" ? received : received[0]];
  })));
}

export function requestConnectedPolicies(runtimeModel, plan, stepContext, limitsByComponentId, diagnostics) {
  try {
    const values = new Map();
    for (const { source, values: samples, remainingHours } of plan.sources) {
      for (const portId of ["value", "enabled", "remaining-hours"]) {
        const port = scheduleOutput(source, portId);
        if (!port) continue;
        const sample = samples[stepContext.stepIndex];
        const value = portId === "enabled" ? source.activeValue === undefined || sample === source.activeValue
          : portId === "remaining-hours" ? remainingHours[stepContext.stepIndex] : sample;
        values.set(`${source.id}/${portId}`, checkedValue(value, port, source.name));
      }
    }
    for (const stage of plan.stages) {
      for (const componentId of stage) {
        const component = runtimeModel.components.find(({ id }) => id === componentId);
        const information = component.definition.information;
        const context = Object.freeze({
          state: stepContext.states[componentId],
          parameters: component.parameters,
          limits: freezeJsonValue(cloneJsonValue(limitsByComponentId.get(componentId))),
          inputs: connectedInputs(runtimeModel, values, componentId, information.inputs ?? {})
        });
        const requiredPorts = new Set(runtimeModel.informationConnections.filter(({ from }) => from.componentId === componentId).map(({ from }) => from.portId));
        for (const portId of requiredPorts) {
          const port = information.outputs[portId];
          values.set(`${componentId}/${portId}`, checkedValue(port.read(context), port, `${componentId}.${portId}`));
        }
      }
    }
    const targets = {};
    let balancingComponentId = null;
    for (const { component, definition, settings } of plan.policies) {
      const inputs = connectedInputs(runtimeModel, values, component.id, definition.inputs, "policy.");
      // The entire policy API: named input values and settings. No model,
      // component objects, clock, scenario, limits map, or global state.
      const target = definition.request(inputs, settings);
      if (definition.role === "electrical-balance") {
        if (target !== null) throw new Error("A balancing policy cannot also request a target");
        balancingComponentId = component.id;
      } else {
        if (!target || typeof target !== "object" || Array.isArray(target)) throw new Error(`${definition.name} must return an operating target`);
        targets[component.id] = freezeJsonValue(cloneJsonValue(target));
      }
    }
    return freezeJsonValue({ targets, balancingComponentId });
  } catch (error) {
    diagnostics.push(createDiagnostic({ code: "runtime.information-policy", message: error.message, path: `/steps/${stepContext.stepIndex}/policy` }));
    return null;
  }
}
