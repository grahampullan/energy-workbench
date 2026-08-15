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

const TOLERANCE = 1e-9;

function componentValue(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function thermalCapacitykWhPerK(parameters) {
  return parameters.massKg * parameters.specificHeatCapacityKjPerKgK / 3600;
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

function requireTemperature(value, field) {
  if (!Number.isFinite(value) || value < ABSOLUTE_ZERO_C) {
    throw new TypeError(`${field} must be finite and no lower than absolute zero`);
  }
  return value;
}

function requireNonNegativePower(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite, non-negative power in kW`);
  }
  return value;
}

const COMMAND_FIELDS = new Set([
  "heatInputkW",
  "heatSourceTemperatureC",
  "heatDeliveryTemperatureC",
  "ambientTemperatureC"
]);

function requireCommand(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw new TypeError("Batch thermal-mass command must be an object");
  }
  const fields = Object.keys(command);
  if (
    fields.length !== COMMAND_FIELDS.size ||
    fields.some((field) => !COMMAND_FIELDS.has(field))
  ) {
    throw new TypeError(
      "Batch thermal-mass command must contain exactly heat input, heat source and delivery temperatures, and ambient temperature"
    );
  }
}

function resolveBatch(runtimeComponent, context, stepContext) {
  const heatInputConnection = singleConnection(
    runtimeComponent,
    context,
    "heat-in"
  );
  const heatLossConnection = singleConnection(
    runtimeComponent,
    context,
    "heat-loss"
  );
  if (
    heatInputConnection.to.component !== runtimeComponent ||
    heatLossConnection.from.component !== runtimeComponent
  ) {
    throw resolutionError(
      "runtime.unsupported-thermal-topology",
      `Thermal connections around ${runtimeComponent.id} have the wrong direction`
    );
  }

  const heater = otherComponent(runtimeComponent, heatInputConnection);
  const ambient = otherComponent(runtimeComponent, heatLossConnection);
  const heaterTarget = context.getTarget(heater.id);
  if (!heaterTarget || !Number.isFinite(heaterTarget.powerkW)) {
    throw resolutionError(
      "runtime.missing-policy-target",
      `Policy did not provide a finite power target for ${heater.id}`
    );
  }

  const heaterLimits = context.getOperatingLimits(heater.id);
  const ambientLimits = context.getOperatingLimits(ambient.id);
  const batchLimits = context.operatingLimits;
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
  const ambientTemperatureC = ambientLimits?.ambientTemperatureC;
  if (
    !Number.isFinite(supplyTemperatureC) ||
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
  const temperatureC = batchLimits.temperatureC;
  const standingLoss = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: batchLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: batchLimits.heatLossCoefficientkWPerK,
    temperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW: requestedHeatOutputkW,
    dischargeHeatFlowkW: 0,
    durationHours: stepContext.durationHours
  });
  const maximumInputAtSupplyTemperaturekW = supplyTemperatureC < temperatureC
    ? 0
    : Math.max(
        0,
        standingLoss.unconstrainedHeatLosskW +
          batchLimits.thermalCapacitykWhPerK *
            (supplyTemperatureC - temperatureC) /
            stepContext.durationHours
      );
  const heatInputkW = Math.min(
    requestedHeatOutputkW,
    batchLimits.maximumHeatInputkW,
    maximumInputAtSupplyTemperaturekW
  );
  const { heatLosskW } = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: batchLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: batchLimits.heatLossCoefficientkWPerK,
    temperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW: heatInputkW,
    dischargeHeatFlowkW: 0,
    durationHours: stepContext.durationHours
  });

  return {
    feasibleCommand: null,
    actualCommand: {
      heatInputkW,
      heatSourceTemperatureC: supplyTemperatureC,
      heatDeliveryTemperatureC: supplyTemperatureC,
      ambientTemperatureC
    },
    connectionFlows: {
      [heatInputConnection.id]: createThermalFlow({
        heatFlowkW: heatInputkW,
        sourceTemperatureC: supplyTemperatureC,
        deliveryTemperatureC: supplyTemperatureC
      }),
      [heatLossConnection.id]: createThermalFlow({
        heatFlowkW: heatLosskW,
        sourceTemperatureC: temperatureC,
        deliveryTemperatureC: ambientTemperatureC
      })
    }
  };
}

export const batchThermalMassDefinition = {
  type: "process.batch-thermal-mass",
  version: "0.1.0",
  name: "Batch thermal mass",

  parameters: {
    massKg: {
      unit: "kg",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 100, maximum: 10000, step: 100 }
    },
    specificHeatCapacityKjPerKgK: {
      unit: "kJ / kgK",
      default: 3.6,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0.1, maximum: 5, step: 0.1 }
    },
    maximumTemperatureC: {
      unit: "°C",
      default: 145,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 30, maximum: 200, step: 1 }
    },
    heatLossCoefficientkWPerK: {
      unit: "kW/K",
      default: 0.1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2, step: 0.01 }
    },
    maximumHeatInputkW: {
      unit: "kW",
      default: 50,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 200, step: 5 }
    },
    requiredTemperatureC: {
      unit: "°C",
      default: 120,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 30, maximum: 150, step: 1 }
    }
  },

  initialState: {
    temperatureC: {
      unit: "°C",
      default: 20
    }
  },

  ports: [
    {
      id: "heat-in",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "heat-loss",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    }
  ],

  outputs: {
    heatInputkW: { unit: "kW" },
    heatLosskW: { unit: "kW" },
    netHeatFlowkW: { unit: "kW" },
    temperatureC: { unit: "°C" },
    requiredTemperatureMarginK: { unit: "K" }
  },

  editor: {
    summaryOutput: "temperatureC",
    temperatureChart: {
      stateField: "temperatureC",
      thresholdParameter: "requiredTemperatureC",
      thresholdLabel: "Required"
    },
    groups: [
      {
        id: "batch",
        label: "Batch",
        parameters: [
          "massKg",
          "specificHeatCapacityKjPerKgK",
          "maximumTemperatureC",
          "requiredTemperatureC"
        ]
      },
      {
        id: "heat-transfer",
        label: "Heat transfer",
        parameters: [
          "maximumHeatInputkW",
          "heatLossCoefficientkWPerK"
        ]
      }
    ]
  },

  validate(modelComponent) {
    const diagnostics = [];
    const massKg = componentValue(
      modelComponent.parameters,
      batchThermalMassDefinition.parameters,
      "massKg"
    );
    const specificHeatCapacityKjPerKgK = componentValue(
      modelComponent.parameters,
      batchThermalMassDefinition.parameters,
      "specificHeatCapacityKjPerKgK"
    );
    const maximumTemperatureC = componentValue(
      modelComponent.parameters,
      batchThermalMassDefinition.parameters,
      "maximumTemperatureC"
    );
    const requiredTemperatureC = componentValue(
      modelComponent.parameters,
      batchThermalMassDefinition.parameters,
      "requiredTemperatureC"
    );
    const initialTemperatureC = componentValue(
      modelComponent.initialState,
      batchThermalMassDefinition.initialState,
      "temperatureC"
    );

    if (!Number.isFinite(massKg) || massKg <= 0) {
      diagnostics.push({
        code: "process.batch-thermal-mass.mass",
        message: "Batch mass must be greater than zero"
      });
    }
    if (
      !Number.isFinite(specificHeatCapacityKjPerKgK) ||
      specificHeatCapacityKjPerKgK <= 0
    ) {
      diagnostics.push({
        code: "process.batch-thermal-mass.specific-heat-capacity",
        message: "Specific heat capacity must be greater than zero"
      });
    }
    if (
      Number.isFinite(requiredTemperatureC) &&
      Number.isFinite(maximumTemperatureC) &&
      requiredTemperatureC > maximumTemperatureC
    ) {
      diagnostics.push({
        code: "process.batch-thermal-mass.temperature-range",
        message: "Required temperature must not exceed maximum temperature"
      });
    }
    if (
      !Number.isFinite(initialTemperatureC) ||
      initialTemperatureC < ABSOLUTE_ZERO_C ||
      initialTemperatureC > maximumTemperatureC
    ) {
      diagnostics.push({
        code: "process.batch-thermal-mass.initial-temperature",
        message: "Initial temperature must be no lower than absolute zero and no higher than maximum temperature"
      });
    }
    return diagnostics;
  },

  model: {
    prepare(modelComponent, context) {
      return {
        thermalCapacitykWhPerK: thermalCapacitykWhPerK(
          modelComponent.parameters
        ),
        finalStepIndex: context.scenario.time.stepCount - 1
      };
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const temperatureC = stepContext.state.temperatureC;
      const {
        maximumHeatInputkW,
        maximumTemperatureC,
        heatLossCoefficientkWPerK,
        requiredTemperatureC
      } = runtimeComponent.parameters;
      const { thermalCapacitykWhPerK } = runtimeComponent.modelData;
      const maximumInputFromCapacitykW =
        thermalCapacitykWhPerK *
        Math.max(0, maximumTemperatureC - temperatureC) /
        stepContext.durationHours;
      return {
        maximumHeatInputkW: Math.min(
          maximumHeatInputkW,
          maximumInputFromCapacitykW
        ),
        temperatureC,
        thermalCapacitykWhPerK,
        heatLossCoefficientkWPerK,
        maximumTemperatureC,
        requiredTemperatureC
      };
    },

    resolve(runtimeComponent, context, stepContext) {
      return resolveBatch(runtimeComponent, context, stepContext);
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      requireCommand(actualCommand);
      const heatInputkW = requireNonNegativePower(
        actualCommand.heatInputkW,
        "heatInputkW"
      );
      const heatSourceTemperatureC = requireTemperature(
        actualCommand.heatSourceTemperatureC,
        "heatSourceTemperatureC"
      );
      const heatDeliveryTemperatureC = requireTemperature(
        actualCommand.heatDeliveryTemperatureC,
        "heatDeliveryTemperatureC"
      );
      const ambientTemperatureC = requireTemperature(
        actualCommand.ambientTemperatureC,
        "ambientTemperatureC"
      );
      const temperatureC = stepContext.state.temperatureC;
      const {
        heatLossCoefficientkWPerK,
        maximumTemperatureC,
        requiredTemperatureC
      } = runtimeComponent.parameters;
      const { thermalCapacitykWhPerK, finalStepIndex } = runtimeComponent.modelData;
      const { durationHours } = stepContext;
      const operatingLimits = batchThermalMassDefinition.model.getOperatingLimits(
        runtimeComponent,
        stepContext
      );

      if (heatInputkW > operatingLimits.maximumHeatInputkW + TOLERANCE) {
        throw new RangeError("Batch heat input exceeds its operating limit");
      }
      if (
        heatInputkW > 0 &&
        heatDeliveryTemperatureC < temperatureC
      ) {
        throw new RangeError(
          "Positive batch heating requires delivery temperature at least as high as the batch temperature"
        );
      }

      const { heatLosskW } = calculateStandingHeatLoss({
        thermalCapacitykWhPerK,
        heatLossCoefficientkWPerK,
        temperatureC,
        ambientTemperatureC,
        chargeHeatFlowkW: heatInputkW,
        dischargeHeatFlowkW: 0,
        durationHours
      });
      const netHeatFlowkW = heatInputkW - heatLosskW;
      const nextTemperatureC = temperatureC +
        netHeatFlowkW * durationHours / thermalCapacitykWhPerK;
      if (
        heatInputkW > 0 &&
        nextTemperatureC > heatDeliveryTemperatureC + TOLERANCE
      ) {
        throw new RangeError(
          "Batch heating cannot raise the batch above the heat delivery temperature"
        );
      }
      if (
        nextTemperatureC < ABSOLUTE_ZERO_C - TOLERANCE ||
        nextTemperatureC > maximumTemperatureC + TOLERANCE
      ) {
        throw new RangeError("Batch command would move temperature outside its bounds");
      }

      const requiredTemperatureMarginK =
        nextTemperatureC - requiredTemperatureC;
      const diagnostics = [];
      if (
        stepContext.stepIndex === finalStepIndex &&
        requiredTemperatureMarginK < -TOLERANCE
      ) {
        diagnostics.push({
          severity: "warning",
          code: "process.batch-thermal-mass.required-temperature-missed",
          message: `Final batch temperature is ${-requiredTemperatureMarginK} K below the requirement`
        });
      }

      return {
        portFlows: {
          "heat-in": createThermalFlow({
            heatFlowkW: heatInputkW,
            sourceTemperatureC: heatSourceTemperatureC,
            deliveryTemperatureC: heatDeliveryTemperatureC
          }),
          "heat-loss": createThermalFlow({
            heatFlowkW: heatLosskW,
            sourceTemperatureC: temperatureC,
            deliveryTemperatureC: ambientTemperatureC
          })
        },
        outputs: {
          heatInputkW,
          heatLosskW,
          netHeatFlowkW,
          temperatureC: nextTemperatureC,
          requiredTemperatureMarginK
        },
        nextState: { temperatureC: nextTemperatureC },
        diagnostics
      };
    }
  }
};
