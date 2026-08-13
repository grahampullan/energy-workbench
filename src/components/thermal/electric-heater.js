import {
  ABSOLUTE_ZERO_C,
  createThermalFlow
} from "../../core/thermal-flow.js";
import {
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : electricHeaterDefinition.parameters[parameter].default;
}

export const electricHeaterDefinition = {
  type: "thermal.electric-heater",
  version: "0.2.0",
  name: "Electric heater",

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
    electricalInputPowerkW: { unit: "kW" },
    heatOutputkW: { unit: "kW" },
    supplyTemperatureC: { unit: "°C" }
  },

  editor: {
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
