import { THERMAL_HEAT_FLOW_TYPE } from "../core/flow-types.js";
import { resolveCoupledModel } from "./resolve-coupled-model.js";
import { resolveElectricalBus } from "./resolve-electrical-bus.js";

export function resolveEnergyModel({ runtimeModel, stepContext, ...context }) {
  const hasThermalComponents = runtimeModel.components.some((component) =>
    component.ports.some((port) => port.flowType === THERMAL_HEAT_FLOW_TYPE)
  );
  if (hasThermalComponents) {
    return resolveCoupledModel({ runtimeModel, stepContext, ...context });
  }
  return resolveElectricalBus({
    runtimeModel,
    stepIndex: stepContext.stepIndex,
    ...context
  });
}
