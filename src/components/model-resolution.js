export function resolutionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function singleConnection(component, context, portId) {
  const matches = context.connections.filter((connection) =>
    (connection.from.component === component && connection.from.port.id === portId) ||
    (connection.to.component === component && connection.to.port.id === portId)
  );
  if (matches.length !== 1) {
    throw resolutionError(
      "runtime.component-connection-count",
      `${component.id}.${portId} requires exactly one connection; received ${matches.length}`
    );
  }
  return matches[0];
}
