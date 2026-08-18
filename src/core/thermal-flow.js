import {
  ABSOLUTE_ZERO_C,
  createFlow,
  flowValidationMessage,
  THERMAL_HEAT_FLOW_TYPE
} from "./flow-types.js";

export { ABSOLUTE_ZERO_C };

export function thermalFlowValidationMessage(flow) {
  return flowValidationMessage(THERMAL_HEAT_FLOW_TYPE, flow);
}

export function createThermalFlow(flow = {}) {
  return createFlow(THERMAL_HEAT_FLOW_TYPE, flow);
}
