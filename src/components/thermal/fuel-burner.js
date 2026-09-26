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
  if (connection.from.componentId !== runtimeComponent.id) {
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
  version: "0.2.0",
  name: "Fuel burner",
  information: {
    outputs: {
      "maximum-heat": { label: "Maximum heat output", quantity: "heat-rate", unit: "kW", read: ({ limits }) => limits.maximumHeatOutputkW }
    }
  },

  explanation: {
    title: "Fuel-to-heat conversion",
    summary: "Fuel use and direct emissions follow the heat actually accepted by the receiving store.",
    equations: [
      { label: "Conversion", tex: String.raw`\dot Q=\eta P_{\mathrm{fuel}}` },
      { label: "Direct emissions", tex: String.raw`\dot m_{\mathrm{CO_2}}=f_{\mathrm{CO_2}}P_{\mathrm{fuel}}` },
      { label: "Heat-output limit", tex: String.raw`0\leq\dot Q\leq\min(\dot Q_{\mathrm{requested}},\eta P_{\mathrm{fuel,max}})` }
    ],
    symbols: [
      { tex: String.raw`\dot Q`, description: "Actual heat output", unit: "kW" },
      { tex: String.raw`\dot Q_{\mathrm{requested}}`, description: "Policy heat-output request", unit: "kW" },
      { tex: String.raw`P_{\mathrm{fuel}},\ P_{\mathrm{fuel,max}}`, description: "Actual and maximum fuel input power", unit: "kW" },
      { tex: String.raw`\eta`, description: "Conversion efficiency", unit: "1" },
      { tex: String.raw`f_{\mathrm{CO_2}}`, description: "Direct fuel-emissions factor", unit: "kgCO₂/kJ" },
      { tex: String.raw`\dot m_{\mathrm{CO_2}}`, description: "Direct emissions rate", unit: "kgCO₂/s" }
    ],
    notes: [
      "Efficiency and heat-supply temperature are fixed parameters. The receiving store also limits accepted heat according to its own state and constraints.",
      "The burner has no thermal storage, startup delay, or fuel-network constraint. Emissions cover the declared direct fuel factor."
    ]
  },

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
    direction: "out",
    boundary: {
      operatingLimits: ["feasibleHeatOutputkW", "supplyTemperatureC"]
    }
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

    getOperatingLimits(runtimeComponent, stepContext, target = null) {
      const {
        maximumFuelInputPowerkW,
        efficiency,
        supplyTemperatureC
      } = runtimeComponent.parameters;
      const limits = {
        maximumFuelInputPowerkW,
        maximumHeatOutputkW: maximumFuelInputPowerkW * efficiency,
        supplyTemperatureC
      };
      if (target !== null) {
        if (!Number.isFinite(target.heatOutputkW) || target.heatOutputkW < 0) {
          throw new TypeError("Fuel-burner target must provide finite, non-negative heatOutputkW");
        }
        limits.feasibleHeatOutputkW = Math.min(target.heatOutputkW, limits.maximumHeatOutputkW);
      }
      return limits;
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
      if (
        heatFlow.heatFlowkW > context.operatingLimits.feasibleHeatOutputkW + context.tolerancekW ||
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
