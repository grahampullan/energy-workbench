const ELECTRIC_HEATER_TYPE = "thermal.electric-heater";
const HEAT_DEMAND_TYPE = "thermal.heat-demand";

function requireComponent(runtimeModel, componentId, type, label) {
  const component = runtimeModel.components.find(
    (candidate) => candidate.id === componentId
  );
  if (!component) {
    throw new Error(`${label} component does not exist: ${componentId}`);
  }
  if (component.type !== type) {
    throw new Error(`${label} ${componentId} must use ${type}`);
  }
  return component;
}

export function createHeatDemandFollowingPolicy({
  heaterComponentId,
  demandComponentId
} = {}) {
  if (typeof heaterComponentId !== "string" || heaterComponentId.length === 0) {
    throw new TypeError("heaterComponentId must be a non-empty string");
  }
  if (typeof demandComponentId !== "string" || demandComponentId.length === 0) {
    throw new TypeError("demandComponentId must be a non-empty string");
  }

  return Object.freeze({
    request(runtimeModel, stepContext, policyContext) {
      const operatingLimitsByComponentId =
        policyContext?.operatingLimitsByComponentId;
      if (!operatingLimitsByComponentId) {
        throw new Error("Heat-demand-following policy requires operating limits");
      }
      requireComponent(
        runtimeModel,
        heaterComponentId,
        ELECTRIC_HEATER_TYPE,
        "Heater"
      );
      requireComponent(
        runtimeModel,
        demandComponentId,
        HEAT_DEMAND_TYPE,
        "Heat demand"
      );

      const heaterLimits = operatingLimitsByComponentId[heaterComponentId];
      const demandLimits = operatingLimitsByComponentId[demandComponentId];
      if (!heaterLimits || !demandLimits) {
        throw new Error("Heat-demand-following policy requires heater and demand limits");
      }
      const conversion = heaterLimits.heatOutputPerElectricalInput;
      const demandHeatFlowkW = demandLimits.maximumHeatFlowkW;
      if (!Number.isFinite(conversion) || conversion <= 0) {
        throw new Error("Heater limits must declare a positive heat conversion");
      }
      if (!Number.isFinite(demandHeatFlowkW) || demandHeatFlowkW < 0) {
        throw new Error("Heat-demand limits must declare non-negative demand");
      }
      const requestedPowerkW = demandHeatFlowkW === 0
        ? 0
        : -demandHeatFlowkW / conversion;

      return {
        [heaterComponentId]: { powerkW: requestedPowerkW }
      };
    }
  });
}
