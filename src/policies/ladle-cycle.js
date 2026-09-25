const BURNER_TYPE = "thermal.fuel-burner";
const STORE_TYPE = "thermal.store";
const PREHEAT_MODE = 1;
const TAP_MODE = 4;

export const LADLE_PROCESS_MODES = Object.freeze({
  idle: 0,
  preheat: PREHEAT_MODE,
  setup: 2,
  fill: 3,
  tap: TAP_MODE,
  hold: 5
});

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function component(runtimeModel, componentId, type, label) {
  const found = runtimeModel.components.find(({ id }) => id === componentId);
  if (!found || found.type !== type) {
    throw new Error(`${label} ${componentId} must use ${type}`);
  }
  return found;
}

function inlineSeries(runtimeModel, seriesId, unit, label) {
  const found = runtimeModel.series.find(({ id }) => id === seriesId);
  if (!found || found.unit !== unit || found.data.kind !== "inline") {
    throw new Error(`${label} ${seriesId} must be inline and use ${unit}`);
  }
  return found;
}

function nonNegativeStepValue(stepContext, seriesId, label) {
  const value = stepContext.seriesValues[seriesId];
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
  return value;
}

function processMode(stepContext, modeSeriesId) {
  const mode = stepContext.seriesValues[modeSeriesId];
  if (!Number.isInteger(mode) || !Object.values(LADLE_PROCESS_MODES).includes(mode)) {
    throw new RangeError("Ladle process mode must be a declared integer mode code");
  }
  return mode;
}

function minimumFuelHeatTarget({
  runtimeModel,
  stepContext,
  policyContext,
  burnerComponentId,
  refractoryComponentId,
  modeSeries,
  operatingMarginK
}) {
  const burnerLimits = policyContext.operatingLimitsByComponentId[
    burnerComponentId
  ];
  const refractoryLimits = policyContext.operatingLimitsByComponentId[
    refractoryComponentId
  ];
  const requiredLimits = [
    burnerLimits?.maximumHeatOutputkW,
    refractoryLimits?.temperatureC,
    refractoryLimits?.thermalCapacitykWhPerK,
    refractoryLimits?.minimumUsefulTemperatureC,
    refractoryLimits?.maximumTemperatureC
  ];
  if (requiredLimits.some((value) => !Number.isFinite(value))) {
    throw new Error(
      "Minimum-fuel ladle policy requires burner output and refractory temperature capabilities"
    );
  }

  let remainingPreheatSteps = 0;
  for (
    let index = stepContext.stepIndex;
    index < modeSeries.data.values.length &&
      modeSeries.data.values[index] === PREHEAT_MODE;
    index += 1
  ) {
    remainingPreheatSteps += 1;
  }
  if (remainingPreheatSteps === 0) {
    return 0;
  }
  const targetTemperatureC = Math.min(
    refractoryLimits.maximumTemperatureC,
    refractoryLimits.minimumUsefulTemperatureC + operatingMarginK
  );
  const remainingDurationHours = remainingPreheatSteps *
    runtimeModel.time.timeStepSeconds / 3600;
  const heatOutputkW = refractoryLimits.thermalCapacitykWhPerK * Math.max(
    0,
    targetTemperatureC - refractoryLimits.temperatureC
  ) / remainingDurationHours;
  return Math.min(burnerLimits.maximumHeatOutputkW, heatOutputkW);
}

export function createLadleCyclePolicy({
  burnerComponentId,
  refractoryComponentId,
  inventoryComponentId,
  modeSeriesId,
  historicalHeatOutputSeriesId,
  outflowSeriesId,
  strategy = "historical",
  operatingMarginK = 5
} = {}) {
  for (const [value, label] of [
    [burnerComponentId, "burnerComponentId"],
    [refractoryComponentId, "refractoryComponentId"],
    [inventoryComponentId, "inventoryComponentId"],
    [modeSeriesId, "modeSeriesId"],
    [historicalHeatOutputSeriesId, "historicalHeatOutputSeriesId"],
    [outflowSeriesId, "outflowSeriesId"]
  ]) {
    requireNonEmptyString(value, label);
  }
  if (!new Set(["historical", "minimum-fuel"]).has(strategy)) {
    throw new TypeError("strategy must be historical or minimum-fuel");
  }
  if (!Number.isFinite(operatingMarginK) || operatingMarginK < 0) {
    throw new TypeError("operatingMarginK must be finite and non-negative");
  }

  return Object.freeze({
    request(runtimeModel, stepContext, policyContext) {
      component(runtimeModel, burnerComponentId, BURNER_TYPE, "Burner");
      component(runtimeModel, refractoryComponentId, STORE_TYPE, "Refractory");
      component(runtimeModel, inventoryComponentId, STORE_TYPE, "Inventory");
      const modeSeries = inlineSeries(
        runtimeModel,
        modeSeriesId,
        "mode-code",
        "Process-mode series"
      );
      inlineSeries(
        runtimeModel,
        historicalHeatOutputSeriesId,
        "kW",
        "Historical burner-output series"
      );
      inlineSeries(
        runtimeModel,
        outflowSeriesId,
        "kg/s",
        "Material-outflow series"
      );

      const mode = processMode(stepContext, modeSeriesId);
      const massOutflowKgPerSecond = nonNegativeStepValue(
        stepContext,
        outflowSeriesId,
        "Scheduled material outflow"
      );
      if (massOutflowKgPerSecond > 0 && mode !== TAP_MODE) {
        throw new Error("Material outflow is only permitted in tap mode");
      }

      const historicalHeatOutputkW = nonNegativeStepValue(
        stepContext,
        historicalHeatOutputSeriesId,
        "Historical burner output"
      );
      if (historicalHeatOutputkW > 0 && mode !== PREHEAT_MODE) {
        throw new Error("Historical burner output is only permitted in preheat mode");
      }
      const heatOutputkW = mode !== PREHEAT_MODE
        ? 0
        : strategy === "historical"
          ? historicalHeatOutputkW
          : minimumFuelHeatTarget({
              runtimeModel,
              stepContext,
              policyContext,
              burnerComponentId,
              refractoryComponentId,
              modeSeries,
              operatingMarginK
            });

      return {
        targets: {
          [burnerComponentId]: { heatOutputkW },
          [inventoryComponentId]: { massOutflowKgPerSecond }
        },
        balancingComponentId: null
      };
    }
  });
}
