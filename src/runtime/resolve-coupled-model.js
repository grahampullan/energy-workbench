import {
  calculateStandingHeatLoss,
  createThermalFlow
} from "../core/thermal-flow.js";
import {
  ACTIVE_POWER_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../core/flow-types.js";
import { createDiagnostic } from "../core/validation/validation-result.js";
import { resolveElectricalBus } from "./resolve-electrical-bus.js";

const AMBIENT_TYPE = "thermal.ambient-boundary";
const DEMAND_TYPE = "thermal.heat-demand";
const HEATER_TYPE = "thermal.electric-heater";
const STORE_TYPE = "thermal.hot-water-store";
const THERMAL_COMPONENT_TYPES = new Set([
  AMBIENT_TYPE,
  DEMAND_TYPE,
  HEATER_TYPE,
  STORE_TYPE
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolverDiagnostic(code, message, stepIndex, path = "") {
  return createDiagnostic({
    code,
    message,
    path: `/steps/${stepIndex}${path}`
  });
}

function hasPortFlowType(component, flowType) {
  return component.ports.some((port) => port.flowType === flowType);
}

function singleComponent(runtimeModel, type, stepIndex, diagnostics) {
  const components = runtimeModel.components.filter(
    (component) => component.type === type
  );
  if (components.length !== 1) {
    diagnostics.push(resolverDiagnostic(
      "runtime.coupled-component-count",
      `Coupled runtime requires exactly one ${type}; received ${components.length}`,
      stepIndex
    ));
    return null;
  }
  return components[0];
}

function matchingConnection(runtimeModel, {
  fromComponent,
  fromPortId,
  toComponent,
  toPortId,
  label
}, stepIndex, diagnostics) {
  const matches = runtimeModel.connections.filter((connection) =>
    connection.flowType === THERMAL_HEAT_FLOW_TYPE &&
    connection.from.component === fromComponent &&
    connection.from.port.id === fromPortId &&
    connection.to.component === toComponent &&
    connection.to.port.id === toPortId
  );
  if (matches.length !== 1) {
    diagnostics.push(resolverDiagnostic(
      "runtime.unsupported-thermal-topology",
      `Coupled runtime requires one ${label} connection; received ${matches.length}`,
      stepIndex
    ));
    return null;
  }
  return matches[0];
}

function validateThermalTopology(runtimeModel, stepIndex, diagnostics) {
  const thermalComponents = runtimeModel.components.filter(
    (component) => hasPortFlowType(component, THERMAL_HEAT_FLOW_TYPE)
  );
  for (const component of thermalComponents) {
    if (!THERMAL_COMPONENT_TYPES.has(component.type)) {
      diagnostics.push(resolverDiagnostic(
        "runtime.unsupported-thermal-component",
        `Coupled runtime does not support thermal component: ${component.type}`,
        stepIndex,
        `/components/${component.id}`
      ));
    }
  }

  const heater = singleComponent(runtimeModel, HEATER_TYPE, stepIndex, diagnostics);
  const store = singleComponent(runtimeModel, STORE_TYPE, stepIndex, diagnostics);
  const demand = singleComponent(runtimeModel, DEMAND_TYPE, stepIndex, diagnostics);
  const ambient = singleComponent(runtimeModel, AMBIENT_TYPE, stepIndex, diagnostics);
  if (!heater || !store || !demand || !ambient) {
    return null;
  }
  if (!hasPortFlowType(heater, ACTIVE_POWER_FLOW_TYPE)) {
    diagnostics.push(resolverDiagnostic(
      "runtime.unsupported-thermal-topology",
      `Electric heater ${heater.id} requires an active-power port`,
      stepIndex,
      `/components/${heater.id}`
    ));
  }

  const heaterToStore = matchingConnection(runtimeModel, {
    fromComponent: heater,
    fromPortId: "heat-out",
    toComponent: store,
    toPortId: "heat-in",
    label: "heater-to-store"
  }, stepIndex, diagnostics);
  const storeToDemand = matchingConnection(runtimeModel, {
    fromComponent: store,
    fromPortId: "heat-out",
    toComponent: demand,
    toPortId: "heat-in",
    label: "store-to-demand"
  }, stepIndex, diagnostics);
  const storeToAmbient = matchingConnection(runtimeModel, {
    fromComponent: store,
    fromPortId: "heat-loss",
    toComponent: ambient,
    toPortId: "heat-in",
    label: "store-to-ambient"
  }, stepIndex, diagnostics);
  const thermalConnections = runtimeModel.connections.filter(
    (connection) => connection.flowType === THERMAL_HEAT_FLOW_TYPE
  );
  if (thermalConnections.length !== 3) {
    diagnostics.push(resolverDiagnostic(
      "runtime.unsupported-thermal-topology",
      `Coupled runtime requires exactly three thermal connections; received ${thermalConnections.length}`,
      stepIndex
    ));
  }

  if (!heaterToStore || !storeToDemand || !storeToAmbient) {
    return null;
  }
  return {
    heater,
    store,
    demand,
    ambient,
    heaterToStore,
    storeToDemand,
    storeToAmbient
  };
}

function requireFiniteLimit(limits, field, {
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY
} = {}) {
  const value = limits?.[field];
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateThermalLimits(topology, limitsByComponentId, stepIndex, diagnostics) {
  const heaterLimits = limitsByComponentId.get(topology.heater.id);
  const storeLimits = limitsByComponentId.get(topology.store.id);
  const demandLimits = limitsByComponentId.get(topology.demand.id);
  const ambientLimits = limitsByComponentId.get(topology.ambient.id);
  const heaterValid =
    requireFiniteLimit(heaterLimits, "heatOutputPerElectricalInput", {
      minimum: Number.MIN_VALUE,
      maximum: 1
    }) &&
    requireFiniteLimit(heaterLimits, "maximumHeatOutputkW", { minimum: 0 }) &&
    requireFiniteLimit(heaterLimits, "supplyTemperatureC");
  const storeValid = [
    "maximumChargeHeatFlowkW",
    "maximumDischargeHeatFlowkW",
    "thermalCapacitykWhPerK",
    "heatLossCoefficientkWPerK"
  ].every((field) => requireFiniteLimit(storeLimits, field, {
    minimum: field === "thermalCapacitykWhPerK" ? Number.MIN_VALUE : 0
  })) && [
    "sourceTemperatureC",
    "minimumUsefulTemperatureC",
    "maximumTemperatureC"
  ].every((field) => requireFiniteLimit(storeLimits, field));
  const demandValid =
    requireFiniteLimit(demandLimits, "maximumHeatFlowkW", { minimum: 0 }) &&
    requireFiniteLimit(demandLimits, "minimumDeliveryTemperatureC");
  const ambientValid = requireFiniteLimit(ambientLimits, "ambientTemperatureC");

  for (const [component, valid] of [
    [topology.heater, heaterValid],
    [topology.store, storeValid],
    [topology.demand, demandValid],
    [topology.ambient, ambientValid]
  ]) {
    if (!valid) {
      diagnostics.push(resolverDiagnostic(
        "runtime.thermal-limits-contract",
        `${component.type} returned incomplete or invalid coupled operating limits`,
        stepIndex,
        `/components/${component.id}`
      ));
    }
  }

  return { heaterLimits, storeLimits, demandLimits, ambientLimits };
}

function allocateThermalCommands({
  topology,
  requests,
  limits,
  stepContext,
  stepIndex,
  diagnostics
}) {
  for (const component of [topology.store, topology.demand, topology.ambient]) {
    if (requests[component.id]) {
      diagnostics.push(resolverDiagnostic(
        "runtime.thermal-policy-request",
        `Thermal component ${component.id} is resolver-owned and must not receive a policy request`,
        stepIndex,
        `/components/${component.id}`
      ));
    }
  }

  const heaterRequest = requests[topology.heater.id];
  if (!heaterRequest) {
    diagnostics.push(resolverDiagnostic(
      "runtime.missing-policy-request",
      `Policy did not request operation for controllable component: ${topology.heater.id}`,
      stepIndex,
      `/components/${topology.heater.id}`
    ));
    return null;
  }

  const {
    heaterLimits,
    storeLimits,
    demandLimits,
    ambientLimits
  } = limits;
  const storeTemperatureC = storeLimits.sourceTemperatureC;
  const supplyTemperatureC = heaterLimits.supplyTemperatureC;
  const ambientTemperatureC = ambientLimits.ambientTemperatureC;
  const durationHours = stepContext.durationHours;
  const dischargeHeatFlowkW =
    storeTemperatureC >= demandLimits.minimumDeliveryTemperatureC
      ? Math.min(
          demandLimits.maximumHeatFlowkW,
          storeLimits.maximumDischargeHeatFlowkW
        )
      : 0;
  const feasibleRequestedPowerkW = clamp(
    heaterRequest.powerkW,
    heaterLimits.minimumPowerkW,
    heaterLimits.maximumPowerkW
  );
  const requestedHeatOutputkW = Math.min(
    heaterLimits.maximumHeatOutputkW,
    -feasibleRequestedPowerkW * heaterLimits.heatOutputPerElectricalInput
  );
  const standingLoss = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: storeLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: storeLimits.heatLossCoefficientkWPerK,
    temperatureC: storeTemperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW: requestedHeatOutputkW,
    dischargeHeatFlowkW,
    durationHours
  });
  const maximumChargeAtSupplyTemperaturekW = supplyTemperatureC < storeTemperatureC
    ? 0
    : Math.max(
        0,
        dischargeHeatFlowkW +
          standingLoss.unconstrainedHeatLosskW +
          storeLimits.thermalCapacitykWhPerK *
            (supplyTemperatureC - storeTemperatureC) /
            durationHours
      );
  const chargeHeatFlowkW = Math.min(
    requestedHeatOutputkW,
    storeLimits.maximumChargeHeatFlowkW,
    maximumChargeAtSupplyTemperaturekW
  );
  const heaterPowerkW = chargeHeatFlowkW === 0
    ? 0
    : -chargeHeatFlowkW / heaterLimits.heatOutputPerElectricalInput;
  const { heatLosskW } = calculateStandingHeatLoss({
    thermalCapacitykWhPerK: storeLimits.thermalCapacitykWhPerK,
    heatLossCoefficientkWPerK: storeLimits.heatLossCoefficientkWPerK,
    temperatureC: storeTemperatureC,
    ambientTemperatureC,
    chargeHeatFlowkW,
    dischargeHeatFlowkW,
    durationHours
  });

  return {
    adjustedHeaterRequest: { powerkW: heaterPowerkW },
    heaterActualCommand: {
      powerkW: heaterPowerkW,
      heatOutputkW: chargeHeatFlowkW
    },
    storeActualCommand: {
      chargeHeatFlowkW,
      chargeSourceTemperatureC: supplyTemperatureC,
      chargeDeliveryTemperatureC: supplyTemperatureC,
      dischargeHeatFlowkW,
      ambientTemperatureC
    },
    demandActualCommand: createThermalFlow({
      heatFlowkW: dischargeHeatFlowkW,
      sourceTemperatureC: storeTemperatureC,
      deliveryTemperatureC: storeTemperatureC
    }),
    ambientActualCommand: {
      heatFlowkW: heatLosskW,
      sourceTemperatureC: storeTemperatureC
    },
    heaterToStoreFlow: createThermalFlow({
      heatFlowkW: chargeHeatFlowkW,
      sourceTemperatureC: supplyTemperatureC,
      deliveryTemperatureC: supplyTemperatureC
    }),
    storeToDemandFlow: createThermalFlow({
      heatFlowkW: dischargeHeatFlowkW,
      sourceTemperatureC: storeTemperatureC,
      deliveryTemperatureC: storeTemperatureC
    }),
    storeToAmbientFlow: createThermalFlow({
      heatFlowkW: heatLosskW,
      sourceTemperatureC: storeTemperatureC,
      deliveryTemperatureC: ambientTemperatureC
    })
  };
}

export function resolveCoupledModel({
  runtimeModel,
  requests,
  limitsByComponentId,
  stepContext,
  tolerancekW
}) {
  const diagnostics = [];
  const topology = validateThermalTopology(
    runtimeModel,
    stepContext.stepIndex,
    diagnostics
  );
  if (!topology || diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }
  const limits = validateThermalLimits(
    topology,
    limitsByComponentId,
    stepContext.stepIndex,
    diagnostics
  );
  if (diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }
  const thermal = allocateThermalCommands({
    topology,
    requests,
    limits,
    stepContext,
    stepIndex: stepContext.stepIndex,
    diagnostics
  });
  if (!thermal || diagnostics.length > 0) {
    return { resolved: false, diagnostics };
  }

  const electricalRequests = {
    ...requests,
    [topology.heater.id]: thermal.adjustedHeaterRequest
  };
  const electrical = resolveElectricalBus({
    runtimeModel,
    requests: electricalRequests,
    limitsByComponentId,
    stepIndex: stepContext.stepIndex,
    tolerancekW
  });
  diagnostics.push(...electrical.diagnostics);
  if (!electrical.resolved) {
    return { resolved: false, diagnostics };
  }

  const feasibleCommands = new Map(electrical.feasibleCommands);
  const actualCommands = new Map(electrical.actualCommands);
  const connectionFlows = new Map(electrical.connectionFlows);
  feasibleCommands.set(topology.heater.id, thermal.heaterActualCommand);
  actualCommands.set(topology.heater.id, thermal.heaterActualCommand);
  for (const component of [topology.store, topology.demand, topology.ambient]) {
    feasibleCommands.set(component.id, null);
  }
  actualCommands.set(topology.store.id, thermal.storeActualCommand);
  actualCommands.set(topology.demand.id, thermal.demandActualCommand);
  actualCommands.set(topology.ambient.id, thermal.ambientActualCommand);
  connectionFlows.set(topology.heaterToStore.id, thermal.heaterToStoreFlow);
  connectionFlows.set(topology.storeToDemand.id, thermal.storeToDemandFlow);
  connectionFlows.set(topology.storeToAmbient.id, thermal.storeToAmbientFlow);

  return {
    resolved: true,
    feasibleCommands,
    actualCommands,
    connectionFlows,
    diagnostics
  };
}
