import {
  ABSOLUTE_ZERO_C,
  calculateStandingHeatLoss,
  createThermalFlow
} from "../../core/thermal-flow.js";
import { THERMAL_HEAT_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolutionError,
  singleConnection
} from "../model-resolution.js";

function componentValue(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function thermalCapacitykWhPerK(parameters) {
  return parameters.volumeM3 *
    parameters.waterDensityKgPerM3 *
    parameters.specificHeatCapacityKjPerKgK /
    3600;
}

function otherComponent(component, connection) {
  return connection.from.component === component
    ? connection.to.component
    : connection.from.component;
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

function resolveStore(runtimeComponent, context, stepContext) {
  const chargeConnection = singleConnection(runtimeComponent, context, "heat-in");
  const demandConnection = singleConnection(runtimeComponent, context, "heat-out");
  const lossConnection = singleConnection(runtimeComponent, context, "heat-loss");
  if (
    chargeConnection.to.component !== runtimeComponent ||
    demandConnection.from.component !== runtimeComponent ||
    lossConnection.from.component !== runtimeComponent
  ) {
    throw resolutionError(
      "runtime.unsupported-thermal-topology",
      `Thermal connections around ${runtimeComponent.id} have the wrong direction`
    );
  }

  const heater = otherComponent(runtimeComponent, chargeConnection);
  const demand = otherComponent(runtimeComponent, demandConnection);
  const ambient = otherComponent(runtimeComponent, lossConnection);
  const heaterTarget = context.getTarget(heater.id);
  if (!heaterTarget || !Number.isFinite(heaterTarget.powerkW)) {
    throw resolutionError(
      "runtime.missing-policy-target",
      `Policy did not provide a finite power target for ${heater.id}`
    );
  }

  const heaterLimits = context.getOperatingLimits(heater.id);
  const demandLimits = context.getOperatingLimits(demand.id);
  const ambientLimits = context.getOperatingLimits(ambient.id);
  const storeLimits = context.operatingLimits;
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
  const maximumDemandHeatFlowkW = finiteCapability(
    demandLimits,
    "maximumHeatFlowkW"
  );
  const minimumDeliveryTemperatureC = demandLimits?.minimumDeliveryTemperatureC;
  const ambientTemperatureC = ambientLimits?.ambientTemperatureC;
  if (
    !Number.isFinite(supplyTemperatureC) ||
    !Number.isFinite(minimumDeliveryTemperatureC) ||
    !Number.isFinite(ambientTemperatureC)
  ) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      "Thermal temperature capabilities are missing or invalid"
    );
  }

  const requestedPowerkW = Math.min(
    heaterLimits.maximumPowerkW,
    Math.max(heaterLimits.minimumPowerkW, heaterTarget.powerkW)
  );
  const requestedHeatOutputkW = Math.min(
    maximumHeatOutputkW,
    -requestedPowerkW * conversion
  );
  const storeTemperatureC = storeLimits.sourceTemperatureC;
  const dischargeHeatFlowkW =
    storeTemperatureC >= minimumDeliveryTemperatureC
      ? Math.min(
          maximumDemandHeatFlowkW,
          storeLimits.maximumDischargeHeatFlowkW
        )
      : 0;
  const standingLoss = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: storeLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: storeLimits.heatLossCoefficientkWPerK,
    temperatureC: storeTemperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW: requestedHeatOutputkW,
    dischargeHeatFlowkW,
    durationHours: stepContext.durationHours
  });
  const maximumChargeAtSupplyTemperaturekW = supplyTemperatureC < storeTemperatureC
    ? 0
    : Math.max(
        0,
        dischargeHeatFlowkW +
          standingLoss.unconstrainedHeatLosskW +
          storeLimits.thermalCapacitykWhPerK *
            (supplyTemperatureC - storeTemperatureC) /
            stepContext.durationHours
      );
  const chargeHeatFlowkW = Math.min(
    requestedHeatOutputkW,
    storeLimits.maximumChargeHeatFlowkW,
    maximumChargeAtSupplyTemperaturekW
  );
  const { heatLosskW } = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: storeLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: storeLimits.heatLossCoefficientkWPerK,
    temperatureC: storeTemperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW,
    dischargeHeatFlowkW,
    durationHours: stepContext.durationHours
  });

  const chargeFlow = createThermalFlow({
    heatFlowkW: chargeHeatFlowkW,
    sourceTemperatureC: supplyTemperatureC,
    deliveryTemperatureC: supplyTemperatureC
  });
  const demandFlow = createThermalFlow({
    heatFlowkW: dischargeHeatFlowkW,
    sourceTemperatureC: storeTemperatureC,
    deliveryTemperatureC: storeTemperatureC
  });
  const lossFlow = createThermalFlow({
    heatFlowkW: heatLosskW,
    sourceTemperatureC: storeTemperatureC,
    deliveryTemperatureC: ambientTemperatureC
  });

  return {
    feasibleCommand: null,
    actualCommand: {
      chargeHeatFlowkW,
      chargeSourceTemperatureC: supplyTemperatureC,
      chargeDeliveryTemperatureC: supplyTemperatureC,
      dischargeHeatFlowkW,
      ambientTemperatureC
    },
    connectionFlows: {
      [chargeConnection.id]: chargeFlow,
      [demandConnection.id]: demandFlow,
      [lossConnection.id]: lossFlow
    }
  };
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
  "chargeHeatFlowkW",
  "chargeSourceTemperatureC",
  "chargeDeliveryTemperatureC",
  "dischargeHeatFlowkW",
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
  version: "0.2.0",
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
    heatLossCoefficientkWPerK: {
      unit: "kW/K",
      default: 1.2,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10, step: 0.1 }
    },
    maximumChargeHeatFlowkW: {
      unit: "kW",
      default: 800,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 10 }
    },
    maximumDischargeHeatFlowkW: {
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
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "heat-out",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    },
    {
      id: "heat-loss",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    }
  ],

  outputs: {
    chargeHeatFlowkW: { unit: "kW" },
    dischargeHeatFlowkW: { unit: "kW" },
    heatLosskW: { unit: "kW" },
    netHeatFlowkW: { unit: "kW" },
    temperatureC: { unit: "°C" },
    usableEnergykWh: { unit: "kWh" },
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
          "maximumChargeHeatFlowkW",
          "maximumDischargeHeatFlowkW"
        ]
      },
      {
        id: "losses",
        label: "Thermal properties",
        parameters: [
          "heatLossCoefficientkWPerK",
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
        thermalCapacitykWhPerK: thermalCapacitykWhPerK(modelComponent.parameters)
      };
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const { thermalCapacitykWhPerK } = runtimeComponent.modelData;
      const {
        maximumChargeHeatFlowkW,
        maximumDischargeHeatFlowkW,
        maximumTemperatureC,
        minimumUsefulTemperatureC
      } = runtimeComponent.parameters;
      const temperatureC = stepContext.state.temperatureC;
      const maximumChargeFromCapacitykW =
        thermalCapacitykWhPerK *
        Math.max(0, maximumTemperatureC - temperatureC) /
        stepContext.durationHours;
      const maximumDischargeFromUsefulHeatkW =
        thermalCapacitykWhPerK *
        Math.max(0, temperatureC - minimumUsefulTemperatureC) /
        stepContext.durationHours;

      return {
        maximumChargeHeatFlowkW: Math.min(
          maximumChargeHeatFlowkW,
          maximumChargeFromCapacitykW
        ),
        maximumDischargeHeatFlowkW: Math.min(
          maximumDischargeHeatFlowkW,
          maximumDischargeFromUsefulHeatkW
        ),
        sourceTemperatureC: temperatureC,
        thermalCapacitykWhPerK,
        heatLossCoefficientkWPerK:
          runtimeComponent.parameters.heatLossCoefficientkWPerK,
        minimumUsefulTemperatureC,
        maximumTemperatureC
      };
    },

    resolve(runtimeComponent, context, stepContext) {
      return resolveStore(runtimeComponent, context, stepContext);
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      requireStoreCommand(actualCommand);
      const chargeHeatFlowkW = requireNonNegativePower(
        actualCommand,
        "chargeHeatFlowkW"
      );
      const dischargeHeatFlowkW = requireNonNegativePower(
        actualCommand,
        "dischargeHeatFlowkW"
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
        heatLossCoefficientkWPerK,
        maximumTemperatureC,
        minimumUsefulTemperatureC
      } = runtimeComponent.parameters;
      const { thermalCapacitykWhPerK } = runtimeComponent.modelData;
      const { durationHours } = stepContext;
      const operatingLimits = hotWaterStoreDefinition.model.getOperatingLimits(
        runtimeComponent,
        stepContext
      );

      if (
        chargeHeatFlowkW >
          operatingLimits.maximumChargeHeatFlowkW + 1e-9
      ) {
        throw new RangeError("Store charge heat flow exceeds its operating limit");
      }
      if (
        dischargeHeatFlowkW >
          operatingLimits.maximumDischargeHeatFlowkW + 1e-9
      ) {
        throw new RangeError("Store discharge heat flow exceeds its operating limit");
      }

      const chargeFlow = createThermalFlow({
        heatFlowkW: chargeHeatFlowkW,
        sourceTemperatureC: chargeSourceTemperatureC,
        deliveryTemperatureC: chargeDeliveryTemperatureC
      });
      if (
        chargeHeatFlowkW > 0 &&
        chargeDeliveryTemperatureC < temperatureC
      ) {
        throw new RangeError(
          "Positive store charging requires delivery temperature at least as high as the store temperature"
        );
      }

      const { heatLosskW } = calculateStandingHeatLoss({
        thermalCapacitykWhPerK,
        heatLossCoefficientkWPerK,
        temperatureC,
        ambientTemperatureC,
        chargeHeatFlowkW,
        dischargeHeatFlowkW,
        durationHours
      });
      const netHeatFlowkW =
        chargeHeatFlowkW - dischargeHeatFlowkW - heatLosskW;
      const calculatedTemperatureC = temperatureC +
        netHeatFlowkW * durationHours / thermalCapacitykWhPerK;
      if (
        chargeHeatFlowkW > 0 &&
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
            heatFlowkW: dischargeHeatFlowkW,
            sourceTemperatureC: temperatureC,
            deliveryTemperatureC: temperatureC
          }),
          "heat-loss": createThermalFlow({
            heatFlowkW: heatLosskW,
            sourceTemperatureC: temperatureC,
            deliveryTemperatureC: ambientTemperatureC
          })
        },
        outputs: {
          chargeHeatFlowkW,
          dischargeHeatFlowkW,
          heatLosskW,
          netHeatFlowkW,
          temperatureC: nextTemperatureC,
          usableEnergykWh: thermalCapacitykWhPerK * Math.max(
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
