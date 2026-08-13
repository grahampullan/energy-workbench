export const ACTIVE_POWER_FLOW_TYPE = "electricity.active-power";
export const THERMAL_HEAT_FLOW_TYPE = "thermal.heat-flow";
export const ABSOLUTE_ZERO_C = -273.15;

const ACTIVE_POWER_FIELDS = Object.freeze({
  powerkW: Object.freeze({ unit: "kW" })
});
const THERMAL_HEAT_FLOW_FIELDS = Object.freeze({
  heatFlowkW: Object.freeze({ unit: "kW" }),
  sourceTemperatureC: Object.freeze({ unit: "°C" }),
  deliveryTemperatureC: Object.freeze({ unit: "°C" })
});

const FLOW_TYPES = Object.freeze([
  Object.freeze({
    id: ACTIVE_POWER_FLOW_TYPE,
    fields: ACTIVE_POWER_FIELDS
  }),
  Object.freeze({
    id: THERMAL_HEAT_FLOW_TYPE,
    fields: THERMAL_HEAT_FLOW_FIELDS
  })
]);
const FLOW_TYPES_BY_ID = new Map(
  FLOW_TYPES.map((flowType) => [flowType.id, flowType])
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(flow, fieldNames) {
  const fields = Object.keys(flow);
  return fields.length === fieldNames.length &&
    fields.every((field) => fieldNames.includes(field));
}

export function hasFlowType(id) {
  return FLOW_TYPES_BY_ID.has(id);
}

export function getFlowType(id) {
  return FLOW_TYPES_BY_ID.get(id);
}

export function flowValidationMessage(flowType, flow, { direction } = {}) {
  const definition = getFlowType(flowType);
  if (!definition) {
    return `Unknown flow type: ${flowType}`;
  }
  if (!isRecord(flow)) {
    return `${flowType} flow must be an object`;
  }

  const fieldNames = Object.keys(definition.fields);
  if (!hasExactFields(flow, fieldNames)) {
    return `${flowType} flow must contain exactly ${fieldNames.join(", ")}`;
  }

  if (flowType === ACTIVE_POWER_FLOW_TYPE) {
    if (!Number.isFinite(flow.powerkW)) {
      return "powerkW must be a finite number";
    }
    if (direction !== "bidirectional" && flow.powerkW < 0) {
      return "powerkW must be non-negative on a directed port";
    }
    return null;
  }

  if (!Number.isFinite(flow.heatFlowkW) || flow.heatFlowkW < 0) {
    return "heatFlowkW must be a finite, non-negative number";
  }
  for (const temperature of ["sourceTemperatureC", "deliveryTemperatureC"]) {
    if (!Number.isFinite(flow[temperature]) || flow[temperature] < ABSOLUTE_ZERO_C) {
      return `${temperature} must be finite and no lower than absolute zero`;
    }
  }
  if (
    flow.heatFlowkW > 0 &&
    flow.deliveryTemperatureC > flow.sourceTemperatureC
  ) {
    return "A positive directed heat flow cannot be delivered above its source temperature";
  }
  return null;
}

export function createFlow(flowType, flow, options) {
  const validationMessage = flowValidationMessage(flowType, flow, options);
  if (validationMessage) {
    throw new TypeError(validationMessage);
  }
  return Object.freeze({ ...flow });
}
