import {
  ABSOLUTE_ZERO_C,
  MATERIAL_MASS_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";
import {
  createMaterialFlow,
  materialEnthalpyFlowkW
} from "../../core/material-flow.js";
import { createThermalFlow } from "../../core/thermal-flow.js";
import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

const TOLERANCE = 1e-9;

function parameterValue(component, field) {
  return component.parameters[field] ??
    heatedMaterialInventoryDefinition.parameters[field].default;
}

function initialStateValue(component, field) {
  return component.initialState[field] ??
    heatedMaterialInventoryDefinition.initialState[field].default;
}

function specificEnthalpyKjPerKg(state) {
  return state.massKg === 0
    ? 0
    : state.containedEnthalpykWh * 3600 / state.massKg;
}

function temperatureC(runtimeComponent, state) {
  return runtimeComponent.parameters.enthalpyReferenceTemperatureC +
    specificEnthalpyKjPerKg(state) /
      runtimeComponent.parameters.specificHeatCapacityKjPerKgK;
}

function normaliseZero(value) {
  return Math.abs(value) <= TOLERANCE ? 0 : value;
}

function inventoryConnections(runtimeComponent, context) {
  const materialIn = singleConnection(runtimeComponent, context, "material-in");
  const materialOut = singleConnection(runtimeComponent, context, "material-out");
  const heatIn = singleConnection(runtimeComponent, context, "heat-in");
  if (
    materialIn.to.component !== runtimeComponent ||
    materialOut.from.component !== runtimeComponent ||
    heatIn.to.component !== runtimeComponent
  ) {
    throw resolutionError(
      "runtime.unsupported-inventory-topology",
      `Connections around ${runtimeComponent.id} have the wrong direction`
    );
  }
  return {
    materialIn,
    materialOut,
    heatIn,
    heater: heatIn.from.component
  };
}

function finiteCapability(limits, field, { positive = false } = {}) {
  const value = limits?.[field];
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      `Thermal capability ${field} is missing or invalid`
    );
  }
  return value;
}

function requireOutflowTarget(runtimeComponent, context) {
  const value = context.target?.massOutflowKgPerSecond;
  if (!Number.isFinite(value) || value < 0) {
    throw resolutionError(
      "runtime.missing-policy-target",
      `Policy did not provide a finite, non-negative mass-outflow target for ${runtimeComponent.id}`
    );
  }
  return value;
}

export const heatedMaterialInventoryDefinition = {
  type: "process.heated-material-inventory",
  version: "0.1.0",
  name: "Heated material inventory",

  parameters: {
    maximumMassKg: {
      unit: "kg",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 10 }
    },
    specificHeatCapacityKjPerKgK: {
      unit: "kJ / kgK",
      default: 1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0.1, maximum: 5, step: 0.1 }
    },
    enthalpyReferenceTemperatureC: {
      unit: "°C",
      default: 0,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: -50, maximum: 200, step: 5 }
    }
  },
  initialState: {
    massKg: { unit: "kg", default: 0 },
    containedEnthalpykWh: { unit: "kWh", default: 0 }
  },
  ports: [
    {
      id: "material-in",
      flowType: MATERIAL_MASS_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "material-out",
      flowType: MATERIAL_MASS_FLOW_TYPE,
      direction: "out"
    },
    {
      id: "heat-in",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in"
    }
  ],
  outputs: {
    massInflowKgPerSecond: { unit: "kg/s" },
    massOutflowKgPerSecond: { unit: "kg/s" },
    enthalpyInflowkW: { unit: "kW" },
    enthalpyOutflowkW: { unit: "kW" },
    heatInputkW: { unit: "kW" },
    containedMassKg: { unit: "kg" },
    containedEnthalpykWh: { unit: "kWh" },
    specificEnthalpyKjPerKg: { unit: "kJ/kg" },
    temperatureC: { unit: "°C" }
  },
  editor: {
    summaryOutput: "temperatureC",
    temperatureChart: { outputField: "temperatureC" }
  },

  validate(modelComponent) {
    const maximumMassKg = parameterValue(modelComponent, "maximumMassKg");
    const specificHeatCapacityKjPerKgK = parameterValue(
      modelComponent,
      "specificHeatCapacityKjPerKgK"
    );
    const referenceTemperatureC = parameterValue(
      modelComponent,
      "enthalpyReferenceTemperatureC"
    );
    const massKg = initialStateValue(modelComponent, "massKg");
    const containedEnthalpykWh = initialStateValue(
      modelComponent,
      "containedEnthalpykWh"
    );
    const diagnostics = [];
    if (!Number.isFinite(specificHeatCapacityKjPerKgK) || specificHeatCapacityKjPerKgK <= 0) {
      diagnostics.push({
        code: "process.heated-material-inventory.specific-heat-capacity",
        message: "Specific heat capacity must be finite and greater than zero"
      });
    }
    if (!Number.isFinite(massKg) || massKg < 0 || massKg > maximumMassKg) {
      diagnostics.push({
        code: "process.heated-material-inventory.initial-mass",
        message: "Initial mass must be finite and within inventory capacity"
      });
    }
    if (!Number.isFinite(containedEnthalpykWh)) {
      diagnostics.push({
        code: "process.heated-material-inventory.initial-enthalpy",
        message: "Initial contained enthalpy must be finite"
      });
    } else if (massKg === 0 && containedEnthalpykWh !== 0) {
      diagnostics.push({
        code: "process.heated-material-inventory.empty-enthalpy",
        message: "An empty inventory must have zero contained enthalpy"
      });
    } else if (
      massKg > 0 &&
      Number.isFinite(specificHeatCapacityKjPerKgK) &&
      specificHeatCapacityKjPerKgK > 0 &&
      referenceTemperatureC +
        containedEnthalpykWh * 3600 /
          massKg /
          specificHeatCapacityKjPerKgK < ABSOLUTE_ZERO_C
    ) {
      diagnostics.push({
        code: "process.heated-material-inventory.initial-temperature",
        message: "Initial inventory temperature cannot be below absolute zero"
      });
    }
    return diagnostics;
  },

  resolution: {
    describe(runtimeComponent, context) {
      const { materialIn, materialOut, heatIn, heater } = inventoryConnections(
        runtimeComponent,
        context
      );
      return resolutionDescription({
        targets: [runtimeComponent.id, heater.id],
        connectionFlows: [materialIn.id],
        determines: [materialOut.id, heatIn.id]
      });
    }
  },

  model: {
    prepare() {
      return {};
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      return {
        maximumMassOutflowKgPerSecond:
          stepContext.state.massKg / stepContext.timeStepSeconds,
        containedMassKg: stepContext.state.massKg,
        containedEnthalpykWh: stepContext.state.containedEnthalpykWh,
        temperatureC: temperatureC(runtimeComponent, stepContext.state)
      };
    },

    resolve(runtimeComponent, context) {
      const { materialIn, materialOut, heatIn, heater } = inventoryConnections(
        runtimeComponent,
        context
      );
      const materialInFlow = context.getConnectionFlow(materialIn.id);
      if (materialInFlow === undefined) {
        return null;
      }
      const requestedOutflow = requireOutflowTarget(runtimeComponent, context);
      const massOutflowKgPerSecond = Math.min(
        requestedOutflow,
        context.operatingLimits.maximumMassOutflowKgPerSecond
      );
      const materialOutFlow = createMaterialFlow({
        massFlowKgPerSecond: massOutflowKgPerSecond,
        specificEnthalpyKjPerKg: specificEnthalpyKjPerKg({
          massKg: context.operatingLimits.containedMassKg,
          containedEnthalpykWh:
            context.operatingLimits.containedEnthalpykWh
        })
      });
      const heaterTarget = context.getTarget(heater.id);
      if (!heaterTarget || !Number.isFinite(heaterTarget.powerkW)) {
        throw resolutionError(
          "runtime.missing-policy-target",
          `Policy did not provide a finite power target for ${heater.id}`
        );
      }
      const heaterLimits = context.getOperatingLimits(heater.id);
      const conversion = finiteCapability(
        heaterLimits,
        "heatOutputPerElectricalInput",
        { positive: true }
      );
      const maximumHeatOutputkW = finiteCapability(
        heaterLimits,
        "maximumHeatOutputkW"
      );
      const supplyTemperatureC = heaterLimits?.supplyTemperatureC;
      if (!Number.isFinite(supplyTemperatureC)) {
        throw resolutionError(
          "runtime.thermal-capability-contract",
          `Thermal capability supplyTemperatureC is missing or invalid`
        );
      }
      const requestedPowerkW = Math.min(
        heaterLimits.maximumPowerkW,
        Math.max(heaterLimits.minimumPowerkW, heaterTarget.powerkW)
      );
      const heatInFlow = createThermalFlow({
        heatFlowkW: Math.min(
          maximumHeatOutputkW,
          -requestedPowerkW * conversion
        ),
        sourceTemperatureC: supplyTemperatureC,
        deliveryTemperatureC: supplyTemperatureC
      });
      const command = {
        materialInFlow: createMaterialFlow(materialInFlow),
        materialOutFlow,
        heatInFlow
      };
      return {
        feasibleCommand: { massOutflowKgPerSecond },
        actualCommand: command,
        connectionFlows: {
          [materialOut.id]: materialOutFlow,
          [heatIn.id]: heatInFlow
        }
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const materialInFlow = createMaterialFlow(actualCommand?.materialInFlow);
      const materialOutFlow = createMaterialFlow(actualCommand?.materialOutFlow);
      const heatInFlow = createThermalFlow(actualCommand?.heatInFlow);
      const enthalpyInflowkW = materialEnthalpyFlowkW(materialInFlow);
      const enthalpyOutflowkW = materialEnthalpyFlowkW(materialOutFlow);
      const nextMassKg = normaliseZero(
        stepContext.state.massKg +
          (materialInFlow.massFlowKgPerSecond -
            materialOutFlow.massFlowKgPerSecond) *
            stepContext.timeStepSeconds
      );
      const nextEnthalpykWh = normaliseZero(
        stepContext.state.containedEnthalpykWh +
          (enthalpyInflowkW + heatInFlow.heatFlowkW - enthalpyOutflowkW) *
            stepContext.durationHours
      );
      if (
        nextMassKg < 0 ||
        nextMassKg > runtimeComponent.parameters.maximumMassKg + TOLERANCE
      ) {
        throw new RangeError("Material inventory mass is outside its capacity");
      }
      if (nextMassKg === 0 && nextEnthalpykWh !== 0) {
        throw new RangeError("An empty material inventory cannot contain enthalpy");
      }
      const nextState = {
        massKg: nextMassKg,
        containedEnthalpykWh: nextEnthalpykWh
      };
      const nextTemperatureC = temperatureC(runtimeComponent, nextState);
      if (nextTemperatureC < ABSOLUTE_ZERO_C) {
        throw new RangeError("Material inventory temperature is below absolute zero");
      }
      return {
        portFlows: {
          "material-in": materialInFlow,
          "material-out": materialOutFlow,
          "heat-in": heatInFlow
        },
        outputs: {
          massInflowKgPerSecond: materialInFlow.massFlowKgPerSecond,
          massOutflowKgPerSecond: materialOutFlow.massFlowKgPerSecond,
          enthalpyInflowkW,
          enthalpyOutflowkW,
          heatInputkW: heatInFlow.heatFlowkW,
          containedMassKg: nextMassKg,
          containedEnthalpykWh: nextEnthalpykWh,
          specificEnthalpyKjPerKg: specificEnthalpyKjPerKg(nextState),
          temperatureC: nextTemperatureC
        },
        nextState,
        diagnostics: []
      };
    }
  }
};
