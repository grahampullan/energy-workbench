import {
  ABSOLUTE_ZERO_C,
  THERMAL_HEAT_FLOW_TYPE
} from "../../core/flow-types.js";
import { createThermalFlow } from "../../core/thermal-flow.js";
import {
  resolutionDescription,
  resolutionError,
  singleConnection
} from "../model-resolution.js";

const TOLERANCE = 1e-9;
const COMMAND_FIELDS = new Set(["sourceFlow", "sinkFlow"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parameterValue(component, field) {
  return Object.hasOwn(component.parameters, field)
    ? component.parameters[field]
    : heatTransferDefinition.parameters[field].default;
}

function transferTopology(runtimeComponent, context) {
  const source = singleConnection(runtimeComponent, context, "source");
  const sink = singleConnection(runtimeComponent, context, "sink");
  if (
    source.to.component !== runtimeComponent ||
    sink.from.component !== runtimeComponent
  ) {
    throw resolutionError(
      "runtime.unsupported-heat-transfer-topology",
      `${runtimeComponent.id} must receive heat at source and emit it at sink`
    );
  }
  return { source, sink };
}

function otherComponent(runtimeComponent, connection) {
  return connection.from.component === runtimeComponent
    ? connection.to.component
    : connection.from.component;
}

function thermalBoundary(context, component, label) {
  const limits = context.getOperatingLimits(component.id);
  const temperatureC = limits?.temperatureC;
  const fixedTemperature = limits?.fixedTemperatureBoundary === true;
  const capacity = limits?.thermalCapacitykWhPerK;
  if (!Number.isFinite(temperatureC) || temperatureC < ABSOLUTE_ZERO_C) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      `${label} must publish a valid temperatureC capability`
    );
  }
  if (
    !fixedTemperature &&
    (!Number.isFinite(capacity) || capacity < 0)
  ) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      `${label} must publish thermalCapacitykWhPerK or be a fixed-temperature boundary`
    );
  }
  if (
    limits.maximumTemperatureC !== undefined &&
    !Number.isFinite(limits.maximumTemperatureC)
  ) {
    throw resolutionError(
      "runtime.thermal-capability-contract",
      `${label} maximumTemperatureC capability is invalid`
    );
  }
  return {
    temperatureC,
    fixedTemperature,
    thermalCapacitykWhPerK: fixedTemperature ? Infinity : capacity,
    maximumTemperatureC: limits.maximumTemperatureC ?? Infinity
  };
}

function equilibriumLimitkW(source, sink, durationHours) {
  const sourceInverseCapacity = source.fixedTemperature
    ? 0
    : source.thermalCapacitykWhPerK === 0
      ? Infinity
      : 1 / source.thermalCapacitykWhPerK;
  const sinkInverseCapacity = sink.fixedTemperature
    ? 0
    : sink.thermalCapacitykWhPerK === 0
      ? Infinity
      : 1 / sink.thermalCapacitykWhPerK;
  const inverseCapacity = sourceInverseCapacity + sinkInverseCapacity;
  if (inverseCapacity === 0) {
    return Infinity;
  }
  if (!Number.isFinite(inverseCapacity)) {
    return 0;
  }
  return Math.max(
    0,
    (source.temperatureC - sink.temperatureC) /
      inverseCapacity /
      durationHours
  );
}

function sinkTemperatureLimitkW(sink, durationHours) {
  if (sink.fixedTemperature) {
    return Infinity;
  }
  return sink.thermalCapacitykWhPerK * Math.max(
    0,
    sink.maximumTemperatureC - sink.temperatureC
  ) / durationHours;
}

function resolvedHeatFlowkW(runtimeComponent, source, sink, stepContext) {
  const unconstrainedHeatFlowkW =
    runtimeComponent.parameters.conductancekWPerK *
    Math.max(0, source.temperatureC - sink.temperatureC);
  return Math.min(
    unconstrainedHeatFlowkW,
    equilibriumLimitkW(source, sink, stepContext.durationHours),
    sinkTemperatureLimitkW(sink, stepContext.durationHours)
  );
}

function requireCommand(command) {
  if (
    !isRecord(command) ||
    Object.keys(command).length !== COMMAND_FIELDS.size ||
    Object.keys(command).some((field) => !COMMAND_FIELDS.has(field))
  ) {
    throw new TypeError(
      "Heat-transfer command must contain exactly sourceFlow and sinkFlow"
    );
  }
}

export const heatTransferDefinition = {
  type: "thermal.heat-transfer",
  version: "0.1.0",
  name: "Heat transfer",
  explanation: {
    title: "Directed thermal contact",
    summary: "Heat flows from the source to the sink according to conductance and their current temperature difference, subject to explicit-timestep temperature limits.",
    equations: [
      { label: "Conductance law", tex: String.raw`\dot Q_{\mathrm{free}}=G\max(0,T_s-T_d)` },
      { label: "Equilibrium limit", tex: String.raw`\dot Q_{\mathrm{eq}}=\frac{\max(0,T_s-T_d)}{\Delta t(1/C_s+1/C_d)}` },
      { label: "Sink temperature limit", tex: String.raw`\dot Q_{\mathrm{limit}}=\frac{C_d\max(0,T_{d,\max}-T_d)}{\Delta t}` },
      { label: "Actual heat transfer", tex: String.raw`\dot Q=\min(\dot Q_{\mathrm{free}},\dot Q_{\mathrm{eq}},\dot Q_{\mathrm{limit}})` }
    ],
    symbols: [
      { tex: String.raw`\dot Q`, description: "Heat-transfer rate", unit: "kW" },
      { tex: "G", description: "Thermal conductance", unit: "kW/K" },
      { tex: String.raw`T_s,\ T_d`, description: "Source and destination temperatures", unit: "°C" },
      { tex: String.raw`T_{d,\max}`, description: "Maximum destination temperature", unit: "°C" },
      { tex: String.raw`C_s,\ C_d`, description: "Source and destination thermal capacities available for heat exchange", unit: "kJ/K" },
      { tex: String.raw`\Delta t`, description: "Timestep duration", unit: "s" }
    ],
    notes: [
      "Transfer is directed and non-negative. A source no hotter than its sink transfers no heat.",
      "A finite body with zero thermal capacity transfers no heat. A fixed-temperature boundary has zero inverse capacity; a fixed-temperature sink imposes no upper-temperature limit.",
      "If both boundaries have fixed temperatures, the equilibrium limit is unbounded. The component stores no energy and delivers exactly the heat removed from its source."
    ]
  },

  parameters: {
    conductancekWPerK: {
      unit: "kW/K",
      default: 0.1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 1000, step: 0.01 }
    }
  },

  initialState: {},

  ports: [
    {
      id: "source",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "in"
    },
    {
      id: "sink",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    }
  ],

  outputs: {
    heatFlowkW: { unit: "kW" },
    sourceTemperatureC: { unit: "°C" },
    sinkTemperatureC: { unit: "°C" },
    temperatureDifferenceK: { unit: "K" }
  },

  editor: {
    visualRole: "interaction",
    summaryOutput: "heatFlowkW",
    hiddenFlowChartPorts: ["source"],
    groups: [{
      id: "transfer",
      label: "Heat transfer",
      parameters: ["conductancekWPerK"]
    }]
  },

  validate(modelComponent) {
    const conductancekWPerK = parameterValue(
      modelComponent,
      "conductancekWPerK"
    );
    if (!Number.isFinite(conductancekWPerK) || conductancekWPerK < 0) {
      return [{
        code: "thermal.heat-transfer.conductance",
        message: "Heat-transfer conductance must be finite and non-negative"
      }];
    }
    return [];
  },

  resolution: {
    describe(runtimeComponent, context) {
      const topology = transferTopology(runtimeComponent, context);
      return resolutionDescription({
        determines: [topology.source.id, topology.sink.id]
      });
    }
  },

  model: {
    prepare() {
      return {};
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent) {
      return {
        conductancekWPerK: runtimeComponent.parameters.conductancekWPerK
      };
    },

    resolve(runtimeComponent, context, stepContext) {
      const topology = transferTopology(runtimeComponent, context);
      const source = thermalBoundary(
        context,
        otherComponent(runtimeComponent, topology.source),
        "Heat-transfer source"
      );
      const sink = thermalBoundary(
        context,
        otherComponent(runtimeComponent, topology.sink),
        "Heat-transfer sink"
      );
      const heatFlowkW = resolvedHeatFlowkW(
        runtimeComponent,
        source,
        sink,
        stepContext
      );
      const sourceFlow = createThermalFlow({
        heatFlowkW,
        sourceTemperatureC: source.temperatureC,
        deliveryTemperatureC: source.temperatureC
      });
      const sinkFlow = createThermalFlow({
        heatFlowkW,
        sourceTemperatureC: source.temperatureC,
        deliveryTemperatureC: sink.temperatureC
      });
      return {
        feasibleCommand: null,
        actualCommand: { sourceFlow, sinkFlow },
        connectionFlows: {
          [topology.source.id]: sourceFlow,
          [topology.sink.id]: sinkFlow
        }
      };
    },

    evaluate(runtimeComponent, actualCommand) {
      requireCommand(actualCommand);
      const sourceFlow = createThermalFlow(actualCommand.sourceFlow);
      const sinkFlow = createThermalFlow(actualCommand.sinkFlow);
      if (Math.abs(sourceFlow.heatFlowkW - sinkFlow.heatFlowkW) > TOLERANCE) {
        throw new RangeError(
          "Heat-transfer source and sink heat flows must be equal"
        );
      }
      if (
        Math.abs(
          sourceFlow.sourceTemperatureC - sinkFlow.sourceTemperatureC
        ) > TOLERANCE ||
        Math.abs(
          sourceFlow.deliveryTemperatureC -
          sourceFlow.sourceTemperatureC
        ) > TOLERANCE
      ) {
        throw new RangeError(
          "Heat-transfer command must preserve its source boundary temperature"
        );
      }
      const temperatureDifferenceK = Math.max(
        0,
        sourceFlow.sourceTemperatureC - sinkFlow.deliveryTemperatureC
      );
      const unconstrainedHeatFlowkW =
        runtimeComponent.parameters.conductancekWPerK *
        temperatureDifferenceK;
      if (sourceFlow.heatFlowkW > unconstrainedHeatFlowkW + TOLERANCE) {
        throw new RangeError(
          "Heat-transfer flow exceeds its conductance equation"
        );
      }
      return {
        portFlows: { source: sourceFlow, sink: sinkFlow },
        outputs: {
          heatFlowkW: sourceFlow.heatFlowkW,
          sourceTemperatureC: sourceFlow.sourceTemperatureC,
          sinkTemperatureC: sinkFlow.deliveryTemperatureC,
          temperatureDifferenceK
        },
        nextState: {},
        diagnostics: []
      };
    }
  }
};
