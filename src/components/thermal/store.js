import {
  ABSOLUTE_ZERO_C,
  MATERIAL_MASS_FLOW_TYPE,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";
import {
  createMaterialFlow,
  materialEnthalpyFlowkW
} from "../../core/material-flow.js";
import { createThermalFlow } from "../../core/thermal-flow.js";
import {
  resolutionDescription,
  resolutionError
} from "../model-resolution.js";

const TOLERANCE = 1e-9;
const COMMAND_FIELDS = new Set([
  "materialInFlow",
  "materialOutFlow",
  "heatInFlows",
  "heatOutFlow",
  "passiveHeatInFlows",
  "passiveHeatOutFlows"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueOrDefault(values, specifications, field) {
  return Object.hasOwn(values, field)
    ? values[field]
    : specifications[field].default;
}

function normaliseZero(value) {
  return Math.abs(value) <= TOLERANCE ? 0 : value;
}

function specificEnthalpyKjPerKg(state) {
  return state.massKg === 0
    ? 0
    : state.containedEnthalpykWh * 3600 / state.massKg;
}

function storeTemperatureC(runtimeComponent, state) {
  return runtimeComponent.parameters.enthalpyReferenceTemperatureC +
    specificEnthalpyKjPerKg(state) /
      runtimeComponent.parameters.specificHeatCapacityKjPerKgK;
}

function thermalCapacitykWhPerK(runtimeComponent, state) {
  return state.massKg *
    runtimeComponent.parameters.specificHeatCapacityKjPerKgK /
    3600;
}

function connectionsForPort(runtimeComponent, context, portId) {
  return context.connections.filter((connection) =>
    (
      connection.from.component === runtimeComponent &&
      connection.from.port.id === portId
    ) ||
    (
      connection.to.component === runtimeComponent &&
      connection.to.port.id === portId
    )
  );
}

function optionalConnection(runtimeComponent, context, portId) {
  const connections = connectionsForPort(runtimeComponent, context, portId);
  if (connections.length > 1) {
    throw resolutionError(
      "runtime.component-connection-count",
      `${runtimeComponent.id}.${portId} permits at most one connection`
    );
  }
  return connections[0] ?? null;
}

function otherComponent(runtimeComponent, connection) {
  return connection.from.component === runtimeComponent
    ? connection.to.component
    : connection.from.component;
}

function storeTopology(runtimeComponent, context) {
  const materialIn = optionalConnection(
    runtimeComponent,
    context,
    "material-in"
  );
  const materialOut = optionalConnection(
    runtimeComponent,
    context,
    "material-out"
  );
  const heatIn = connectionsForPort(runtimeComponent, context, "heat-in");
  const heatOut = optionalConnection(runtimeComponent, context, "heat-out");
  const passiveHeatIn = connectionsForPort(
    runtimeComponent,
    context,
    "passive-heat-in"
  );
  const passiveHeatOut = connectionsForPort(
    runtimeComponent,
    context,
    "passive-heat-out"
  );

  if (
    (materialIn && materialIn.to.component !== runtimeComponent) ||
    (materialOut && materialOut.from.component !== runtimeComponent) ||
    heatIn.some((connection) => connection.to.component !== runtimeComponent) ||
    (heatOut && heatOut.from.component !== runtimeComponent) ||
    passiveHeatIn.some(
      (connection) => connection.to.component !== runtimeComponent
    ) ||
    passiveHeatOut.some(
      (connection) => connection.from.component !== runtimeComponent
    )
  ) {
    throw resolutionError(
      "runtime.unsupported-thermal-store-topology",
      `Connections around ${runtimeComponent.id} have the wrong direction`
    );
  }

  return {
    materialIn,
    materialOut,
    heatIn,
    heatOut,
    passiveHeatIn,
    passiveHeatOut
  };
}

function finiteCapability(limits, field, { positive = false } = {}) {
  const value = limits?.[field];
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      `Thermal capability ${field} is missing or invalid`
    );
  }
  return value;
}

function zeroMaterialFlow(specificEnthalpy = 0) {
  return createMaterialFlow({
    massFlowKgPerSecond: 0,
    specificEnthalpyKjPerKg: specificEnthalpy
  });
}

function zeroThermalFlow(temperatureC) {
  return createThermalFlow({
    heatFlowkW: 0,
    sourceTemperatureC: temperatureC,
    deliveryTemperatureC: temperatureC
  });
}

function requestedMaterialOutflow(runtimeComponent, context, connected) {
  if (!connected) {
    return 0;
  }
  const value = context.target?.massOutflowKgPerSecond;
  if (!Number.isFinite(value) || value < 0) {
    throw resolutionError(
      "runtime.missing-policy-target",
      `Policy did not provide a finite, non-negative mass-outflow target for ${runtimeComponent.id}`
    );
  }
  return value;
}

function requestedHeatInputs(runtimeComponent, context, connections) {
  return connections.map((connection) => {
    const source = otherComponent(runtimeComponent, connection);
    const target = context.getTarget(source.id);
    if (!target) {
      throw resolutionError(
        "runtime.missing-policy-target",
        `Policy did not provide a heat-source target for ${source.id}`
      );
    }
    const limits = context.getOperatingLimits(source.id);
    const maximumHeatOutputkW = finiteCapability(
      limits,
      "maximumHeatOutputkW"
    );
    if (!Number.isFinite(limits.supplyTemperatureC)) {
      throw resolutionError(
        "runtime.thermal-capability-contract",
        "Thermal capability supplyTemperatureC is missing or invalid"
      );
    }
    let requestedHeatFlowkW;
    if (Number.isFinite(target.heatOutputkW) && target.heatOutputkW >= 0) {
      requestedHeatFlowkW = Math.min(
        maximumHeatOutputkW,
        target.heatOutputkW
      );
    } else if (Number.isFinite(target.powerkW)) {
      const conversion = finiteCapability(
        limits,
        "heatOutputPerElectricalInput",
        { positive: true }
      );
      const minimumPowerkW = limits?.minimumPowerkW;
      const maximumPowerkW = limits?.maximumPowerkW;
      if (
        !Number.isFinite(minimumPowerkW) ||
        !Number.isFinite(maximumPowerkW) ||
        minimumPowerkW > maximumPowerkW
      ) {
        throw resolutionError(
          "runtime.thermal-capability-contract",
          "A power-targeted heat source must publish valid power limits"
        );
      }
      const requestedPowerkW = Math.min(
        maximumPowerkW,
        Math.max(minimumPowerkW, target.powerkW)
      );
      requestedHeatFlowkW = Math.min(
        maximumHeatOutputkW,
        -requestedPowerkW * conversion
      );
    } else {
      throw resolutionError(
        "runtime.missing-policy-target",
        `Policy target for ${source.id} must provide non-negative heatOutputkW or finite powerkW`
      );
    }
    return {
      connection,
      requestedHeatFlowkW,
      supplyTemperatureC: limits.supplyTemperatureC
    };
  });
}

function resolveHeatOutput(runtimeComponent, context, connection) {
  const temperatureC = context.operatingLimits.temperatureC;
  if (!connection) {
    return zeroThermalFlow(temperatureC);
  }
  const consumer = otherComponent(runtimeComponent, connection);
  const limits = context.getOperatingLimits(consumer.id);
  const demandHeatFlowkW = finiteCapability(limits, "maximumHeatFlowkW");
  if (!Number.isFinite(limits.minimumDeliveryTemperatureC)) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      "Thermal capability minimumDeliveryTemperatureC is missing or invalid"
    );
  }
  const heatFlowkW =
    temperatureC >= limits.minimumDeliveryTemperatureC
      ? Math.min(
          demandHeatFlowkW,
          context.operatingLimits.maximumHeatOutputkW
        )
      : 0;
  return createThermalFlow({
    heatFlowkW,
    sourceTemperatureC: temperatureC,
    deliveryTemperatureC: temperatureC
  });
}

function settledThermalFlows(context, connections) {
  const flows = {};
  for (const connection of connections) {
    const flow = context.getConnectionFlow(connection.id);
    if (flow === undefined) {
      return null;
    }
    flows[connection.id] = createThermalFlow(flow);
  }
  return flows;
}

function sumHeatFlowkW(flows) {
  return Object.values(flows).reduce(
    (total, flow) => total + flow.heatFlowkW,
    0
  );
}

function resolveStore(runtimeComponent, context, stepContext) {
  const topology = storeTopology(runtimeComponent, context);
  const passiveHeatInFlows = settledThermalFlows(
    context,
    topology.passiveHeatIn
  );
  const passiveHeatOutFlows = settledThermalFlows(
    context,
    topology.passiveHeatOut
  );
  if (passiveHeatInFlows === null || passiveHeatOutFlows === null) {
    return null;
  }
  const currentSpecificEnthalpy = context.operatingLimits.specificEnthalpyKjPerKg;
  const materialInFlow = topology.materialIn
    ? context.getConnectionFlow(topology.materialIn.id)
    : zeroMaterialFlow(currentSpecificEnthalpy);
  if (materialInFlow === undefined) {
    return null;
  }
  const checkedMaterialInFlow = createMaterialFlow(materialInFlow);
  const heatOutFlow = resolveHeatOutput(
    runtimeComponent,
    context,
    topology.heatOut
  );
  const massOutflowKgPerSecond = Math.min(
    requestedMaterialOutflow(runtimeComponent, context, topology.materialOut),
    context.operatingLimits.maximumMassOutflowKgPerSecond
  );
  const materialOutFlow = createMaterialFlow({
    massFlowKgPerSecond: massOutflowKgPerSecond,
    specificEnthalpyKjPerKg: currentSpecificEnthalpy
  });
  const requestedInputs = requestedHeatInputs(
    runtimeComponent,
    context,
    topology.heatIn
  );
  const requestedHeatInputkW = requestedInputs.reduce(
    (total, input) => total + input.requestedHeatFlowkW,
    0
  );
  const passiveHeatInputkW = sumHeatFlowkW(passiveHeatInFlows);
  const passiveHeatOutputkW = sumHeatFlowkW(passiveHeatOutFlows);
  const nextMassKg = context.operatingLimits.containedMassKg +
    (checkedMaterialInFlow.massFlowKgPerSecond - massOutflowKgPerSecond) *
      stepContext.timeStepSeconds;
  const enthalpyInflowkW = materialEnthalpyFlowkW(checkedMaterialInFlow);
  const enthalpyOutflowkW = materialEnthalpyFlowkW(materialOutFlow);
  const baseNextEnthalpykWh =
    context.operatingLimits.containedEnthalpykWh +
    (
      enthalpyInflowkW -
      enthalpyOutflowkW -
      heatOutFlow.heatFlowkW +
      passiveHeatInputkW -
      passiveHeatOutputkW
    ) * stepContext.durationHours;
  const maximumHeatInputForTemperature = (temperatureLimitC) => Math.max(
    0,
    (
      nextMassKg *
        runtimeComponent.parameters.specificHeatCapacityKjPerKgK *
        (
          temperatureLimitC -
          runtimeComponent.parameters.enthalpyReferenceTemperatureC
        ) /
        3600 -
      baseNextEnthalpykWh
    ) / stepContext.durationHours
  );
  const maximumInputFromTemperaturekW = maximumHeatInputForTemperature(
    runtimeComponent.parameters.maximumTemperatureC
  );
  let remainingHeatInputkW = Math.min(
    requestedHeatInputkW,
    context.operatingLimits.maximumHeatInputkW,
    maximumInputFromTemperaturekW
  );
  let allocatedHeatInputkW = 0;
  const heatInFlows = {};
  for (const input of requestedInputs) {
    const maximumTotalAtSupplyTemperaturekW =
      maximumHeatInputForTemperature(input.supplyTemperatureC);
    const heatFlowkW = Math.min(
      input.requestedHeatFlowkW,
      remainingHeatInputkW,
      Math.max(0, maximumTotalAtSupplyTemperaturekW - allocatedHeatInputkW)
    );
    heatInFlows[input.connection.id] = createThermalFlow({
      heatFlowkW,
      sourceTemperatureC: input.supplyTemperatureC,
      deliveryTemperatureC: input.supplyTemperatureC
    });
    allocatedHeatInputkW += heatFlowkW;
    remainingHeatInputkW -= heatFlowkW;
  }
  const command = {
    materialInFlow: checkedMaterialInFlow,
    materialOutFlow,
    heatInFlows,
    heatOutFlow,
    passiveHeatInFlows,
    passiveHeatOutFlows
  };
  const connectionFlows = Object.fromEntries([
    ...(topology.materialOut
      ? [[topology.materialOut.id, materialOutFlow]]
      : []),
    ...topology.heatIn.map((connection) => [
      connection.id,
      heatInFlows[connection.id]
    ]),
    ...(topology.heatOut ? [[topology.heatOut.id, heatOutFlow]] : [])
  ]);
  return {
    feasibleCommand: topology.materialOut
      ? { massOutflowKgPerSecond }
      : null,
    actualCommand: command,
    connectionFlows
  };
}

function requireCommand(command) {
  if (!isRecord(command)) {
    throw new TypeError("Thermal-store command must be an object");
  }
  const fields = Object.keys(command);
  if (
    fields.length !== COMMAND_FIELDS.size ||
    fields.some((field) => !COMMAND_FIELDS.has(field)) ||
    !isRecord(command.heatInFlows) ||
    !isRecord(command.passiveHeatInFlows) ||
    !isRecord(command.passiveHeatOutFlows)
  ) {
    throw new TypeError(
      "Thermal-store command must contain exactly its material and heat flows"
    );
  }
}

export const thermalStoreDefinition = {
  type: "thermal.store",
  version: "0.2.0",
  name: "Thermal store",

  parameters: {
    maximumMassKg: {
      unit: "kg",
      default: 1000,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 10000, step: 10 }
    },
    specificHeatCapacityKjPerKgK: {
      unit: "kJ / kgK",
      default: 1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0.1, maximum: 5, step: 0.1 }
    },
    enthalpyReferenceTemperatureC: {
      unit: "°C",
      default: 0,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: -50, maximum: 200, step: 5 }
    },
    maximumTemperatureC: {
      unit: "°C",
      default: 200,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 20, maximum: 2000, step: 1 }
    },
    minimumUsefulTemperatureC: {
      unit: "°C",
      default: 0,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: -50, maximum: 1800, step: 1 }
    },
    maximumHeatInputkW: {
      unit: "kW",
      default: 0,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 5 }
    },
    maximumHeatOutputkW: {
      unit: "kW",
      default: 0,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 2000, step: 5 }
    }
  },

  initialState: {
    massKg: { unit: "kg", default: 0 },
    containedEnthalpykWh: { unit: "kWh", default: 0 }
  },

  ports: [
    {
      id: "material-in",
      flowType: MATERIAL_MASS_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "material-out",
      flowType: MATERIAL_MASS_FLOW_TYPE,
      direction: "out"
    },
    {
      id: "heat-in",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in",
      cardinality: "many"
    },
    {
      id: "heat-out",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    },
    {
      id: "passive-heat-in",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in",
      cardinality: "many"
    },
    {
      id: "passive-heat-out",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out",
      cardinality: "many"
    }
  ],

  outputs: {
    massInflowKgPerSecond: { label: "Material inflow", unit: "kg/s" },
    massOutflowKgPerSecond: { label: "Material outflow", unit: "kg/s" },
    materialOutflowTemperatureC: { label: "Discharge temperature", unit: "°C" },
    materialOutflowTemperatureMarginK: { label: "Discharge temperature margin", unit: "K" },
    enthalpyInflowkW: { label: "Material enthalpy rate in", unit: "kW" },
    enthalpyOutflowkW: { label: "Material enthalpy rate out", unit: "kW" },
    heatInputkW: { label: "Heat-transfer input", unit: "kW" },
    heatOutputkW: { label: "Heat-transfer output", unit: "kW" },
    passiveHeatInputkW: { unit: "kW" },
    passiveHeatOutputkW: { unit: "kW" },
    netEnergyFlowkW: { label: "Stored enthalpy change rate", unit: "kW" },
    containedMassKg: { unit: "kg" },
    containedEnthalpykWh: { unit: "kWh" },
    specificEnthalpyKjPerKg: { unit: "kJ/kg" },
    temperatureC: { unit: "°C" },
    usableEnergykWh: { unit: "kWh" },
    temperatureMarginK: { unit: "K" }
  },

  editor: {
    visualRole: "store",
    summaryOutput: "temperatureC",
    temperatureChart: {
      outputField: "temperatureC",
      thresholdParameter: "minimumUsefulTemperatureC",
      thresholdLabel: "Minimum useful"
    },
    groups: [
      {
        id: "storage",
        label: "Storage",
        parameters: [
          "maximumMassKg",
          "specificHeatCapacityKjPerKgK",
          "enthalpyReferenceTemperatureC",
          "maximumTemperatureC",
          "minimumUsefulTemperatureC"
        ]
      },
      {
        id: "heat-transfer",
        label: "Heat transfer",
        parameters: [
          "maximumHeatInputkW",
          "maximumHeatOutputkW"
        ]
      }
    ]
  },

  validate(modelComponent) {
    const parameters = Object.fromEntries(Object.keys(
      thermalStoreDefinition.parameters
    ).map((field) => [
      field,
      valueOrDefault(
        modelComponent.parameters,
        thermalStoreDefinition.parameters,
        field
      )
    ]));
    const state = Object.fromEntries(Object.keys(
      thermalStoreDefinition.initialState
    ).map((field) => [
      field,
      valueOrDefault(
        modelComponent.initialState,
        thermalStoreDefinition.initialState,
        field
      )
    ]));
    const diagnostics = [];
    if (!Number.isFinite(parameters.maximumMassKg) || parameters.maximumMassKg <= 0) {
      diagnostics.push({
        code: "thermal.store.maximum-mass",
        message: "Maximum mass must be finite and greater than zero"
      });
    }
    if (
      !Number.isFinite(parameters.specificHeatCapacityKjPerKgK) ||
      parameters.specificHeatCapacityKjPerKgK <= 0
    ) {
      diagnostics.push({
        code: "thermal.store.specific-heat-capacity",
        message: "Specific heat capacity must be finite and greater than zero"
      });
    }
    if (
      !Number.isFinite(parameters.enthalpyReferenceTemperatureC) ||
      parameters.enthalpyReferenceTemperatureC < ABSOLUTE_ZERO_C ||
      parameters.enthalpyReferenceTemperatureC > parameters.maximumTemperatureC
    ) {
      diagnostics.push({
        code: "thermal.store.enthalpy-reference-temperature",
        message: "Enthalpy-reference temperature must be within the store temperature range"
      });
    }
    if (
      !Number.isFinite(parameters.minimumUsefulTemperatureC) ||
      parameters.minimumUsefulTemperatureC < ABSOLUTE_ZERO_C ||
      parameters.minimumUsefulTemperatureC >= parameters.maximumTemperatureC
    ) {
      diagnostics.push({
        code: "thermal.store.temperature-range",
        message: "Minimum useful temperature must be below maximum temperature"
      });
    }
    if (
      !Number.isFinite(parameters.maximumTemperatureC) ||
      parameters.maximumTemperatureC <= ABSOLUTE_ZERO_C
    ) {
      diagnostics.push({
        code: "thermal.store.maximum-temperature",
        message: "Maximum temperature must be finite and above absolute zero"
      });
    }
    for (const [field, code, label] of [
      [
        "maximumHeatInputkW",
        "thermal.store.maximum-heat-input",
        "Maximum heat input"
      ],
      [
        "maximumHeatOutputkW",
        "thermal.store.maximum-heat-output",
        "Maximum heat output"
      ]
    ]) {
      if (!Number.isFinite(parameters[field]) || parameters[field] < 0) {
        diagnostics.push({
          code,
          message: `${label} must be finite and non-negative`
        });
      }
    }
    if (
      !Number.isFinite(state.massKg) ||
      state.massKg < 0 ||
      state.massKg > parameters.maximumMassKg
    ) {
      diagnostics.push({
        code: "thermal.store.initial-mass",
        message: "Initial mass must be finite and within store capacity"
      });
    }
    if (!Number.isFinite(state.containedEnthalpykWh)) {
      diagnostics.push({
        code: "thermal.store.initial-enthalpy",
        message: "Initial contained enthalpy must be finite"
      });
    } else if (state.massKg === 0 && state.containedEnthalpykWh !== 0) {
      diagnostics.push({
        code: "thermal.store.empty-enthalpy",
        message: "An empty store must have zero contained enthalpy"
      });
    } else if (
      state.massKg > 0 &&
      Number.isFinite(parameters.specificHeatCapacityKjPerKgK) &&
      parameters.specificHeatCapacityKjPerKgK > 0
    ) {
      const initialTemperatureC =
        parameters.enthalpyReferenceTemperatureC +
        state.containedEnthalpykWh * 3600 /
          state.massKg /
          parameters.specificHeatCapacityKjPerKgK;
      if (
        initialTemperatureC < ABSOLUTE_ZERO_C ||
        initialTemperatureC > parameters.maximumTemperatureC
      ) {
        diagnostics.push({
          code: "thermal.store.initial-temperature",
          message: "Initial temperature must be within the store temperature range"
        });
      }
    }
    return diagnostics;
  },

  resolution: {
    describe(runtimeComponent, context) {
      const topology = storeTopology(runtimeComponent, context);
      const targets = new Set(topology.heatIn.map((connection) =>
        otherComponent(runtimeComponent, connection).id
      ));
      if (topology.materialOut) {
        targets.add(runtimeComponent.id);
      }
      return resolutionDescription({
        targets: [...targets],
        connectionFlows: [
          ...(topology.materialIn ? [topology.materialIn.id] : []),
          ...topology.passiveHeatIn.map((connection) => connection.id),
          ...topology.passiveHeatOut.map((connection) => connection.id)
        ],
        determines: [
          ...(topology.materialOut ? [topology.materialOut.id] : []),
          ...topology.heatIn.map((connection) => connection.id),
          ...(topology.heatOut ? [topology.heatOut.id] : [])
        ]
      });
    }
  },

  model: {
    prepare(modelComponent, context) {
      return { finalStepIndex: context.scenario.time.stepCount - 1 };
    },

    initialise(runtimeComponent) {
      return { ...runtimeComponent.initialState };
    },

    getOperatingLimits(runtimeComponent, stepContext, target = null) {
      const temperatureC = storeTemperatureC(runtimeComponent, stepContext.state);
      const requestedOutflow = target?.massOutflowKgPerSecond ?? 0;
      if (!Number.isFinite(requestedOutflow) || requestedOutflow < 0) {
        throw new RangeError("Material-outflow target must be finite and non-negative");
      }
      const remainingMassKg = Math.max(0, stepContext.state.massKg -
        requestedOutflow * stepContext.timeStepSeconds);
      const capacity = thermalCapacitykWhPerK(runtimeComponent, {
        massKg: remainingMassKg
      });
      const maximumHeatOutputFromEnergykW = capacity > 0
        ? capacity * Math.max(
            0,
            temperatureC - runtimeComponent.parameters.minimumUsefulTemperatureC
          ) / stepContext.durationHours
        : 0;
      return {
        maximumMassOutflowKgPerSecond:
          stepContext.state.massKg / stepContext.timeStepSeconds,
        maximumHeatInputkW: runtimeComponent.parameters.maximumHeatInputkW,
        maximumHeatOutputkW: Math.min(
          runtimeComponent.parameters.maximumHeatOutputkW,
          maximumHeatOutputFromEnergykW
        ),
        containedMassKg: stepContext.state.massKg,
        containedEnthalpykWh: stepContext.state.containedEnthalpykWh,
        specificEnthalpyKjPerKg: specificEnthalpyKjPerKg(stepContext.state),
        temperatureC,
        thermalCapacitykWhPerK: capacity,
        minimumUsefulTemperatureC:
          runtimeComponent.parameters.minimumUsefulTemperatureC,
        maximumTemperatureC: runtimeComponent.parameters.maximumTemperatureC
      };
    },

    resolve(runtimeComponent, context, stepContext) {
      return resolveStore(runtimeComponent, context, stepContext);
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      requireCommand(actualCommand);
      const materialInFlow = createMaterialFlow(actualCommand.materialInFlow);
      const materialOutFlow = createMaterialFlow(actualCommand.materialOutFlow);
      const heatInFlows = Object.fromEntries(Object.entries(
        actualCommand.heatInFlows
      ).map(([connectionId, flow]) => [
        connectionId,
        createThermalFlow(flow)
      ]));
      const heatOutFlow = createThermalFlow(actualCommand.heatOutFlow);
      const passiveHeatInFlows = Object.fromEntries(Object.entries(
        actualCommand.passiveHeatInFlows
      ).map(([connectionId, flow]) => [
        connectionId,
        createThermalFlow(flow)
      ]));
      const passiveHeatOutFlows = Object.fromEntries(Object.entries(
        actualCommand.passiveHeatOutFlows
      ).map(([connectionId, flow]) => [
        connectionId,
        createThermalFlow(flow)
      ]));
      const heatInputkW = Object.values(heatInFlows).reduce(
        (total, flow) => total + flow.heatFlowkW,
        0
      );
      const heatOutputkW = heatOutFlow.heatFlowkW;
      const passiveHeatInputkW = sumHeatFlowkW(passiveHeatInFlows);
      const passiveHeatOutputkW = sumHeatFlowkW(passiveHeatOutFlows);
      const currentTemperatureC = storeTemperatureC(
        runtimeComponent,
        stepContext.state
      );
      const operatingLimits = thermalStoreDefinition.model.getOperatingLimits(
        runtimeComponent,
        stepContext
      );
      if (heatInputkW > operatingLimits.maximumHeatInputkW + TOLERANCE) {
        throw new RangeError("Thermal-store heat input exceeds its operating limit");
      }
      if (heatOutputkW > operatingLimits.maximumHeatOutputkW + TOLERANCE) {
        throw new RangeError("Thermal-store heat output exceeds its operating limit");
      }
      if (
        materialOutFlow.massFlowKgPerSecond >
          operatingLimits.maximumMassOutflowKgPerSecond + TOLERANCE
      ) {
        throw new RangeError("Thermal-store material outflow exceeds its operating limit");
      }
      if (
        materialOutFlow.massFlowKgPerSecond > 0 &&
        Math.abs(
          materialOutFlow.specificEnthalpyKjPerKg -
          operatingLimits.specificEnthalpyKjPerKg
        ) > TOLERANCE
      ) {
        throw new RangeError(
          "Thermal-store material outflow must carry the store specific enthalpy"
        );
      }
      for (const [label, flow] of [
        ["heat output", heatOutFlow],
        ...Object.values(passiveHeatOutFlows).map((flow) => [
          "passive heat output",
          flow
        ])
      ]) {
        if (Math.abs(flow.sourceTemperatureC - currentTemperatureC) > TOLERANCE) {
          throw new RangeError(
            `Thermal-store ${label} must use the store source temperature`
          );
        }
      }
      for (const flow of Object.values(passiveHeatInFlows)) {
        if (
          Math.abs(flow.deliveryTemperatureC - currentTemperatureC) >
            TOLERANCE
        ) {
          throw new RangeError(
            "Thermal-store passive heat input must use the store delivery temperature"
          );
        }
      }
      for (const flow of Object.values(heatInFlows)) {
        if (
          flow.heatFlowkW > 0 &&
          flow.deliveryTemperatureC < currentTemperatureC
        ) {
          throw new RangeError(
            "Positive store heating requires delivery temperature at least as high as the store temperature"
          );
        }
      }
      const enthalpyInflowkW = materialEnthalpyFlowkW(materialInFlow);
      const enthalpyOutflowkW = materialEnthalpyFlowkW(materialOutFlow);
      const nextMassKg = normaliseZero(
        stepContext.state.massKg +
          (materialInFlow.massFlowKgPerSecond -
            materialOutFlow.massFlowKgPerSecond) *
            stepContext.timeStepSeconds
      );
      const netEnergyFlowkW =
        enthalpyInflowkW +
        heatInputkW -
        enthalpyOutflowkW -
        heatOutputkW -
        passiveHeatOutputkW +
        passiveHeatInputkW;
      const nextEnthalpykWh = normaliseZero(
        stepContext.state.containedEnthalpykWh +
          netEnergyFlowkW * stepContext.durationHours
      );
      if (
        nextMassKg < 0 ||
        nextMassKg > runtimeComponent.parameters.maximumMassKg + TOLERANCE
      ) {
        throw new RangeError("Thermal-store mass is outside its capacity");
      }
      if (nextMassKg === 0 && nextEnthalpykWh !== 0) {
        throw new RangeError("An empty thermal store cannot contain enthalpy");
      }
      const nextState = {
        massKg: nextMassKg,
        containedEnthalpykWh: nextEnthalpykWh
      };
      const nextTemperatureC = storeTemperatureC(runtimeComponent, nextState);
      if (
        nextTemperatureC < ABSOLUTE_ZERO_C - TOLERANCE ||
        nextTemperatureC > runtimeComponent.parameters.maximumTemperatureC + TOLERANCE
      ) {
        throw new RangeError("Thermal-store temperature is outside its bounds");
      }
      const inputDeliveryTemperatures = Object.values(heatInFlows)
        .filter((flow) => flow.heatFlowkW > 0)
        .map((flow) => flow.deliveryTemperatureC);
      if (
        materialInFlow.massFlowKgPerSecond === 0 &&
        inputDeliveryTemperatures.length > 0 &&
        nextTemperatureC > Math.min(...inputDeliveryTemperatures) + TOLERANCE
      ) {
        throw new RangeError(
          "Store heating cannot raise the store above the heat delivery temperature"
        );
      }
      const temperatureMarginK =
        nextTemperatureC - runtimeComponent.parameters.minimumUsefulTemperatureC;
      const materialOutflowTemperatureMarginK =
        currentTemperatureC - runtimeComponent.parameters.minimumUsefulTemperatureC;
      const diagnostics = [];
      if (
        runtimeComponent.ports.find(({ id }) => id === "heat-out")
          .connectionIds.length === 0 &&
        runtimeComponent.ports.find(({ id }) => id === "material-out")
          .connectionIds.length === 0 &&
        nextMassKg > TOLERANCE &&
        stepContext.stepIndex === runtimeComponent.modelData.finalStepIndex &&
        temperatureMarginK < -TOLERANCE
      ) {
        diagnostics.push({
          severity: "warning",
          code: "thermal.store.minimum-temperature-missed",
          message: `Final store temperature is ${-temperatureMarginK} K below the minimum useful temperature`
        });
      }
      if (
        materialOutFlow.massFlowKgPerSecond > TOLERANCE &&
        materialOutflowTemperatureMarginK < -TOLERANCE
      ) {
        diagnostics.push({
          severity: "warning",
          code: "thermal.store.material-delivery-temperature",
          message: `Material leaves ${-materialOutflowTemperatureMarginK} K below the minimum useful temperature`
        });
      }
      const nextSpecificEnthalpyKjPerKg = specificEnthalpyKjPerKg(nextState);
      return {
        portFlows: {
          "material-in": materialInFlow,
          "material-out": materialOutFlow,
          "heat-in": heatInFlows,
          "heat-out": heatOutFlow,
          "passive-heat-in": passiveHeatInFlows,
          "passive-heat-out": passiveHeatOutFlows
        },
        outputs: {
          massInflowKgPerSecond: materialInFlow.massFlowKgPerSecond,
          massOutflowKgPerSecond: materialOutFlow.massFlowKgPerSecond,
          materialOutflowTemperatureC: currentTemperatureC,
          materialOutflowTemperatureMarginK,
          enthalpyInflowkW,
          enthalpyOutflowkW,
          heatInputkW,
          heatOutputkW,
          passiveHeatInputkW,
          passiveHeatOutputkW,
          netEnergyFlowkW,
          containedMassKg: nextMassKg,
          containedEnthalpykWh: nextEnthalpykWh,
          specificEnthalpyKjPerKg: nextSpecificEnthalpyKjPerKg,
          temperatureC: nextTemperatureC,
          usableEnergykWh: nextMassKg *
            runtimeComponent.parameters.specificHeatCapacityKjPerKgK *
            Math.max(0, temperatureMarginK) /
            3600,
          temperatureMarginK
        },
        nextState,
        diagnostics
      };
    }
  }
};
