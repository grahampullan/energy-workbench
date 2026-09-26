import {
  ABSOLUTE_ZERO_C,
  createThermalFlow
} from "../../core/thermal-flow.js";
import {
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";
import {
  connectionFlowForComponentPower
} from "../electrical/resolve-single-active-power-port.js";
import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : electricHeaterDefinition.parameters[parameter].default;
}

export const electricHeaterDefinition = {
  type: "thermal.electric-heater",
  version: "0.2.0",
  name: "Electric heater",
  information: {
    outputs: {
      "efficiency": { label: "Heater efficiency", quantity: "efficiency", unit: "1", read: ({ limits }) => limits.heatOutputPerElectricalInput }
    }
  },

  explanation: {
    title: "Electricity-to-heat conversion",
    summary: "Electrical consumption follows accepted heat output through a constant conversion efficiency.",
    equations: [
      { label: "Conversion", tex: String.raw`\dot Q=\eta P_{\mathrm{input}}` },
      { label: "Input limit", tex: String.raw`0\leq P_{\mathrm{input}}\leq P_{\mathrm{input,max}}` }
    ],
    symbols: [
      { tex: String.raw`\dot Q`, description: "Actual heat output", unit: "kW" },
      { tex: String.raw`P_{\mathrm{input}},P_{\mathrm{input,max}}`, description: "Actual and maximum electrical consumption", unit: "kW" },
      { tex: String.raw`\eta`, description: "Conversion efficiency", unit: "1" }
    ],
    notes: ["The policy requests signed electrical power: consumption is negative. The receiving store reconciles the heat request against its temperature and input limits.", "Heat-supply temperature and efficiency are fixed parameters. The heater has no thermal storage or startup delay."]
  },

  parameters: {
    maximumElectricalInputPowerkW: {
      unit: "kW",
      default: 400,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 10 }
    },
    efficiency: {
      unit: "1",
      default: 0.95,
      hardBounds: { minimum: 0, maximum: 1 },
      editor: { minimum: 0.5, maximum: 1, step: 0.01 }
    },
    supplyTemperatureC: {
      unit: "°C",
      default: 85,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 20, maximum: 150, step: 1 }
    }
  },

  initialState: {},

  ports: [
    {
      id: "electricity-in",
      flowType: ACTIVE_POWER_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "heat-out",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    }
  ],

  outputs: {
    electricalInputPowerkW: { unit: "kW", label: "Electrical input" },
    heatOutputkW: { unit: "kW" },
    supplyTemperatureC: { unit: "°C" }
  },

  editor: {
    visualRole: "equipment",
    summaryOutput: "electricalInputPowerkW",
    groups: [
      {
        id: "rating",
        label: "Rating",
        parameters: ["maximumElectricalInputPowerkW"]
      },
      {
        id: "conversion",
        label: "Conversion",
        parameters: ["efficiency", "supplyTemperatureC"]
      }
    ]
  },

  validate(modelComponent) {
    const efficiency = parameterValue(modelComponent, "efficiency");
    if (!Number.isFinite(efficiency) || efficiency <= 0) {
      return [{
        code: "thermal.electric-heater.efficiency",
        message: "Electric-heater efficiency must be greater than zero"
      }];
    }
    return [];
  },

  resolution: {
    describe(runtimeComponent, context) {
      if (context.balancingComponentId === runtimeComponent.id) {
        throw resolutionError(
          "runtime.unsupported-balancing-component",
          "The coupled electric heater cannot be the electrical balancing component"
        );
      }
      const heatConnection = singleConnection(
        runtimeComponent,
        context,
        "heat-out"
      );
      const electricityConnection = singleConnection(
        runtimeComponent,
        context,
        "electricity-in"
      );
      return resolutionDescription({
        targets: [runtimeComponent.id],
        connectionFlows: [heatConnection.id],
        determines: [electricityConnection.id]
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
        efficiency,
        maximumElectricalInputPowerkW,
        supplyTemperatureC
      } = runtimeComponent.parameters;
      return {
        minimumPowerkW: -maximumElectricalInputPowerkW,
        maximumPowerkW: 0,
        heatOutputPerElectricalInput: efficiency,
        maximumHeatOutputkW: maximumElectricalInputPowerkW * efficiency,
        supplyTemperatureC
      };
    },

    resolve(runtimeComponent, context) {
      if (context.balancingComponentId === runtimeComponent.id) {
        throw resolutionError(
          "runtime.unsupported-balancing-component",
          "The coupled electric heater cannot be the electrical balancing component"
        );
      }
      if (!context.target || !Number.isFinite(context.target.powerkW)) {
        throw resolutionError(
          "runtime.missing-policy-target",
          `Policy did not provide a finite power target for ${runtimeComponent.id}`
        );
      }

      const heatConnection = singleConnection(
        runtimeComponent,
        context,
        "heat-out"
      );
      const heatFlow = context.getConnectionFlow(heatConnection.id);
      if (heatFlow === undefined) {
        return null;
      }
      const electricityConnection = singleConnection(
        runtimeComponent,
        context,
        "electricity-in"
      );
      const { efficiency, supplyTemperatureC } = runtimeComponent.parameters;
      const powerkW = heatFlow.heatFlowkW === 0
        ? 0
        : -heatFlow.heatFlowkW / efficiency;
      if (
        powerkW < context.operatingLimits.minimumPowerkW - context.tolerancekW ||
        powerkW > context.operatingLimits.maximumPowerkW + context.tolerancekW ||
        Math.abs(heatFlow.sourceTemperatureC - supplyTemperatureC) > context.tolerancekW ||
        Math.abs(heatFlow.deliveryTemperatureC - supplyTemperatureC) > context.tolerancekW
      ) {
        throw resolutionError(
          "runtime.heater-operation-infeasible",
          `Settled heat flow is infeasible for ${runtimeComponent.id}`
        );
      }
      const command = { powerkW, heatOutputkW: heatFlow.heatFlowkW };
      return {
        feasibleCommand: command,
        actualCommand: command,
        connectionFlows: {
          [electricityConnection.id]: connectionFlowForComponentPower(
            runtimeComponent,
            electricityConnection,
            powerkW
          )
        }
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      if (
        !actualCommand ||
        Object.keys(actualCommand).length !== 2 ||
        !Number.isFinite(actualCommand.powerkW) ||
        actualCommand.powerkW > 0 ||
        !Number.isFinite(actualCommand.heatOutputkW) ||
        actualCommand.heatOutputkW < 0
      ) {
        throw new TypeError(
          "Electric-heater actual command must contain finite powerkW and heatOutputkW values"
        );
      }
      const electricalInputPowerkW = -actualCommand.powerkW;
      const expectedHeatOutputkW =
        electricalInputPowerkW * runtimeComponent.parameters.efficiency;
      if (Math.abs(actualCommand.heatOutputkW - expectedHeatOutputkW) > 1e-9) {
        throw new RangeError(
          "Electric-heater actual command violates its conversion efficiency"
        );
      }
      const heatOutputkW = actualCommand.heatOutputkW;
      const supplyTemperatureC = runtimeComponent.parameters.supplyTemperatureC;

      return {
        portFlows: {
          "electricity-in": { powerkW: electricalInputPowerkW },
          "heat-out": createThermalFlow({
            heatFlowkW: heatOutputkW,
            sourceTemperatureC: supplyTemperatureC,
            deliveryTemperatureC: supplyTemperatureC
          })
        },
        outputs: {
          electricalInputPowerkW,
          heatOutputkW,
          supplyTemperatureC
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
