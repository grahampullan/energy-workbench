import { ACTIVE_POWER_FLOW_TYPE } from "../../core/flow-types.js";
import {
  resolveSinglePortActivePower,
  singlePortActivePowerResolution
} from "./resolve-single-active-power-port.js";

function componentValue(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function normaliseStoredEnergykWh(storedEnergykWh, capacitykWh) {
  if (storedEnergykWh <= 0) {
    return 0;
  }
  if (storedEnergykWh >= capacitykWh) {
    return capacitykWh;
  }
  return storedEnergykWh;
}

export const electricalBatteryDefinition = {
  type: "electrical.battery",
  version: "0.2.0",
  name: "Electrical battery",

  parameters: {
    capacitykWh: {
      unit: "kWh",
      default: 5,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 20, step: 0.5 }
    },
    maximumChargePowerkW: {
      unit: "kW",
      default: 3,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10, step: 0.25 }
    },
    maximumDischargePowerkW: {
      unit: "kW",
      default: 3,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10, step: 0.25 }
    },
    chargingEfficiency: {
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0, maximum: 1 },
      editor: { minimum: 0.5, maximum: 1, step: 0.01 }
    },
    dischargingEfficiency: {
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0, maximum: 1 },
      editor: { minimum: 0.5, maximum: 1, step: 0.01 }
    }
  },

  initialState: {
    storedEnergykWh: {
      unit: "kWh",
      default: 0
    }
  },

  ports: [
    {
      id: "electricity",
      flowType: ACTIVE_POWER_FLOW_TYPE,
      direction: "bidirectional"
    }
  ],

  outputs: {
    chargePowerkW: { unit: "kW" },
    dischargePowerkW: { unit: "kW" },
    netPowerkW: { unit: "kW" },
    storedEnergykWh: { unit: "kWh" },
    stateOfChargeFraction: { unit: "1" }
  },

  editor: {
    visualRole: "store",
    groups: [
      {
        id: "storage",
        label: "Storage",
        parameters: ["capacitykWh"]
      },
      {
        id: "power",
        label: "Power limits",
        parameters: ["maximumChargePowerkW", "maximumDischargePowerkW"]
      },
      {
        id: "efficiency",
        label: "Efficiency",
        parameters: ["chargingEfficiency", "dischargingEfficiency"]
      }
    ]
  },

  validate(modelComponent) {
    const diagnostics = [];
    const capacitykWh = componentValue(
      modelComponent.parameters,
      electricalBatteryDefinition.parameters,
      "capacitykWh"
    );
    const storedEnergykWh = componentValue(
      modelComponent.initialState,
      electricalBatteryDefinition.initialState,
      "storedEnergykWh"
    );
    const chargingEfficiency = componentValue(
      modelComponent.parameters,
      electricalBatteryDefinition.parameters,
      "chargingEfficiency"
    );
    const dischargingEfficiency = componentValue(
      modelComponent.parameters,
      electricalBatteryDefinition.parameters,
      "dischargingEfficiency"
    );

    if (
      !Number.isFinite(storedEnergykWh) ||
      !Number.isFinite(capacitykWh) ||
      storedEnergykWh < 0 ||
      storedEnergykWh > capacitykWh
    ) {
      diagnostics.push({
        code: "electrical.battery.initial-energy-range",
        message: "Initial stored energy must be between zero and battery capacity"
      });
    }
    if (!Number.isFinite(chargingEfficiency) || chargingEfficiency <= 0) {
      diagnostics.push({
        code: "electrical.battery.charging-efficiency",
        message: "Charging efficiency must be greater than zero"
      });
    }
    if (!Number.isFinite(dischargingEfficiency) || dischargingEfficiency <= 0) {
      diagnostics.push({
        code: "electrical.battery.discharging-efficiency",
        message: "Discharging efficiency must be greater than zero"
      });
    }

    return diagnostics;
  },

  resolution: singlePortActivePowerResolution("electricity"),

  model: {
    prepare() {
      return {};
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const {
        capacitykWh,
        maximumChargePowerkW,
        maximumDischargePowerkW,
        chargingEfficiency,
        dischargingEfficiency
      } = runtimeComponent.parameters;
      const storedEnergykWh = stepContext.state.storedEnergykWh;
      const remainingCapacitykWh = Math.max(0, capacitykWh - storedEnergykWh);
      const availableChargePowerkW = Math.min(
        maximumChargePowerkW,
        remainingCapacitykWh / chargingEfficiency / stepContext.durationHours
      );
      const availableDischargePowerkW = Math.min(
        maximumDischargePowerkW,
        storedEnergykWh * dischargingEfficiency / stepContext.durationHours
      );

      return {
        minimumPowerkW: availableChargePowerkW === 0 ? 0 : -availableChargePowerkW,
        maximumPowerkW: availableDischargePowerkW
      };
    },

    resolve(runtimeComponent, context) {
      return resolveSinglePortActivePower(runtimeComponent, context, "electricity");
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const {
        capacitykWh,
        chargingEfficiency,
        dischargingEfficiency
      } = runtimeComponent.parameters;
      const netPowerkW = actualCommand.powerkW === 0 ? 0 : actualCommand.powerkW;
      const chargePowerkW = netPowerkW < 0 ? -netPowerkW : 0;
      const dischargePowerkW = netPowerkW > 0 ? netPowerkW : 0;
      const storedEnergykWh = normaliseStoredEnergykWh(
        stepContext.state.storedEnergykWh +
          chargingEfficiency * chargePowerkW * stepContext.durationHours -
          dischargePowerkW * stepContext.durationHours / dischargingEfficiency,
        capacitykWh
      );

      return {
        portFlows: {
          electricity: { powerkW: netPowerkW }
        },
        outputs: {
          chargePowerkW,
          dischargePowerkW,
          netPowerkW,
          storedEnergykWh,
          stateOfChargeFraction: capacitykWh === 0 ? 0 : storedEnergykWh / capacitykWh
        },
        nextState: { storedEnergykWh },
        diagnostics: []
      };
    }
  }
};
