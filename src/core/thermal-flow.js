export const THERMAL_FLOW_MEDIUM = "thermal.heat-flow";
export const ABSOLUTE_ZERO_C = -273.15;

const THERMAL_FLOW_FIELDS = new Set([
  "heatFlowKw",
  "sourceTemperatureC",
  "deliveryTemperatureC"
]);

export function thermalFlowValidationMessage(flow) {
  if (flow === null || typeof flow !== "object" || Array.isArray(flow)) {
    return "Thermal flow must be an object";
  }
  const fields = Object.keys(flow);
  if (
    fields.length !== THERMAL_FLOW_FIELDS.size ||
    fields.some((field) => !THERMAL_FLOW_FIELDS.has(field))
  ) {
    return "Thermal flow must contain exactly heatFlowKw, sourceTemperatureC, and deliveryTemperatureC";
  }
  if (!Number.isFinite(flow.heatFlowKw) || flow.heatFlowKw < 0) {
    return "heatFlowKw must be a finite, non-negative number";
  }
  for (const temperature of ["sourceTemperatureC", "deliveryTemperatureC"]) {
    if (!Number.isFinite(flow[temperature]) || flow[temperature] < ABSOLUTE_ZERO_C) {
      return `${temperature} must be finite and no lower than absolute zero`;
    }
  }
  if (
    flow.heatFlowKw > 0 &&
    flow.deliveryTemperatureC > flow.sourceTemperatureC
  ) {
    return "A positive directed heat flow cannot be delivered above its source temperature";
  }
  return null;
}

export function createThermalFlow(flow = {}) {
  const validationMessage = thermalFlowValidationMessage(flow);
  if (validationMessage) {
    throw new TypeError(validationMessage);
  }
  const { heatFlowKw, sourceTemperatureC, deliveryTemperatureC } = flow;
  return Object.freeze({ heatFlowKw, sourceTemperatureC, deliveryTemperatureC });
}

export function calculateStandingHeatLoss({
  thermalCapacityKwhPerK,
  heatLossCoefficientKwPerK,
  temperatureC,
  ambientTemperatureC,
  chargeHeatFlowKw,
  dischargeHeatFlowKw,
  durationHours
} = {}) {
  const positiveValues = {
    thermalCapacityKwhPerK,
    durationHours
  };
  const nonNegativeValues = {
    heatLossCoefficientKwPerK,
    chargeHeatFlowKw,
    dischargeHeatFlowKw
  };
  if (Object.values(positiveValues).some(
    (value) => !Number.isFinite(value) || value <= 0
  )) {
    throw new TypeError("Thermal capacity and duration must be finite and positive");
  }
  if (Object.values(nonNegativeValues).some(
    (value) => !Number.isFinite(value) || value < 0
  )) {
    throw new TypeError("Heat-loss coefficient and heat flows must be finite and non-negative");
  }
  if (
    !Number.isFinite(temperatureC) ||
    !Number.isFinite(ambientTemperatureC) ||
    temperatureC < ABSOLUTE_ZERO_C ||
    ambientTemperatureC < ABSOLUTE_ZERO_C
  ) {
    throw new TypeError("Standing-loss temperatures must be finite and no lower than absolute zero");
  }

  const unconstrainedHeatLossKw = heatLossCoefficientKwPerK *
    Math.max(0, temperatureC - ambientTemperatureC);
  const energyAboveAmbientBeforeLossKwh = Math.max(
    0,
    thermalCapacityKwhPerK * (temperatureC - ambientTemperatureC) +
      (chargeHeatFlowKw - dischargeHeatFlowKw) * durationHours
  );
  return Object.freeze({
    unconstrainedHeatLossKw,
    heatLossKw: Math.min(
      unconstrainedHeatLossKw,
      energyAboveAmbientBeforeLossKwh / durationHours
    )
  });
}
