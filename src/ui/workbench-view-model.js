const WORD_CASE = new Map([
  ["id", "ID"],
  ["kw", "kW"],
  ["kwh", "kWh"],
  ["pv", "PV"]
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function titleWord(word, wordIndex) {
  const knownCase = WORD_CASE.get(word.toLowerCase());
  if (knownCase) {
    return knownCase;
  }
  return wordIndex === 0
    ? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    : word.toLowerCase();
}

export function formatFieldLabel(field) {
  return field
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[._-]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean)
    .map(titleWord)
    .join(" ");
}

export function formatEngineeringValue(value, unit = "") {
  const visibleUnit = unit === "1" || unit === "scenario-series-id" ? "" : unit;
  let formattedValue;

  if (typeof value === "number") {
    const normalisedValue = Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value;
    formattedValue = new Intl.NumberFormat("en-GB", {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0
    }).format(normalisedValue);
  } else if (value === null || value === undefined) {
    formattedValue = "—";
  } else if (typeof value === "boolean") {
    formattedValue = value ? "Yes" : "No";
  } else {
    formattedValue = String(value);
  }

  return visibleUnit ? `${formattedValue} ${visibleUnit}` : formattedValue;
}

function formatElapsedTime(elapsedSeconds) {
  const wholeSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const days = Math.floor(wholeSeconds / 86_400);
  const secondsWithinDay = wholeSeconds % 86_400;
  const hours = Math.floor(secondsWithinDay / 3_600);
  const minutes = Math.floor((secondsWithinDay % 3_600) / 60);
  const seconds = secondsWithinDay % 60;
  const clock = [hours, minutes, ...(seconds ? [seconds] : [])]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return days ? `Day ${days + 1} · ${clock}` : clock;
}

function definitionFor(registry, component) {
  const definition = registry.get(component.type, component.definitionVersion);
  if (!definition) {
    throw new Error(
      `Component definition is not registered: ${component.type}@${component.definitionVersion}`
    );
  }
  return definition;
}

function fieldViews(specifications, values) {
  return Object.entries(specifications).map(([id, specification]) => {
    const value = Object.hasOwn(values, id) ? values[id] : specification.default;
    const label = formatFieldLabel(id);
    const unitSuffix = ` ${specification.unit}`;
    return {
      id,
      label: label.endsWith(unitSuffix) ? label.slice(0, -unitSuffix.length) : label,
      unit: specification.unit,
      value,
      editor: specification.editor ?? null,
      displayValue: formatEngineeringValue(value, specification.unit)
    };
  });
}

function parameterGroups(definition, parameterFields) {
  const fieldsById = new Map(parameterFields.map((field) => [field.id, field]));
  const groupedIds = new Set();
  const groups = (definition.editor.groups ?? []).map((group) => {
    const fields = group.parameters
      .map((parameterId) => fieldsById.get(parameterId))
      .filter(Boolean);
    fields.forEach((field) => groupedIds.add(field.id));
    return { id: group.id, label: group.label, fields };
  });
  const ungroupedFields = parameterFields.filter((field) => !groupedIds.has(field.id));

  if (ungroupedFields.length > 0) {
    groups.push({ id: "parameters", label: "Parameters", fields: ungroupedFields });
  }
  return groups.filter((group) => group.fields.length > 0);
}

function operationFields(componentResult) {
  const commands = [
    ["Requested power", componentResult.requestedCommand],
    ["Feasible power", componentResult.feasibleCommand],
    ["Actual power", componentResult.actualCommand]
  ];
  return commands.flatMap(([label, command]) =>
    isRecord(command) && typeof command.powerKw === "number"
      ? [{ label, value: command.powerKw, unit: "kW", displayValue: formatEngineeringValue(command.powerKw, "kW") }]
      : []
  );
}

function primaryMetric(definition, componentResult) {
  if (typeof componentResult.outputs.balanceResidualPowerKw === "number") {
    const value = componentResult.outputs.balanceResidualPowerKw;
    return {
      label: "Balance residual",
      value,
      unit: "kW",
      displayValue: formatEngineeringValue(value, "kW")
    };
  }
  if (typeof componentResult.actualCommand?.powerKw === "number") {
    const value = componentResult.actualCommand.powerKw;
    return {
      label: "Current power",
      value,
      unit: "kW",
      displayValue: formatEngineeringValue(value, "kW")
    };
  }

  const firstNumericOutput = Object.entries(componentResult.outputs).find(
    ([, value]) => typeof value === "number"
  );
  if (!firstNumericOutput) {
    return { label: "Current result", value: null, unit: "", displayValue: "—" };
  }
  const [outputId, value] = firstNumericOutput;
  const unit = definition.outputs[outputId]?.unit ?? "";
  return {
    label: formatFieldLabel(outputId),
    value,
    unit,
    displayValue: formatEngineeringValue(value, unit)
  };
}

function powerTone(metric) {
  if (metric.unit !== "kW" || typeof metric.value !== "number" || Math.abs(metric.value) < 1e-9) {
    return "neutral";
  }
  return metric.value > 0 ? "exporting" : "importing";
}

function componentView(component, definition, componentResult, parameterOverrides) {
  const metric = primaryMetric(definition, componentResult);
  const parameterFields = fieldViews(definition.parameters, {
    ...component.parameters,
    ...parameterOverrides
  });
  return {
    id: component.id,
    name: component.name,
    type: component.type,
    definitionName: definition.name,
    definitionVersion: definition.version,
    metric,
    powerTone: powerTone(metric),
    parameterGroups: parameterGroups(definition, parameterFields),
    operationFields: operationFields(componentResult),
    outputFields: fieldViews(definition.outputs, componentResult.outputs),
    stateFields: fieldViews(definition.initialState, componentResult.state)
  };
}

export function createWorkbenchView({
  model,
  registry,
  results,
  stepIndex,
  parameterOverrides = []
}) {
  if (!model || !registry || !results) {
    throw new TypeError("Model, registry, and run results are required");
  }
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= results.steps.length) {
    throw new RangeError(`stepIndex must be between 0 and ${results.steps.length - 1}`);
  }

  const step = results.steps[stepIndex];
  const componentResultsById = new Map(
    step.components.map((componentResult) => [componentResult.componentId, componentResult])
  );
  const modelConnectionsById = new Map(
    model.connections.map((connection) => [connection.id, connection])
  );
  const overridesByComponentId = new Map();
  for (const override of parameterOverrides) {
    const componentOverrides = overridesByComponentId.get(override.componentId) ?? {};
    componentOverrides[override.parameter] = override.value;
    overridesByComponentId.set(override.componentId, componentOverrides);
  }

  const components = model.components.map((component) => {
    const componentResult = componentResultsById.get(component.id);
    if (!componentResult) {
      throw new Error(`Run results do not contain component: ${component.id}`);
    }
    return componentView(
      component,
      definitionFor(registry, component),
      componentResult,
      overridesByComponentId.get(component.id) ?? {}
    );
  });

  const connections = step.connections.map((connectionResult) => {
    const connection = modelConnectionsById.get(connectionResult.connectionId);
    if (!connection) {
      throw new Error(`Run results contain an unknown connection: ${connectionResult.connectionId}`);
    }
    return {
      id: connection.id,
      name: connection.name,
      fromComponentId: connection.from.componentId,
      toComponentId: connection.to.componentId,
      powerKw: connectionResult.powerKw,
      displayPower: formatEngineeringValue(connectionResult.powerKw, "kW")
    };
  });

  return {
    stepIndex,
    stepCount: results.steps.length,
    elapsedSeconds: step.elapsedSeconds,
    timelineLabel: `${formatElapsedTime(step.elapsedSeconds)} · step ${stepIndex + 1} of ${results.steps.length}`,
    components,
    connections
  };
}
