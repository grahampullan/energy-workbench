import { THERMAL_FLOW_MEDIUM } from "../core/thermal-flow.js";
import { resolveCoupledModel } from "./resolve-coupled-model.js";
import { resolveElectricalBus } from "./resolve-electrical-bus.js";

export function resolveEnergyModel({ runtimeModel, stepContext, ...context }) {
  const hasThermalComponents = runtimeModel.components.some((component) =>
    component.ports.some((port) => port.medium === THERMAL_FLOW_MEDIUM)
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
