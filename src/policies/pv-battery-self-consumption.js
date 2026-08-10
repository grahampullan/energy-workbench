const BATTERY_TYPE = "electrical.battery";
const BUS_TYPE = "electrical.bus";
const GRID_TYPE = "electrical.grid";

function requireBattery(runtimeModel, batteryComponentId) {
  const battery = runtimeModel.components.find(
    (component) => component.id === batteryComponentId
  );
  if (!battery) {
    throw new Error(`Battery component does not exist: ${batteryComponentId}`);
  }
  if (battery.type !== BATTERY_TYPE) {
    throw new Error(
      `Self-consumption policy requires ${batteryComponentId} to use ${BATTERY_TYPE}`
    );
  }
  return battery;
}

function fixedExternalPowerKw(runtimeModel, battery, operatingLimitsByComponentId) {
  let powerKw = 0;

  for (const component of runtimeModel.components) {
    if (
      component === battery ||
      component.type === BUS_TYPE ||
      component.type === GRID_TYPE
    ) {
      continue;
    }
    const limits = operatingLimitsByComponentId[component.id];
    if (!limits) {
      throw new Error(`Operating limits are missing for component: ${component.id}`);
    }
    if (limits.minimumPowerKw !== limits.maximumPowerKw) {
      throw new Error(
        `Self-consumption policy requires fixed operation for component: ${component.id}`
      );
    }
    powerKw += limits.minimumPowerKw;
  }

  return powerKw;
}

export function createPvBatterySelfConsumptionPolicy({ batteryComponentId } = {}) {
  if (typeof batteryComponentId !== "string" || batteryComponentId.length === 0) {
    throw new TypeError("batteryComponentId must be a non-empty string");
  }

  return Object.freeze({
    request(runtimeModel, stepContext, policyContext) {
      const operatingLimitsByComponentId =
        policyContext?.operatingLimitsByComponentId;
      if (!operatingLimitsByComponentId) {
        throw new Error("Self-consumption policy requires component operating limits");
      }
      const battery = requireBattery(runtimeModel, batteryComponentId);
      const fixedPowerKw = fixedExternalPowerKw(
        runtimeModel,
        battery,
        operatingLimitsByComponentId
      );
      const requestedBatteryPowerKw = fixedPowerKw === 0 ? 0 : -fixedPowerKw;

      return {
        [batteryComponentId]: { powerKw: requestedBatteryPowerKw }
      };
    }
  });
}
