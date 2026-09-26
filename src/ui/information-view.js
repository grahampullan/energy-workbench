import { informationPort, policySettings, scheduleOutput } from "../core/information-model.js";

export function informationView(model, registry) {
  const names = new Map([...model.components, ...(model.informationSources ?? [])].map(({ id, name }) => [id, name]));
  return (model.informationConnections ?? []).map((connection) => {
    const port = informationPort(model, registry, connection.to, "inputs");
    const fromId = connection.from.componentId ?? connection.from.sourceId;
    const output = informationPort(model, registry, connection.from, "outputs");
    return {
      ...connection, fromComponentId: fromId, toComponentId: connection.to.componentId,
      label: port?.label ?? connection.name, unit: port?.unit,
      sourceLabel: `${names.get(fromId)} · ${output?.label ?? connection.from.portId}`
    };
  });
}

export function componentPolicyView(model, component, registry, scenario) {
  const definition = registry.getPolicy?.(component.policy?.type);
  const connections = informationView(model, registry).filter(({ to }) => to.componentId === component.id && to.portId.startsWith("policy."));
  const available = (registry.listPolicies?.() ?? []).filter(({ componentTypes, requiredPorts = [] }) => componentTypes.includes(component.type) && requiredPorts.every((portId) => model.connections.some(({ from, to }) => [from, to].some((endpoint) => endpoint.componentId === component.id && endpoint.portId === portId))));
  return {
    configuration: component.policy ?? null,
    definition: definition?.role ? null : definition,
    role: definition?.role ? definition : null,
    available: available.filter((candidate) => !candidate.role),
    availableRoles: available.filter((candidate) => candidate.role),
    requestSources: definition?.role ? [...new Set(model.connections.flatMap(({ from, to }) =>
      from.componentId === component.id ? [to.componentId] : to.componentId === component.id ? [from.componentId] : []
    ))].map((id) => ({ id, name: model.components.find((candidate) => candidate.id === id).name })) : [],
    connections,
    settings: definition ? policySettings(definition, component.policy) : {},
    sources: model.informationSources ?? [],
    optionsFor(port) {
      const options = [];
      for (const source of model.components) {
        const outputs = registry.get(source.type, source.definitionVersion)?.information?.outputs ?? {};
        for (const [portId, output] of Object.entries(outputs)) {
          if (output.quantity === port.quantity && output.unit === port.unit) options.push({
            label: `${source.name} · ${output.label}`, from: { componentId: source.id, portId }
          });
        }
      }
      for (const source of model.informationSources ?? []) {
        for (const portId of ["value", "enabled", "remaining-hours"]) {
          const output = scheduleOutput(source, portId);
          if (output?.quantity === port.quantity && output.unit === port.unit) options.push({
            label: `${source.name} · ${output.label}`, from: { sourceId: source.id, portId }
          });
        }
      }
      // Selecting a scenario creates a named, persisted schedule source; the
      // policy itself never receives a scenario ID or the full series.
      for (const series of scenario?.series ?? []) {
        if (series.unit !== port.unit || series.unit === "mode-code") continue;
        const existing = (model.informationSources ?? []).some((source) => source.seriesId === series.id && source.quantity === port.quantity && source.activeValue === undefined);
        if (existing) continue;
        const sourceId = `schedule-${component.id}-${series.id}-${port.quantity}`;
        options.push({ label: `Schedule · ${series.name}`, from: { sourceId, portId: "value" },
          source: { id: sourceId, name: series.name, seriesId: series.id, quantity: port.quantity, unit: port.unit } });
      }
      return options;
    }
  };
}

export function visibleInformationConnections(connections, selectedComponentId, showAll, highlightedId) {
  if (showAll) return connections;
  const visible = new Set();
  function include(connection) {
    if (visible.has(connection.id)) return;
    visible.add(connection.id);
    if (connection.from.componentId) {
      for (const dependency of connections) {
        if (dependency.to.componentId === connection.from.componentId && !dependency.to.portId.startsWith("policy.")) include(dependency);
      }
    }
  }
  for (const connection of connections) {
    if (connection.to.componentId === selectedComponentId || connection.id === highlightedId) include(connection);
  }
  return connections.filter(({ id }) => visible.has(id));
}
