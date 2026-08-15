const ELECTRIC_HEATER_TYPE = "thermal.electric-heater";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function requireHeater(runtimeModel, heaterComponentId) {
  const heater = runtimeModel.components.find(
    (component) => component.id === heaterComponentId
  );
  if (!heater) {
    throw new Error(`Heater component does not exist: ${heaterComponentId}`);
  }
  if (heater.type !== ELECTRIC_HEATER_TYPE) {
    throw new Error(`Heater ${heaterComponentId} must use ${ELECTRIC_HEATER_TYPE}`);
  }
}

function requirePowerSeries(runtimeModel, powerSeriesId) {
  const series = runtimeModel.series.find(
    (candidate) => candidate.id === powerSeriesId
  );
  if (!series) {
    throw new Error(`Scheduled-heating series does not exist: ${powerSeriesId}`);
  }
  if (series.unit !== "kW") {
    throw new Error(
      `Scheduled-heating series ${powerSeriesId} must use kW, not ${series.unit}`
    );
  }
}

export function createScheduledHeatingPolicy({
  heaterComponentId,
  powerSeriesId,
  balancingComponentId
} = {}) {
  requireNonEmptyString(heaterComponentId, "heaterComponentId");
  requireNonEmptyString(powerSeriesId, "powerSeriesId");
  requireNonEmptyString(balancingComponentId, "balancingComponentId");

  return Object.freeze({
    request(runtimeModel, stepContext) {
      requireHeater(runtimeModel, heaterComponentId);
      requirePowerSeries(runtimeModel, powerSeriesId);
      const electricalInputPowerkW = stepContext.seriesValues[powerSeriesId];
      if (!Number.isFinite(electricalInputPowerkW) || electricalInputPowerkW < 0) {
        throw new RangeError(
          "Scheduled heater input must be a finite, non-negative power in kW"
        );
      }
      return {
        targets: {
          [heaterComponentId]: { powerkW: -electricalInputPowerkW }
        },
        balancingComponentId
      };
    }
  });
}
