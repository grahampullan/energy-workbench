import {
  ABSOLUTE_ZERO_C,
  createFlow,
  flowValidationMessage,
  THERMAL_HEAT_FLOW_TYPE
} from "./flow-types.js";

export { ABSOLUTE_ZERO_C };

export function thermalFlowValidationMessage(flow) {
  return flowValidationMessage(THERMAL_HEAT_FLOW_TYPE, flow);
}

export function createThermalFlow(flow = {}) {
  return createFlow(THERMAL_HEAT_FLOW_TYPE, flow);
}

export function calculateStandingHeatLoss({
  thermalCapacitykWhPerK,
  heatLossCoefficientkWPerK,
  temperatureC,
  ambientTemperatureC,
  chargeHeatFlowkW,
  dischargeHeatFlowkW,
  durationHours
} = {}) {
  const positiveValues = {
    thermalCapacitykWhPerK,
    durationHours
  };
  const nonNegativeValues = {
    heatLossCoefficientkWPerK,
    chargeHeatFlowkW,
    dischargeHeatFlowkW
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

  const unconstrainedHeatLosskW = heatLossCoefficientkWPerK *
    Math.max(0, temperatureC - ambientTemperatureC);
  const energyAboveAmbientBeforeLosskWh = Math.max(
    0,
    thermalCapacitykWhPerK * (temperatureC - ambientTemperatureC) +
      (chargeHeatFlowkW - dischargeHeatFlowkW) * durationHours
  );
  return Object.freeze({
    unconstrainedHeatLosskW,
    heatLosskW: Math.min(
      unconstrainedHeatLosskW,
      energyAboveAmbientBeforeLosskWh / durationHours
    )
  });
}
