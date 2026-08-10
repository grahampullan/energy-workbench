function componentValue(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function normaliseStoredEnergyKwh(storedEnergyKwh, capacityKwh) {
  if (storedEnergyKwh <= 0) {
    return 0;
  }
  if (storedEnergyKwh >= capacityKwh) {
    return capacityKwh;
  }
  return storedEnergyKwh;
}

export const electricalBatteryDefinition = {
  type: "electrical.battery",
  version: "0.1.0",
  name: "Electrical battery",

  parameters: {
    capacityKwh: {
      unit: "kWh",
      default: 5,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 20, step: 0.5 }
    },
    maximumChargePowerKw: {
      unit: "kW",
      default: 3,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10, step: 0.25 }
    },
    maximumDischargePowerKw: {
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
    storedEnergyKwh: {
      unit: "kWh",
      default: 0
    }
  },

  ports: [
    {
      id: "electricity",
      medium: "electricity.active-power",
      direction: "bidirectional"
    }
  ],

  outputs: {
    chargePowerKw: { unit: "kW" },
    dischargePowerKw: { unit: "kW" },
    netPowerKw: { unit: "kW" },
    storedEnergyKwh: { unit: "kWh" },
    stateOfChargeFraction: { unit: "1" }
  },

  editor: {
    groups: [
      {
        id: "storage",
        label: "Storage",
        parameters: ["capacityKwh"]
      },
      {
        id: "power",
        label: "Power limits",
        parameters: ["maximumChargePowerKw", "maximumDischargePowerKw"]
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
    const capacityKwh = componentValue(
      modelComponent.parameters,
      electricalBatteryDefinition.parameters,
      "capacityKwh"
    );
    const storedEnergyKwh = componentValue(
      modelComponent.initialState,
      electricalBatteryDefinition.initialState,
      "storedEnergyKwh"
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
      !Number.isFinite(storedEnergyKwh) ||
      !Number.isFinite(capacityKwh) ||
      storedEnergyKwh < 0 ||
      storedEnergyKwh > capacityKwh
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

  model: {
    prepare() {
      return {};
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      const {
        capacityKwh,
        maximumChargePowerKw,
        maximumDischargePowerKw,
        chargingEfficiency,
        dischargingEfficiency
      } = runtimeComponent.parameters;
      const storedEnergyKwh = stepContext.state.storedEnergyKwh;
      const remainingCapacityKwh = Math.max(0, capacityKwh - storedEnergyKwh);
      const availableChargePowerKw = Math.min(
        maximumChargePowerKw,
        remainingCapacityKwh / chargingEfficiency / stepContext.durationHours
      );
      const availableDischargePowerKw = Math.min(
        maximumDischargePowerKw,
        storedEnergyKwh * dischargingEfficiency / stepContext.durationHours
      );

      return {
        minimumPowerKw: availableChargePowerKw === 0 ? 0 : -availableChargePowerKw,
        maximumPowerKw: availableDischargePowerKw
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const {
        capacityKwh,
        chargingEfficiency,
        dischargingEfficiency
      } = runtimeComponent.parameters;
      const netPowerKw = actualCommand.powerKw === 0 ? 0 : actualCommand.powerKw;
      const chargePowerKw = netPowerKw < 0 ? -netPowerKw : 0;
      const dischargePowerKw = netPowerKw > 0 ? netPowerKw : 0;
      const storedEnergyKwh = normaliseStoredEnergyKwh(
        stepContext.state.storedEnergyKwh +
          chargingEfficiency * chargePowerKw * stepContext.durationHours -
          dischargePowerKw * stepContext.durationHours / dischargingEfficiency,
        capacityKwh
      );

      return {
        portFlows: {
          electricity: { powerKw: netPowerKw }
        },
        outputs: {
          chargePowerKw,
          dischargePowerKw,
          netPowerKw,
          storedEnergyKwh,
          stateOfChargeFraction: capacityKwh === 0 ? 0 : storedEnergyKwh / capacityKwh
        },
        nextState: { storedEnergyKwh },
        diagnostics: []
      };
    }
  }
};
