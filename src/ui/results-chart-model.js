function definitionFor(registry, component) {
  const definition = registry.get(component.type, component.definitionVersion);
  if (!definition) {
    throw new Error(
      `Component definition is not registered: ${component.type}@${component.definitionVersion}`
    );
  }
  return definition;
}

function portFor(definition, componentId, portId) {
  const port = definition.ports.find((candidate) => candidate.id === portId);
  if (!port) {
    throw new Error(`Component ${componentId} does not define port: ${portId}`);
  }
  return port;
}

export function integratePowerSeriesKwh(values, timeStepSeconds) {
  if (!Array.isArray(values)) {
    throw new TypeError("Power-series values must be an array");
  }
  if (!Number.isFinite(timeStepSeconds) || timeStepSeconds <= 0) {
    throw new TypeError("timeStepSeconds must be a finite, positive number");
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Power-series values must be finite numbers");
  }

  const durationHours = timeStepSeconds / 3600;
  let energyKwh = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    energyKwh += (previous + current) / 2 * durationHours;
  }
  return energyKwh;
}

function flowSeries({
  connection,
  fromComponent,
  toComponent,
  direction,
  values,
  elapsedSeconds,
  timeStepSeconds
}) {
  const forward = direction === "forward";
  const source = forward ? fromComponent : toComponent;
  const destination = forward ? toComponent : fromComponent;
  return {
    id: `${connection.id}:${direction}`,
    connectionId: connection.id,
    componentIds: [fromComponent.id, toComponent.id],
    direction,
    label: `${source.name} → ${destination.name}`,
    values: values.map((powerKw, stepIndex) => ({
      stepIndex,
      elapsedSeconds: elapsedSeconds[stepIndex],
      powerKw: forward ? Math.max(0, powerKw) : Math.max(0, -powerKw)
    })),
    integratedEnergyKwh: integratePowerSeriesKwh(
      values.map((powerKw) => forward ? Math.max(0, powerKw) : Math.max(0, -powerKw)),
      timeStepSeconds
    )
  };
}

export function createResultsChartModel({ model, registry, results }) {
  if (!model || !registry || !results) {
    throw new TypeError("Model, registry, and run results are required");
  }
  const timeStepSeconds = results.time?.timeStepSeconds;
  if (!Number.isFinite(timeStepSeconds) || timeStepSeconds <= 0) {
    throw new TypeError("Run results must declare a finite, positive timestep");
  }
  if (!Array.isArray(results.steps) || results.steps.length === 0) {
    throw new TypeError("Run results must contain at least one timestep");
  }

  const componentsById = new Map(model.components.map((component) => [
    component.id,
    component
  ]));
  const elapsedSeconds = results.steps.map((step) => step.elapsedSeconds);
  const connectionResultsByStep = results.steps.map((step) => new Map(
    step.connections.map((connection) => [connection.connectionId, connection])
  ));

  const series = model.connections.flatMap((connection) => {
    const fromComponent = componentsById.get(connection.from.componentId);
    const toComponent = componentsById.get(connection.to.componentId);
    if (!fromComponent || !toComponent) {
      throw new Error(`Connection ${connection.id} references an unknown component`);
    }
    const fromDefinition = definitionFor(registry, fromComponent);
    const toDefinition = definitionFor(registry, toComponent);
    const fromPort = portFor(fromDefinition, fromComponent.id, connection.from.portId);
    const toPort = portFor(toDefinition, toComponent.id, connection.to.portId);
    const values = connectionResultsByStep.map((resultsByConnection, stepIndex) => {
      const result = resultsByConnection.get(connection.id);
      if (!result) {
        throw new Error(
          `Run results do not contain connection ${connection.id} at step ${stepIndex}`
        );
      }
      if (!Number.isFinite(result.powerKw)) {
        throw new TypeError(
          `Connection ${connection.id} power must be finite at step ${stepIndex}`
        );
      }
      return result.powerKw;
    });
    const directions = fromPort.direction === "bidirectional" &&
      toPort.direction === "bidirectional"
      ? ["forward", "reverse"]
      : ["forward"];

    return directions.map((direction) => flowSeries({
      connection,
      fromComponent,
      toComponent,
      direction,
      values,
      elapsedSeconds,
      timeStepSeconds
    }));
  });

  return {
    timeStepSeconds,
    stepCount: results.steps.length,
    elapsedSeconds,
    series
  };
}
