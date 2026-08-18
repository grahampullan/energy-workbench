import {
  createFlow,
  flowValidationMessage,
  MATERIAL_MASS_FLOW_TYPE
} from "./flow-types.js";

export function materialFlowValidationMessage(flow) {
  return flowValidationMessage(MATERIAL_MASS_FLOW_TYPE, flow);
}

export function createMaterialFlow(flow = {}) {
  return createFlow(MATERIAL_MASS_FLOW_TYPE, flow);
}

export function materialEnthalpyFlowkW(flow) {
  const materialFlow = createMaterialFlow(flow);
  return materialFlow.massFlowKgPerSecond *
    materialFlow.specificEnthalpyKjPerKg;
}
