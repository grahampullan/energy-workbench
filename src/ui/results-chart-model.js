import { integrateStepPowerkWh } from "../core/energy-integration.js";
import {
  ACTIVE_POWER_FLOW_TYPE,
  MATERIAL_MASS_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../core/flow-types.js";
import {
  createConnectionColourScale,
  tableauColour
} from "./connection-colours.js";

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

function isFlowChartPortVisible(definition, portId) {
  const hiddenPorts = definition.editor?.hiddenFlowChartPorts ?? [];
  if (!Array.isArray(hiddenPorts) || hiddenPorts.some(
    (hiddenPortId) => typeof hiddenPortId !== "string"
  )) {
    throw new TypeError(
      `Component definition ${definition.type} has invalid hidden flow-chart ports`
    );
  }
  return !hiddenPorts.includes(portId);
}

function flowSeries({
  connection,
  fromComponent,
  toComponent,
  direction,
  flowType,
  colour,
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
    colour,
    kind: "calculated",
    label: `${source.name} → ${destination.name}`,
    values: values.map((powerkW, stepIndex) => ({
      stepIndex,
      elapsedSeconds: elapsedSeconds[stepIndex],
      powerkW: forward ? Math.max(0, powerkW) : Math.max(0, -powerkW)
    })),
    integratedEnergykWh: integrateStepPowerkWh(
      values.map((powerkW) => forward ? Math.max(0, powerkW) : Math.max(0, -powerkW)),
      timeStepSeconds
    )
  };
}

function materialMassSeries({
  connection,
  fromComponent,
  toComponent,
  flows,
  colour,
  elapsedSeconds,
  timeStepSeconds
}) {
  const values = flows.map((flow, stepIndex) => {
    const massFlowKgPerSecond = flow?.massFlowKgPerSecond;
    if (!Number.isFinite(massFlowKgPerSecond) || massFlowKgPerSecond < 0) {
      throw new TypeError(
        `Connection ${connection.id} mass flow must be finite and non-negative at step ${stepIndex}`
      );
    }
    return {
      stepIndex,
      elapsedSeconds: elapsedSeconds[stepIndex],
      massFlowKgPerSecond
    };
  });
  return {
    id: `${connection.id}:mass-forward`,
    connectionId: connection.id,
    componentIds: [fromComponent.id, toComponent.id],
    direction: "forward",
    flowType: MATERIAL_MASS_FLOW_TYPE,
    colour,
    kind: "calculated",
    label: `${fromComponent.name} → ${toComponent.name}`,
    values,
    integratedMassKg: values.reduce(
      (total, point) => total + point.massFlowKgPerSecond * timeStepSeconds,
      0
    )
  };
}

function validateScenarioTime(scenario, results) {
  if (scenario === undefined) {
    return;
  }
  if (
    scenario.time?.timeStepSeconds !== results.time.timeStepSeconds ||
    scenario.time?.stepCount !== results.steps.length
  ) {
    throw new TypeError(
      "Scenario and run results must use the same timestep and step count"
    );
  }
}

function scenarioSeriesWithUnit(scenario, unit, stepCount) {
  if (scenario === undefined) {
    return [];
  }
  return scenario.series
    .filter((series) => series.unit === unit)
    .map((series) => {
      if (
        series.data?.kind !== "inline" ||
        !Array.isArray(series.data.values) ||
        series.data.values.length !== stepCount ||
        series.data.values.some((value) => !Number.isFinite(value))
      ) {
        throw new TypeError(
          `Scenario series ${series.id} must contain one finite inline value per timestep`
        );
      }
      return series;
    });
}

function createPrescribedPowerSeries({ scenario, stepCount, timeStepSeconds }) {
  return scenarioSeriesWithUnit(scenario, "kW", stepCount).map((series) => {
    if (series.data.values.some((value) => value < 0)) {
      throw new RangeError(
        `Prescribed power series ${series.id} must contain non-negative values`
      );
    }
    return {
      id: `scenario:${series.id}`,
      connectionId: null,
      componentIds: [],
      direction: null,
      flowType: null,
      kind: "prescribed",
      label: `${series.name} · scenario input`,
      values: series.data.values.map((powerkW, stepIndex) => ({
        stepIndex,
        elapsedSeconds: stepIndex * timeStepSeconds,
        powerkW
      }))
    };
  });
}

function createPrescribedMassSeries({ scenario, stepCount, timeStepSeconds }) {
  return scenarioSeriesWithUnit(scenario, "kg/s", stepCount).map((series) => {
    if (series.data.values.some((value) => value < 0)) {
      throw new RangeError(
        `Prescribed mass-flow series ${series.id} must contain non-negative values`
      );
    }
    return {
      id: `scenario:${series.id}`,
      connectionId: null,
      componentIds: [],
      direction: null,
      flowType: MATERIAL_MASS_FLOW_TYPE,
      kind: "prescribed",
      label: `${series.name} · scenario input`,
      values: series.data.values.map((massFlowKgPerSecond, stepIndex) => ({
        stepIndex,
        elapsedSeconds: stepIndex * timeStepSeconds,
        massFlowKgPerSecond
      }))
    };
  });
}

function createPrescribedTemperatureSeries({
  scenario,
  stepCount,
  timeStepSeconds
}) {
  return scenarioSeriesWithUnit(scenario, "°C", stepCount).map((series) => {
    const values = series.data.values.map((temperatureC, stepIndex) => ({
      stepIndex,
      elapsedSeconds: stepIndex * timeStepSeconds,
      temperatureC
    }));
    return {
      id: `scenario:${series.id}`,
      connectionId: null,
      componentIds: [],
      kind: "prescribed",
      label: `${series.name} · scenario input`,
      thresholdC: null,
      thresholdLabel: null,
      stepValueOffset: 0,
      values
    };
  });
}

function componentParameter(component, definition, parameterId) {
  const value = Object.hasOwn(component.parameters ?? {}, parameterId)
    ? component.parameters[parameterId]
    : definition.parameters?.[parameterId]?.default;
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `Component ${component.id} parameter ${parameterId} must be finite`
    );
  }
  return value;
}

function stateForComponent(entries, componentId, context) {
  const state = entries?.find((entry) => entry.componentId === componentId)?.state;
  if (!state) {
    throw new Error(`${context} does not contain state for component ${componentId}`);
  }
  return state;
}

function createTemperatureSeries({ model, registry, results, timeStepSeconds }) {
  return model.components
    .flatMap((component) => {
      const definition = definitionFor(registry, component);
      const chart = definition.editor.temperatureChart;
      if (chart === undefined) {
        return [];
      }
      const {
        stateField,
        outputField,
        initialLimitField,
        thresholdParameter,
        thresholdLabel
      } = chart;
      const usesState = typeof stateField === "string";
      const usesOutput = typeof outputField === "string";
      const hasThreshold = thresholdParameter !== undefined ||
        thresholdLabel !== undefined;
      if (
        usesState === usesOutput ||
        (usesOutput && typeof initialLimitField !== "string") ||
        (
          hasThreshold &&
          (
            typeof thresholdParameter !== "string" ||
            typeof thresholdLabel !== "string"
          )
        )
      ) {
        throw new TypeError(
          `Component ${component.id} temperature-chart metadata is invalid`
        );
      }
      const initialTemperatureC = usesState
        ? stateForComponent(
            results.initialStates,
            component.id,
            "Run results initial states"
          )[stateField]
        : results.steps[0].components.find(
            ({ componentId }) => componentId === component.id
          )?.operatingLimits?.[initialLimitField];
      if (!Number.isFinite(initialTemperatureC)) {
        throw new TypeError(`Component ${component.id} initial temperature must be finite`);
      }
      const values = [{
        stepIndex: -1,
        elapsedSeconds: 0,
        temperatureC: initialTemperatureC
      }, ...results.steps.map((step, stepIndex) => {
        const result = step.components.find(({ componentId }) => componentId === component.id);
        return {
          stepIndex,
          elapsedSeconds: step.elapsedSeconds + timeStepSeconds,
          temperatureC: usesState ? result?.state?.[stateField] : result?.outputs?.[outputField]
        };
      })];
      if (values.some(({ temperatureC }) => !Number.isFinite(temperatureC))) {
        throw new TypeError(
          `Component ${component.id} temperature series must be finite`
        );
      }

      return {
        id: `${component.id}:temperature`,
        connectionId: null,
        componentIds: [component.id],
        kind: "calculated",
        label: `${component.name} temperature`,
        thresholdC: hasThreshold
          ? componentParameter(component, definition, thresholdParameter)
          : null,
        thresholdLabel: hasThreshold ? thresholdLabel : null,
        stepValueOffset: 1,
        values
      };
    });
}

export function createResultsChartModel({ model, registry, results, scenario }) {
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
  validateScenarioTime(scenario, results);

  const componentsById = new Map(model.components.map((component) => [
    component.id,
    component
  ]));
  const connectionColours = createConnectionColourScale(
    model.connections.map(({ id }) => id)
  );
  const elapsedSeconds = results.steps.map((step) => step.elapsedSeconds);
  const endElapsedSeconds = elapsedSeconds.at(-1) + timeStepSeconds;
  const connectionResultsByStep = results.steps.map((step) => new Map(
    step.connections.map((connection) => [connection.connectionId, connection])
  ));

  const connectionEntries = model.connections.map((connection) => {
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
      flowType !== THERMAL_HEAT_FLOW_TYPE &&
      flowType !== MATERIAL_MASS_FLOW_TYPE
    ) {
      throw new TypeError(`Connection ${connection.id} has unsupported flow type ${flowType}`);
    }
    const flows = connectionResultsByStep.map((resultsByConnection, stepIndex) => {
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
      return result.flow;
    });
    const visibleInFlowChart =
      isFlowChartPortVisible(fromDefinition, fromPort.id) &&
      isFlowChartPortVisible(toDefinition, toPort.id);
    return {
      connection,
      fromComponent,
      toComponent,
      fromPort,
      toPort,
      flowType,
      colour: connectionColours.colourFor(connection.id),
      flows,
      visibleInFlowChart
    };
  });

  const series = [];
  const hiddenSeries = [];
  connectionEntries
    .filter(({ flowType }) => flowType !== MATERIAL_MASS_FLOW_TYPE)
    .forEach((entry) => {
      const {
        connection,
        fromComponent,
        toComponent,
        fromPort,
        toPort,
        flowType,
        colour,
        flows
      } = entry;
      const values = flows.map((flow, stepIndex) => {
        const powerkW = flowType === ACTIVE_POWER_FLOW_TYPE
          ? flow?.powerkW
          : flow?.heatFlowkW;
        if (!Number.isFinite(powerkW)) {
          throw new TypeError(
            `Connection ${connection.id} energy flow must be finite at step ${stepIndex}`
          );
        }
        return powerkW;
      });
      const directions = flowType === ACTIVE_POWER_FLOW_TYPE &&
        fromPort.direction === "bidirectional" &&
        toPort.direction === "bidirectional"
        ? ["forward", "reverse"]
        : ["forward"];

      const destination = entry.visibleInFlowChart ? series : hiddenSeries;
      destination.push(...directions.map((direction) => flowSeries({
        connection,
        fromComponent,
        toComponent,
        direction,
        flowType,
        colour,
        values,
        elapsedSeconds,
        timeStepSeconds
      })));
    });
  const materialSeries = connectionEntries
    .filter(({ flowType, visibleInFlowChart }) =>
      visibleInFlowChart && flowType === MATERIAL_MASS_FLOW_TYPE
    )
    .map((entry) => materialMassSeries({
      ...entry,
      elapsedSeconds,
      timeStepSeconds
    }));

  const uncolouredStandaloneSeries = [
    createPrescribedPowerSeries({
      scenario,
      stepCount: results.steps.length,
      timeStepSeconds
    }),
    createPrescribedMassSeries({
      scenario,
      stepCount: results.steps.length,
      timeStepSeconds
    }),
    createTemperatureSeries({
      model,
      registry,
      results,
      timeStepSeconds
    }),
    createPrescribedTemperatureSeries({
      scenario,
      stepCount: results.steps.length,
      timeStepSeconds
    })
  ];
  let standaloneColourIndex = connectionColours.size;
  const [
    prescribedPowerSeries,
    prescribedMassSeries,
    temperatureSeries,
    prescribedTemperatureSeries
  ] = uncolouredStandaloneSeries.map((group) => group.map((candidate) => ({
    ...candidate,
    colour: tableauColour(standaloneColourIndex++)
  })));

  return {
    timeStepSeconds,
    stepCount: results.steps.length,
    elapsedSeconds,
    endElapsedSeconds,
    series,
    hiddenSeries,
    materialSeries,
    prescribedPowerSeries,
    prescribedMassSeries,
    temperatureSeries,
    prescribedTemperatureSeries
  };
}
