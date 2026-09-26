import { createDiagnostic } from "./validation/validation-result.js";

export function scheduleOutput(source, portId) {
  if (portId === "value" && source.activeValue === undefined) {
    return { label: source.name, quantity: source.quantity, unit: source.unit };
  }
  if (portId === "enabled") return { label: "Permitted", quantity: "permission", unit: "boolean" };
  if (portId === "remaining-hours" && source.activeValue !== undefined) {
    return { label: "Time remaining", quantity: "duration", unit: "h" };
  }
  return null;
}

export function informationPort(model, registry, endpoint, direction) {
  if (endpoint.sourceId) {
    const source = model.informationSources?.find(({ id }) => id === endpoint.sourceId);
    return direction === "outputs" && source ? scheduleOutput(source, endpoint.portId) : null;
  }
  const component = model.components.find(({ id }) => id === endpoint.componentId);
  if (!component) return null;
  if (direction === "inputs" && endpoint.portId.startsWith("policy.")) {
    return registry.getPolicy?.(component.policy?.type)?.inputs[endpoint.portId.slice(7)] ?? null;
  }
  return registry.get(component.type, component.definitionVersion)
    ?.information?.[direction]?.[endpoint.portId] ?? null;
}

export function policySettings(policy, configuration) {
  return Object.fromEntries(Object.entries(policy.settings).map(([id, spec]) => [
    id, Object.hasOwn(configuration.settings, id) ? configuration.settings[id] : spec.default
  ]));
}

// Only component information inputs form calculation dependencies. Policy inputs
// are leaves, so reading one's own start-of-step state is not a feedback cycle.
export function informationOrder(model) {
  const connections = model.informationConnections ?? [];
  const required = new Set(connections.filter(({ from }) => from.componentId).map(({ from }) => from.componentId));
  const stages = [];
  const settled = new Set();
  while (required.size) {
    const stage = [...required].filter((id) => connections
      .filter(({ to }) => to.componentId === id && !to.portId.startsWith("policy."))
      .every(({ from }) => !from.componentId || settled.has(from.componentId)));
    if (!stage.length) throw new Error(`Information connections contain a same-step cycle: ${[...required].join(", ")}`);
    stages.push(stage);
    for (const id of stage) { required.delete(id); settled.add(id); }
  }
  return stages;
}

export function validateInformationModel(model, registry) {
  const diagnostics = [];
  const report = (code, message, path = "") => diagnostics.push(createDiagnostic({ code: `model.${code}`, message, path }));
  const ids = new Set(model.components.map(({ id }) => id));
  for (const source of model.informationSources ?? []) {
    if (ids.has(source.id)) report("duplicate-information-source", `Duplicate information source: ${source.id}`);
    ids.add(source.id);
    if (source.activeValue !== undefined && (source.unit !== "mode-code" || source.quantity !== "process-mode")) {
      report("information-mode-source", `${source.name} must use process-mode and mode-code for a period schedule`);
    }
  }
  const balancing = [];
  for (const component of model.components) {
    if (!component.policy) continue;
    const policy = registry.getPolicy?.(component.policy.type);
    const path = `/components/${model.components.indexOf(component)}/policy`;
    if (!policy) { report("unknown-policy", `Unknown policy: ${component.policy.type}`, path); continue; }
    if (!policy.componentTypes.includes(component.type)) report("incompatible-policy", `${policy.name} cannot control ${component.type}`, path);
    for (const portId of policy.requiredPorts ?? []) {
      if (!model.connections.some(({ from, to }) => [from, to].some((endpoint) => endpoint.componentId === component.id && endpoint.portId === portId))) {
        report("policy-port-required", `${policy.name} requires a connected ${portId} port`, path);
      }
    }
    if (policy.role === "electrical-balance") balancing.push(component.id);
    for (const name of Object.keys(component.policy.settings)) {
      if (!Object.hasOwn(policy.settings, name)) report("unknown-policy-setting", `Unknown ${policy.name} setting: ${name}`, path);
    }
    for (const [name, value] of Object.entries(policySettings(policy, component.policy))) {
      const spec = policy.settings[name];
      if (typeof value !== typeof spec.default || (typeof value === "number" && (!Number.isFinite(value) || value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity))) ||
          (spec.choices && !spec.choices.some((choice) => choice.value === value))) {
        report("invalid-policy-setting", `Invalid ${policy.name} setting: ${name}`, path);
      }
    }
  }
  if (balancing.length > 1) report("multiple-balancing-policies", "This runtime supports one electrical balancing component per model");
  const connectionIds = new Set(model.connections.map(({ id }) => id));
  const usages = new Map();
  for (const [index, connection] of (model.informationConnections ?? []).entries()) {
    const path = `/informationConnections/${index}`;
    if (connectionIds.has(connection.id)) report("duplicate-connection-id", `Duplicate connection: ${connection.id}`, path);
    connectionIds.add(connection.id);
    const from = informationPort(model, registry, connection.from, "outputs");
    const to = informationPort(model, registry, connection.to, "inputs");
    if (!from) report("information-source-port", `Unknown information output: ${connection.from.componentId ?? connection.from.sourceId}.${connection.from.portId}`, path);
    if (!to) report("information-target-port", `Unknown information input: ${connection.to.componentId}.${connection.to.portId}`, path);
    if (from && to && (from.quantity !== to.quantity || from.unit !== to.unit)) {
      report("information-type", `Cannot connect ${from.quantity} (${from.unit}) to ${to.quantity} (${to.unit})`, path);
    }
    const key = `${connection.to.componentId}/${connection.to.portId}`;
    usages.set(key, (usages.get(key) ?? 0) + 1);
    if ((to?.cardinality ?? "one") === "one" && usages.get(key) > 1) report("information-cardinality", `Input ${key} requires one source`, path);
  }
  for (const component of model.components) {
    const policy = registry.getPolicy?.(component.policy?.type);
    for (const id of Object.keys(policy?.inputs ?? {})) {
      if (!usages.has(`${component.id}/policy.${id}`)) report("missing-policy-input", `${component.name}: connect ${policy.inputs[id].label}`);
    }
    const needed = (model.informationConnections ?? []).some(({ from }) => from.componentId === component.id);
    if (!needed) continue;
    const definition = registry.get(component.type, component.definitionVersion);
    for (const [id, port] of Object.entries(definition?.information?.inputs ?? {})) {
      if (!usages.has(`${component.id}/${id}`) && !port.optional) report("missing-information-input", `${component.name}: connect ${port.label}`);
    }
  }
  try { informationOrder(model); } catch (error) { report("information-cycle", error.message); }
  return diagnostics;
}
