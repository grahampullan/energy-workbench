import {
  ABSOLUTE_ZERO_C,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";
import { createThermalFlow } from "../../core/thermal-flow.js";
import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

const TOLERANCE = 1e-9;
const COMMAND_FIELDS = new Set([
  "fuelInputPowerkW",
  "heatOutputkW",
  "directEmissionsKgCO2PerHour"
]);

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : fuelBurnerDefinition.parameters[parameter].default;
}

function heatConnection(runtimeComponent, context) {
  const connection = singleConnection(runtimeComponent, context, "heat-out");
  if (connection.from.component !== runtimeComponent) {
    throw resolutionError(
      "runtime.unsupported-fuel-burner-topology",
      `${runtimeComponent.id}.heat-out must be the connection source`
    );
  }
  return connection;
}

function requireCommand(command) {
  if (
    command === null ||
    typeof command !== "object" ||
    Array.isArray(command) ||
    Object.keys(command).length !== COMMAND_FIELDS.size ||
    Object.keys(command).some((field) => !COMMAND_FIELDS.has(field)) ||
    Object.values(command).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new TypeError(
      "Fuel-burner command must contain finite, non-negative fuel input, heat output, and direct emissions"
    );
  }
}

export const fuelBurnerDefinition = {
  type: "thermal.fuel-burner",
  version: "0.1.0",
  name: "Fuel burner",

  parameters: {
    maximumFuelInputPowerkW: {
      unit: "kW",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 5000, step: 10 }
    },
    efficiency: {
      unit: "1",
      default: 0.6,
      hardBounds: { minimum: 0, maximum: 1 },
      editor: { minimum: 0.1, maximum: 1, step: 0.01 }
    },
    supplyTemperatureC: {
      unit: "°C",
      default: 1200,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 100, maximum: 2000, step: 10 }
    },
    directEmissionsKgCO2PerKWh: {
      unit: "kgCO2/kWh",
      default: 0.184,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 0.5, step: 0.001 }
    }
  },

  initialState: {},

  ports: [{
    id: "heat-out",
    flowType: THERMAL_HEAT_FLOW_TYPE,
    direction: "out"
  }],

  outputs: {
    fuelInputPowerkW: { unit: "kW" },
    heatOutputkW: { unit: "kW" },
    supplyTemperatureC: { unit: "°C" },
    directEmissionsKgCO2PerHour: { unit: "kgCO2/h" }
  },

  editor: {
    visualRole: "equipment",
    summaryOutput: "fuelInputPowerkW",
    groups: [
      {
        id: "rating",
        label: "Rating",
        parameters: ["maximumFuelInputPowerkW", "supplyTemperatureC"]
      },
      {
        id: "conversion",
        label: "Conversion",
        parameters: ["efficiency", "directEmissionsKgCO2PerKWh"]
      }
    ]
  },

  validate(modelComponent) {
    const efficiency = parameterValue(modelComponent, "efficiency");
    const diagnostics = [];
    if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 1) {
      diagnostics.push({
        code: "thermal.fuel-burner.efficiency",
        message: "Fuel-burner efficiency must be greater than zero and no more than one"
      });
    }
    return diagnostics;
  },

  resolution: {
    describe(runtimeComponent, context) {
      const connection = heatConnection(runtimeComponent, context);
      return resolutionDescription({
        targets: [runtimeComponent.id],
        connectionFlows: [connection.id]
      });
    }
  },

  model: {
    prepare() {
      return {};
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent) {
      const {
        maximumFuelInputPowerkW,
        efficiency,
        supplyTemperatureC
      } = runtimeComponent.parameters;
      return {
        maximumFuelInputPowerkW,
        maximumHeatOutputkW: maximumFuelInputPowerkW * efficiency,
        supplyTemperatureC
      };
    },

    resolve(runtimeComponent, context) {
      if (
        !context.target ||
        !Number.isFinite(context.target.heatOutputkW) ||
        context.target.heatOutputkW < 0
      ) {
        throw resolutionError(
          "runtime.missing-policy-target",
          `Policy did not provide a finite, non-negative heat-output target for ${runtimeComponent.id}`
        );
      }
      const connection = heatConnection(runtimeComponent, context);
      const heatFlow = context.getConnectionFlow(connection.id);
      if (heatFlow === undefined) {
        return null;
      }
      const maximumRequestedHeatOutputkW = Math.min(
        context.target.heatOutputkW,
        context.operatingLimits.maximumHeatOutputkW
      );
      if (
        heatFlow.heatFlowkW > maximumRequestedHeatOutputkW + context.tolerancekW ||
        Math.abs(
          heatFlow.sourceTemperatureC -
          context.operatingLimits.supplyTemperatureC
        ) > context.tolerancekW ||
        Math.abs(
          heatFlow.deliveryTemperatureC -
          context.operatingLimits.supplyTemperatureC
        ) > context.tolerancekW
      ) {
        throw resolutionError(
          "runtime.fuel-burner-operation-infeasible",
          `Settled heat flow is infeasible for ${runtimeComponent.id}`
        );
      }
      const fuelInputPowerkW = heatFlow.heatFlowkW /
        runtimeComponent.parameters.efficiency;
      const command = {
        fuelInputPowerkW,
        heatOutputkW: heatFlow.heatFlowkW,
        directEmissionsKgCO2PerHour: fuelInputPowerkW *
          runtimeComponent.parameters.directEmissionsKgCO2PerKWh
      };
      return {
        feasibleCommand: command,
        actualCommand: command,
        connectionFlows: {}
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      requireCommand(actualCommand);
      const expectedHeatOutputkW = actualCommand.fuelInputPowerkW *
        runtimeComponent.parameters.efficiency;
      if (Math.abs(actualCommand.heatOutputkW - expectedHeatOutputkW) > TOLERANCE) {
        throw new RangeError(
          "Fuel-burner command violates its conversion efficiency"
        );
      }
      const expectedEmissions = actualCommand.fuelInputPowerkW *
        runtimeComponent.parameters.directEmissionsKgCO2PerKWh;
      if (
        Math.abs(
          actualCommand.directEmissionsKgCO2PerHour - expectedEmissions
        ) > TOLERANCE
      ) {
        throw new RangeError(
          "Fuel-burner command violates its direct-emissions factor"
        );
      }
      const supplyTemperatureC = runtimeComponent.parameters.supplyTemperatureC;
      return {
        portFlows: {
          "heat-out": createThermalFlow({
            heatFlowkW: actualCommand.heatOutputkW,
            sourceTemperatureC: supplyTemperatureC,
            deliveryTemperatureC: supplyTemperatureC
          })
        },
        outputs: {
          ...actualCommand,
          supplyTemperatureC
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
