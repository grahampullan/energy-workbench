import {
  ABSOLUTE_ZERO_C,
  calculateStandingHeatLoss,
  createThermalFlow,
  THERMAL_FLOW_MEDIUM
} from "../../core/thermal-flow.js";

function componentValue(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function thermalCapacityKwhPerK(parameters) {
  return parameters.volumeM3 *
    parameters.waterDensityKgPerM3 *
    parameters.specificHeatCapacityKjPerKgK /
    3600;
}

function requireNonNegativePower(command, field) {
  if (!Number.isFinite(command?.[field]) || command[field] < 0) {
    throw new TypeError(`${field} must be a finite, non-negative power in kW`);
  }
  return command[field];
}

function requireTemperature(command, field) {
  if (!Number.isFinite(command?.[field]) || command[field] < ABSOLUTE_ZERO_C) {
    throw new TypeError(`${field} must be finite and no lower than absolute zero`);
  }
  return command[field];
}

const STORE_COMMAND_FIELDS = new Set([
  "chargeHeatFlowKw",
  "chargeSourceTemperatureC",
  "chargeDeliveryTemperatureC",
  "dischargeHeatFlowKw",
  "ambientTemperatureC"
]);

function requireStoreCommand(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw new TypeError("Hot-water store command must be an object");
  }
  const fields = Object.keys(command);
  if (
    fields.length !== STORE_COMMAND_FIELDS.size ||
    fields.some((field) => !STORE_COMMAND_FIELDS.has(field))
  ) {
    throw new TypeError(
      "Hot-water store command must contain exactly charge heat flow and temperatures, discharge heat flow, and ambient temperature"
    );
  }
}

export const hotWaterStoreDefinition = {
  type: "thermal.hot-water-store",
  version: "0.1.0",
  name: "Hot-water store",

  parameters: {
    volumeM3: {
      unit: "m³",
      default: 100,
      hardBounds: { minimum: 0 },
      editor: { minimum: 1, maximum: 500, step: 1 }
    },
    waterDensityKgPerM3: {
      unit: "kg/m³",
      default: 997,
      hardBounds: { minimum: 0 },
      editor: { minimum: 950, maximum: 1000, step: 1 }
    },
    specificHeatCapacityKjPerKgK: {
      unit: "kJ/(kg·K)",
      default: 4.186,
      hardBounds: { minimum: 0 },
      editor: { minimum: 3.5, maximum: 4.5, step: 0.001 }
    },
    maximumTemperatureC: {
      unit: "°C",
      default: 95,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 40, maximum: 150, step: 1 }
    },
    heatLossCoefficientKwPerK: {
      unit: "kW/K",
      default: 1.2,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10, step: 0.1 }
    },
    maximumChargeHeatFlowKw: {
      unit: "kW",
      default: 800,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 10 }
    },
    maximumDischargeHeatFlowKw: {
      unit: "kW",
      default: 800,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 10 }
    },
    minimumUsefulTemperatureC: {
      unit: "°C",
      default: 70,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 20, maximum: 150, step: 1 }
    }
  },

  initialState: {
    temperatureC: {
      unit: "°C",
      default: 65
    }
  },

  ports: [
    {
      id: "heat-in",
      medium: THERMAL_FLOW_MEDIUM,
      direction: "in"
    },
    {
      id: "heat-out",
      medium: THERMAL_FLOW_MEDIUM,
      direction: "out"
    },
    {
      id: "heat-loss",
      medium: THERMAL_FLOW_MEDIUM,
      direction: "out"
    }
  ],

  outputs: {
    chargeHeatFlowKw: { unit: "kW" },
    dischargeHeatFlowKw: { unit: "kW" },
    heatLossKw: { unit: "kW" },
    netHeatFlowKw: { unit: "kW" },
    temperatureC: { unit: "°C" },
    usableEnergyKwh: { unit: "kWh" },
    deliveryTemperatureMarginK: { unit: "K" }
  },

  editor: {
    groups: [
      {
        id: "storage",
        label: "Storage",
        parameters: [
          "volumeM3",
          "maximumTemperatureC",
          "minimumUsefulTemperatureC"
        ]
      },
      {
        id: "limits",
        label: "Heat-flow limits",
        parameters: [
          "maximumChargeHeatFlowKw",
          "maximumDischargeHeatFlowKw"
        ]
      },
      {
        id: "losses",
        label: "Thermal properties",
        parameters: [
          "heatLossCoefficientKwPerK",
          "waterDensityKgPerM3",
          "specificHeatCapacityKjPerKgK"
        ]
      }
    ]
  },

  validate(modelComponent) {
    const diagnostics = [];
    const volumeM3 = componentValue(
      modelComponent.parameters,
      hotWaterStoreDefinition.parameters,
      "volumeM3"
    );
    const waterDensityKgPerM3 = componentValue(
      modelComponent.parameters,
      hotWaterStoreDefinition.parameters,
      "waterDensityKgPerM3"
    );
    const specificHeatCapacityKjPerKgK = componentValue(
      modelComponent.parameters,
      hotWaterStoreDefinition.parameters,
      "specificHeatCapacityKjPerKgK"
    );
    const maximumTemperatureC = componentValue(
      modelComponent.parameters,
      hotWaterStoreDefinition.parameters,
      "maximumTemperatureC"
    );
    const minimumUsefulTemperatureC = componentValue(
      modelComponent.parameters,
      hotWaterStoreDefinition.parameters,
      "minimumUsefulTemperatureC"
    );
    const initialTemperatureC = componentValue(
      modelComponent.initialState,
      hotWaterStoreDefinition.initialState,
      "temperatureC"
    );

    if (!Number.isFinite(volumeM3) || volumeM3 <= 0) {
      diagnostics.push({
        code: "thermal.hot-water-store.volume",
        message: "Hot-water store volume must be greater than zero"
      });
    }
    if (!Number.isFinite(waterDensityKgPerM3) || waterDensityKgPerM3 <= 0) {
      diagnostics.push({
        code: "thermal.hot-water-store.water-density",
        message: "Water density must be greater than zero"
      });
    }
    if (
      !Number.isFinite(specificHeatCapacityKjPerKgK) ||
      specificHeatCapacityKjPerKgK <= 0
    ) {
      diagnostics.push({
        code: "thermal.hot-water-store.specific-heat-capacity",
        message: "Specific heat capacity must be greater than zero"
      });
    }
    if (
      Number.isFinite(minimumUsefulTemperatureC) &&
      Number.isFinite(maximumTemperatureC) &&
      minimumUsefulTemperatureC >= maximumTemperatureC
    ) {
      diagnostics.push({
        code: "thermal.hot-water-store.temperature-range",
        message: "Minimum useful temperature must be below maximum temperature"
      });
    }
    if (
      !Number.isFinite(initialTemperatureC) ||
      initialTemperatureC < ABSOLUTE_ZERO_C ||
      initialTemperatureC > maximumTemperatureC
    ) {
      diagnostics.push({
        code: "thermal.hot-water-store.initial-temperature",
        message: "Initial temperature must be no lower than absolute zero and no higher than maximum temperature"
      });
    }

    return diagnostics;
  },

  model: {
    prepare(modelComponent) {
      return {
        thermalCapacityKwhPerK: thermalCapacityKwhPerK(modelComponent.parameters)
      };
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const { thermalCapacityKwhPerK } = runtimeComponent.modelData;
      const {
        maximumChargeHeatFlowKw,
        maximumDischargeHeatFlowKw,
        maximumTemperatureC,
        minimumUsefulTemperatureC
      } = runtimeComponent.parameters;
      const temperatureC = stepContext.state.temperatureC;
      const maximumChargeFromCapacityKw =
        thermalCapacityKwhPerK *
        Math.max(0, maximumTemperatureC - temperatureC) /
        stepContext.durationHours;
      const maximumDischargeFromUsefulHeatKw =
        thermalCapacityKwhPerK *
        Math.max(0, temperatureC - minimumUsefulTemperatureC) /
        stepContext.durationHours;

      return {
        maximumChargeHeatFlowKw: Math.min(
          maximumChargeHeatFlowKw,
          maximumChargeFromCapacityKw
        ),
        maximumDischargeHeatFlowKw: Math.min(
          maximumDischargeHeatFlowKw,
          maximumDischargeFromUsefulHeatKw
        ),
        sourceTemperatureC: temperatureC,
        thermalCapacityKwhPerK,
        heatLossCoefficientKwPerK:
          runtimeComponent.parameters.heatLossCoefficientKwPerK,
        minimumUsefulTemperatureC,
        maximumTemperatureC
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      requireStoreCommand(actualCommand);
      const chargeHeatFlowKw = requireNonNegativePower(
        actualCommand,
        "chargeHeatFlowKw"
      );
      const dischargeHeatFlowKw = requireNonNegativePower(
        actualCommand,
        "dischargeHeatFlowKw"
      );
      const chargeSourceTemperatureC = requireTemperature(
        actualCommand,
        "chargeSourceTemperatureC"
      );
      const chargeDeliveryTemperatureC = requireTemperature(
        actualCommand,
        "chargeDeliveryTemperatureC"
      );
      const ambientTemperatureC = requireTemperature(
        actualCommand,
        "ambientTemperatureC"
      );
      const temperatureC = stepContext.state.temperatureC;
      const {
        heatLossCoefficientKwPerK,
        maximumTemperatureC,
        minimumUsefulTemperatureC
      } = runtimeComponent.parameters;
      const { thermalCapacityKwhPerK } = runtimeComponent.modelData;
      const { durationHours } = stepContext;
      const operatingLimits = hotWaterStoreDefinition.model.getOperatingLimits(
        runtimeComponent,
        stepContext
      );

      if (
        chargeHeatFlowKw >
          operatingLimits.maximumChargeHeatFlowKw + 1e-9
      ) {
        throw new RangeError("Store charge heat flow exceeds its operating limit");
      }
      if (
        dischargeHeatFlowKw >
          operatingLimits.maximumDischargeHeatFlowKw + 1e-9
      ) {
        throw new RangeError("Store discharge heat flow exceeds its operating limit");
      }

      const chargeFlow = createThermalFlow({
        heatFlowKw: chargeHeatFlowKw,
        sourceTemperatureC: chargeSourceTemperatureC,
        deliveryTemperatureC: chargeDeliveryTemperatureC
      });
      if (
        chargeHeatFlowKw > 0 &&
        chargeDeliveryTemperatureC < temperatureC
      ) {
        throw new RangeError(
          "Positive store charging requires delivery temperature at least as high as the store temperature"
        );
      }

      const { heatLossKw } = calculateStandingHeatLoss({
        thermalCapacityKwhPerK,
        heatLossCoefficientKwPerK,
        temperatureC,
        ambientTemperatureC,
        chargeHeatFlowKw,
        dischargeHeatFlowKw,
        durationHours
      });
      const netHeatFlowKw =
        chargeHeatFlowKw - dischargeHeatFlowKw - heatLossKw;
      const calculatedTemperatureC = temperatureC +
        netHeatFlowKw * durationHours / thermalCapacityKwhPerK;
      if (
        chargeHeatFlowKw > 0 &&
        calculatedTemperatureC > chargeDeliveryTemperatureC + 1e-9
      ) {
        throw new RangeError(
          "Store charging cannot raise the store above the heat delivery temperature"
        );
      }
      if (
        calculatedTemperatureC < ABSOLUTE_ZERO_C - 1e-9 ||
        calculatedTemperatureC > maximumTemperatureC + 1e-9
      ) {
        throw new RangeError("Store command would move temperature outside its bounds");
      }
      const nextTemperatureC = calculatedTemperatureC;

      return {
        portFlows: {
          "heat-in": chargeFlow,
          "heat-out": createThermalFlow({
            heatFlowKw: dischargeHeatFlowKw,
            sourceTemperatureC: temperatureC,
            deliveryTemperatureC: temperatureC
          }),
          "heat-loss": createThermalFlow({
            heatFlowKw: heatLossKw,
            sourceTemperatureC: temperatureC,
            deliveryTemperatureC: ambientTemperatureC
          })
        },
        outputs: {
          chargeHeatFlowKw,
          dischargeHeatFlowKw,
          heatLossKw,
          netHeatFlowKw,
          temperatureC: nextTemperatureC,
          usableEnergyKwh: thermalCapacityKwhPerK * Math.max(
            0,
            nextTemperatureC - minimumUsefulTemperatureC
          ),
          deliveryTemperatureMarginK:
            temperatureC - minimumUsefulTemperatureC
        },
        nextState: { temperatureC: nextTemperatureC },
        diagnostics: []
      };
    }
  }
};
