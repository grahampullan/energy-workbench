import { integrateStepPowerkWh } from "../core/energy-integration.js";
import { materialDischarge } from "../core/material-discharge.js";
import { formatEngineeringValue } from "./engineering-format.js";

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
  const integrate = (values) => integrateStepPowerkWh(
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
  const integrate = (values) => integrateStepPowerkWh(
    values,
    results.time.timeStepSeconds
  );
  const temperaturesC = outputSeries(results, "store", "temperatureC");
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

export function createBatchHeatingRunKpis(results) {
  requireResults(results);
  const integrate = (values) => integrateStepPowerkWh(
    values,
    results.time.timeStepSeconds
  );
  const finalTemperatureC = outputSeries(
    results,
    "batch",
    "temperatureC"
  ).at(-1);
  const finalRequiredTemperatureMarginK = outputSeries(
    results,
    "batch",
    "temperatureMarginK"
  ).at(-1);

  return [
    kpi("grid-import-energy", "Grid import", integrate(
      outputSeries(results, "grid", "importPowerkW")
    ), "kWh"),
    kpi("heat-supplied-energy", "Heat supplied", integrate(
      outputSeries(results, "batch", "heatInputkW")
    ), "kWh"),
    kpi("heat-absorbed-energy", "Heat absorbed", integrate(
      outputSeries(results, "batch", "netEnergyFlowkW")
    ), "kWh"),
    kpi("heat-loss-energy", "Heat loss", integrate(
      outputSeries(results, "batch-loss", "heatFlowkW")
    ), "kWh"),
    kpi("final-batch-temperature", "Final batch temp", finalTemperatureC, "°C"),
    kpi(
      "required-temperature-margin",
      "Final temperature margin",
      finalRequiredTemperatureMarginK,
      "K",
      finalRequiredTemperatureMarginK < -1e-9 ? "warning" : "neutral"
    )
  ];
}

export function createMaterialInventoryRunKpis(results) {
  requireResults(results);
  const integrateEnergy = (field) => integrateStepPowerkWh(
    outputSeries(results, "inventory", field),
    results.time.timeStepSeconds
  );
  const integrateMass = (field) => outputSeries(
    results,
    "inventory",
    field
  ).reduce(
    (total, value) => total + value * results.time.timeStepSeconds,
    0
  );
  const temperaturesC = outputSeries(results, "inventory", "temperatureC");

  return [
    kpi("material-mass-in", "Material in", integrateMass(
      "massInflowKgPerSecond"
    ), "kg"),
    kpi("material-mass-out", "Material out", integrateMass(
      "massOutflowKgPerSecond"
    ), "kg"),
    kpi("material-enthalpy-in", "Material enthalpy in", integrateEnergy(
      "enthalpyInflowkW"
    ), "kWh"),
    kpi("heat-input-energy", "Heat supplied", integrateEnergy(
      "heatInputkW"
    ), "kWh"),
    kpi("material-enthalpy-out", "Material enthalpy out", integrateEnergy(
      "enthalpyOutflowkW"
    ), "kWh"),
    kpi("peak-inventory-temperature", "Peak inventory temp", Math.max(
      ...temperaturesC
    ), "°C")
  ];
}

export function createLadleRunKpis(results) {
  requireResults(results);
  const integrate = (componentId, field) => integrateStepPowerkWh(
    outputSeries(results, componentId, field),
    results.time.timeStepSeconds
  );
  const metalSteps = results.steps.map((step) =>
    componentAtStep(step, "metal").outputs
  );
  const tapSteps = metalSteps.filter(
    ({ massOutflowKgPerSecond }) => massOutflowKgPerSecond > 0
  );
  const discharges = results.steps.map((step) =>
    materialDischarge(componentAtStep(step, "metal"))
  );
  const totalRequestedKg = discharges.reduce(
    (total, discharge) => total + discharge.requestedKgPerSecond *
      results.time.timeStepSeconds,
    0
  );
  const totalUnmetKg = discharges.reduce(
    (total, discharge) => total + discharge.unmetKgPerSecond *
      results.time.timeStepSeconds,
    0
  );
  const totalMassOutKg = tapSteps.reduce(
    (total, output) => total + output.massOutflowKgPerSecond *
      results.time.timeStepSeconds,
    0
  );
  const minimumTapTemperatureC = tapSteps.length === 0 ? null : Math.min(
    ...tapSteps.map(({ materialOutflowTemperatureC }) => materialOutflowTemperatureC)
  );
  const minimumTapTemperatureMarginK = tapSteps.length === 0 ? null : Math.min(
    ...tapSteps.map(({ materialOutflowTemperatureMarginK }) => materialOutflowTemperatureMarginK)
  );

  return [
    kpi("ladle-fuel-input", "Fuel input", integrate(
      "burner",
      "fuelInputPowerkW"
    ), "kWh"),
    kpi("ladle-burner-heat", "Burner heat", integrate(
      "burner",
      "heatOutputkW"
    ), "kWh"),
    kpi("ladle-direct-emissions", "Direct emissions", integrate(
      "burner",
      "directEmissionsKgCO2PerHour"
    ), "kgCO2"),
    kpi("ladle-material-requested", "Discharge requested", totalRequestedKg, "kg"),
    kpi("ladle-material-out", "Actual discharge", totalMassOutKg, "kg"),
    kpi("ladle-material-unmet", "Unmet discharge", totalUnmetKg, "kg",
      totalUnmetKg > 1e-9 ? "warning" : "neutral"),
    kpi(
      "ladle-minimum-tap-temperature",
      "Minimum tap temp",
      minimumTapTemperatureC,
      "°C",
      minimumTapTemperatureMarginK < -1e-9 ? "warning" : "neutral"
    ),
    kpi(
      "ladle-delivery-margin",
      "Delivery margin",
      minimumTapTemperatureMarginK,
      "K",
      minimumTapTemperatureMarginK < -1e-9 ? "warning" : "neutral"
    ),
    kpi("ladle-heat-loss", "Heat loss", (
      integrate("refractory-loss", "heatFlowkW") +
      integrate("metal-loss", "heatFlowkW")
    ), "kWh")
  ];
}
