import { formatEngineeringValue } from "./workbench-view-model.js";
import { integratePowerSerieskWh } from "./results-chart-model.js";

function requireResults(results) {
  if (
    !results ||
    !Array.isArray(results.steps) ||
    results.steps.length === 0 ||
    !Number.isFinite(results.time?.timeStepSeconds) ||
    results.time.timeStepSeconds <= 0
  ) {
    throw new TypeError("Completed run results with a positive timestep are required");
  }
}

function componentAtStep(step, componentId) {
  const component = step.components.find(
    (candidate) => candidate.componentId === componentId
  );
  if (!component) {
    throw new Error(`Run results do not contain component: ${componentId}`);
  }
  return component;
}

function outputSeries(results, componentId, outputId) {
  return results.steps.map((step) => {
    const value = componentAtStep(step, componentId).outputs[outputId];
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Component ${componentId} output ${outputId} must be finite`
      );
    }
    return value;
  });
}

function stateSeries(results, componentId, stateId) {
  return results.steps.map((step) => {
    const value = componentAtStep(step, componentId).state[stateId];
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Component ${componentId} state ${stateId} must be finite`
      );
    }
    return value;
  });
}

function integrateFixedStep(values, timeStepSeconds) {
  const durationHours = timeStepSeconds / 3600;
  return values.reduce((total, value) => total + value * durationHours, 0);
}

function kpi(id, label, value, unit, tone = "neutral") {
  return {
    id,
    label,
    value,
    unit,
    tone,
    displayValue: formatEngineeringValue(value, unit)
  };
}

export function createElectricalRunKpis(results) {
  requireResults(results);
  const integrate = (values) => integratePowerSerieskWh(
    values,
    results.time.timeStepSeconds
  );

  return [
    kpi("load-energy", "Load energy", integrate(
      outputSeries(results, "load", "suppliedPowerkW")
    ), "kWh"),
    kpi("solar-energy", "Solar energy", integrate(
      outputSeries(results, "pv", "powerkW")
    ), "kWh"),
    kpi("grid-import-energy", "Grid import", integrate(
      outputSeries(results, "grid", "importPowerkW")
    ), "kWh"),
    kpi("grid-export-energy", "Grid export", integrate(
      outputSeries(results, "grid", "exportPowerkW")
    ), "kWh"),
    kpi("battery-charge-energy", "Battery charge", integrate(
      outputSeries(results, "battery", "chargePowerkW")
    ), "kWh"),
    kpi("battery-discharge-energy", "Battery discharge", integrate(
      outputSeries(results, "battery", "dischargePowerkW")
    ), "kWh")
  ];
}

export function createCoupledThermalRunKpis(results) {
  requireResults(results);
  const integrate = (values) => integrateFixedStep(
    values,
    results.time.timeStepSeconds
  );
  const temperaturesC = stateSeries(results, "store", "temperatureC");
  const unmetEnergykWh = integrate(
    outputSeries(results, "heat-demand", "unmetHeatFlowkW")
  );

  return [
    kpi("grid-import-energy", "Grid import", integrate(
      outputSeries(results, "grid", "importPowerkW")
    ), "kWh"),
    kpi("heat-demand-energy", "Heat demand", integrate(
      outputSeries(results, "heat-demand", "demandHeatFlowkW")
    ), "kWh"),
    kpi("served-heat-energy", "Served heat", integrate(
      outputSeries(results, "heat-demand", "servedHeatFlowkW")
    ), "kWh"),
    kpi(
      "unmet-heat-energy",
      "Unmet heat",
      unmetEnergykWh,
      "kWh",
      unmetEnergykWh > 1e-9 ? "warning" : "neutral"
    ),
    kpi("minimum-store-temperature", "Minimum store temp", Math.min(
      ...temperaturesC
    ), "°C"),
    kpi("final-store-temperature", "Final store temp", temperaturesC.at(-1), "°C")
  ];
}
