const BATTERY_TYPE = "electrical.battery";

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

function fixedExternalPowerkW(
  runtimeModel,
  battery,
  balancingComponentId,
  operatingLimitsByComponentId
) {
  let powerkW = 0;

  for (const component of runtimeModel.components) {
    if (
      component === battery ||
      component.id === balancingComponentId
    ) {
      continue;
    }
    const limits = operatingLimitsByComponentId[component.id];
    if (!limits) {
      throw new Error(`Operating limits are missing for component: ${component.id}`);
    }
    if (limits.minimumPowerkW !== limits.maximumPowerkW) {
      throw new Error(
        `Self-consumption policy requires fixed operation for component: ${component.id}`
      );
    }
    powerkW += limits.minimumPowerkW;
  }

  return powerkW;
}

export function createPvBatterySelfConsumptionPolicy({
  batteryComponentId,
  balancingComponentId
} = {}) {
  if (typeof batteryComponentId !== "string" || batteryComponentId.length === 0) {
    throw new TypeError("batteryComponentId must be a non-empty string");
  }
  if (typeof balancingComponentId !== "string" || balancingComponentId.length === 0) {
    throw new TypeError("balancingComponentId must be a non-empty string");
  }

  return Object.freeze({
    request(runtimeModel, stepContext, policyContext) {
      const operatingLimitsByComponentId =
        policyContext?.operatingLimitsByComponentId;
      if (!operatingLimitsByComponentId) {
        throw new Error("Self-consumption policy requires component operating limits");
      }
      const battery = requireBattery(runtimeModel, batteryComponentId);
      const fixedPowerkW = fixedExternalPowerkW(
        runtimeModel,
        battery,
        balancingComponentId,
        operatingLimitsByComponentId
      );
      const requestedBatteryPowerkW = fixedPowerkW === 0 ? 0 : -fixedPowerkW;

      return {
        targets: {
          [batteryComponentId]: { powerkW: requestedBatteryPowerkW }
        },
        balancingComponentId
      };
    }
  });
}
