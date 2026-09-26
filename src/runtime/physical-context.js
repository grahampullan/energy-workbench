import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";

function roleFor(component, operation) {
  return component.id === operation.balancingComponentId ? "electrical-balance" : null;
}

function endpointReference(endpoint, operation) {
  return {
    componentId: endpoint.component.id,
    portId: endpoint.port.id,
    direction: endpoint.port.direction,
    role: roleFor(endpoint.component, operation)
  };
}

function publishedFields(values, fields = []) {
  return Object.fromEntries(fields
    .filter((field) => Object.hasOwn(values ?? {}, field))
    .map((field) => [field, values[field]]));
}

// Runtime endpoints stay private. Component callbacks receive detached port
// references and only the fields explicitly published at the opposite port.
export function createPhysicalContext({
  runtimeModel, component, operation, limitsByComponentId
}) {
  const connections = [];
  const boundaries = new Map();
  for (const connection of runtimeModel.connections) {
    if (connection.from.component !== component && connection.to.component !== component) {
      continue;
    }
    const remote = connection.from.component === component ? connection.to : connection.from;
    const publication = remote.component.definition.ports.find(
      ({ id }) => id === remote.port.id
    ).boundary;
    const target = operation.targets[remote.component.id] ?? null;
    connections.push({
      id: connection.id,
      name: connection.name,
      flowType: connection.flowType,
      from: endpointReference(connection.from, operation),
      to: endpointReference(connection.to, operation)
    });
    boundaries.set(connection.id, freezeJsonValue(cloneJsonValue({
      operatingLimits: publishedFields(limitsByComponentId.get(remote.component.id), publication?.operatingLimits),
      target: target && publication?.target?.length
        ? publishedFields(target, publication.target)
        : null
    })));
  }
  return Object.freeze({
    target: operation.targets[component.id] ?? null,
    role: roleFor(component, operation),
    operatingLimits: limitsByComponentId.get(component.id),
    connections: freezeJsonValue(connections),
    getBoundary(connectionId) {
      if (!boundaries.has(connectionId)) {
        const error = new Error(`${component.id} cannot read unconnected boundary ${connectionId}`);
        error.code = "runtime.unconnected-boundary-access";
        throw error;
      }
      return boundaries.get(connectionId);
    }
  });
}
