import {
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../core/flow-types.js";

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

export function integratePowerSerieskWh(values, timeStepSeconds) {
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
  let energykWh = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    energykWh += (previous + current) / 2 * durationHours;
  }
  return energykWh;
}

function flowSeries({
  connection,
  fromComponent,
  toComponent,
  direction,
  flowType,
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
    flowType,
    label: `${source.name} → ${destination.name}`,
    values: values.map((powerkW, stepIndex) => ({
      stepIndex,
      elapsedSeconds: elapsedSeconds[stepIndex],
      powerkW: forward ? Math.max(0, powerkW) : Math.max(0, -powerkW)
    })),
    integratedEnergykWh: integratePowerSerieskWh(
      values.map((powerkW) => forward ? Math.max(0, powerkW) : Math.max(0, -powerkW)),
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
    const flowType = fromPort.flowType;
    if (toPort.flowType !== flowType) {
      throw new TypeError(`Connection ${connection.id} joins incompatible flow types`);
    }
    if (
      flowType !== ACTIVE_POWER_FLOW_TYPE &&
      flowType !== THERMAL_HEAT_FLOW_TYPE
    ) {
      throw new TypeError(`Connection ${connection.id} has unsupported flow type ${flowType}`);
    }
    const values = connectionResultsByStep.map((resultsByConnection, stepIndex) => {
      const result = resultsByConnection.get(connection.id);
      if (!result) {
        throw new Error(
          `Run results do not contain connection ${connection.id} at step ${stepIndex}`
        );
      }
      if (result.flowType !== flowType) {
        throw new TypeError(
          `Connection ${connection.id} must have ${flowType} results`
        );
      }
      const powerkW = flowType === ACTIVE_POWER_FLOW_TYPE
        ? result.flow?.powerkW
        : result.flow?.heatFlowkW;
      if (!Number.isFinite(powerkW)) {
        throw new TypeError(
          `Connection ${connection.id} flow must be finite at step ${stepIndex}`
        );
      }
      return powerkW;
    });
    const directions = flowType === ACTIVE_POWER_FLOW_TYPE &&
      fromPort.direction === "bidirectional" &&
      toPort.direction === "bidirectional"
      ? ["forward", "reverse"]
      : ["forward"];

    return directions.map((direction) => flowSeries({
      connection,
      fromComponent,
      toComponent,
      direction,
      flowType,
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
