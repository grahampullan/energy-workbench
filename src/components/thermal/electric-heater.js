import {
  ABSOLUTE_ZERO_C,
  createThermalFlow,
  THERMAL_FLOW_MEDIUM
} from "../../core/thermal-flow.js";

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : electricHeaterDefinition.parameters[parameter].default;
}

export const electricHeaterDefinition = {
  type: "thermal.electric-heater",
  version: "0.1.0",
  name: "Electric heater",

  parameters: {
    maximumElectricalInputPowerKw: {
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
      medium: "electricity.active-power",
      direction: "in"
    },
    {
      id: "heat-out",
      medium: THERMAL_FLOW_MEDIUM,
      direction: "out"
    }
  ],

  outputs: {
    electricalInputPowerKw: { unit: "kW" },
    heatOutputKw: { unit: "kW" },
    supplyTemperatureC: { unit: "°C" }
  },

  editor: {
    groups: [
      {
        id: "rating",
        label: "Rating",
        parameters: ["maximumElectricalInputPowerKw"]
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
        maximumElectricalInputPowerKw,
        supplyTemperatureC
      } = runtimeComponent.parameters;
      return {
        minimumPowerKw: -maximumElectricalInputPowerKw,
        maximumPowerKw: 0,
        heatOutputPerElectricalInput: efficiency,
        maximumHeatOutputKw: maximumElectricalInputPowerKw * efficiency,
        supplyTemperatureC
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      if (
        !actualCommand ||
        Object.keys(actualCommand).length !== 2 ||
        !Number.isFinite(actualCommand.powerKw) ||
        actualCommand.powerKw > 0 ||
        !Number.isFinite(actualCommand.heatOutputKw) ||
        actualCommand.heatOutputKw < 0
      ) {
        throw new TypeError(
          "Electric-heater actual command must contain finite powerKw and heatOutputKw values"
        );
      }
      const electricalInputPowerKw = -actualCommand.powerKw;
      const expectedHeatOutputKw =
        electricalInputPowerKw * runtimeComponent.parameters.efficiency;
      if (Math.abs(actualCommand.heatOutputKw - expectedHeatOutputKw) > 1e-9) {
        throw new RangeError(
          "Electric-heater actual command violates its conversion efficiency"
        );
      }
      const heatOutputKw = actualCommand.heatOutputKw;
      const supplyTemperatureC = runtimeComponent.parameters.supplyTemperatureC;

      return {
        portFlows: {
          "electricity-in": { powerKw: electricalInputPowerKw },
          "heat-out": createThermalFlow({
            heatFlowKw: heatOutputKw,
            sourceTemperatureC: supplyTemperatureC,
            deliveryTemperatureC: supplyTemperatureC
          })
        },
        outputs: {
          electricalInputPowerKw,
          heatOutputKw,
          supplyTemperatureC
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
