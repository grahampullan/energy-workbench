import {
  ABSOLUTE_ZERO_C,
  createThermalFlow
} from "../../core/thermal-flow.js";
import { THERMAL_HEAT_FLOW_TYPE } from "../../core/flow-types.js";
import {
  singleConnection,
  singlePortFlowConsumerResolution
} from "../model-resolution.js";

function parameterValue(component, parameter) {
  return Object.hasOwn(component.parameters, parameter)
    ? component.parameters[parameter]
    : heatDemandDefinition.parameters[parameter].default;
}

function demandHeatFlowkW(runtimeComponent, stepContext) {
  const seriesValue = stepContext.seriesValues[runtimeComponent.modelData.demandSeriesId];
  const demand = seriesValue * runtimeComponent.modelData.profileMultiplier;
  if (!Number.isFinite(demand) || demand < 0) {
    throw new RangeError("Thermal demand must be a finite, non-negative power in kW");
  }
  return demand;
}

export const heatDemandDefinition = {
  type: "thermal.heat-demand",
  version: "0.2.0",
  name: "Heat demand",
  information: {
    outputs: {
      "requested-heat": { label: "Requested heat", quantity: "heat-rate", unit: "kW", read: ({ limits }) => limits.maximumHeatFlowkW }
    }
  },

  explanation: {
    title: "Useful heat demand",
    summary: "Heat satisfies the scaled scenario demand only when delivered at or above the required temperature.",
    equations: [
      { label: "Demand", tex: String.raw`\dot Q_d(t)=\alpha\dot Q_{\mathrm{profile}}(t)` },
      { label: "Useful delivery", tex: String.raw`\dot Q_{\mathrm{served}}=\begin{cases}\min(\dot Q_{\mathrm{in}},\dot Q_d),&T_{\mathrm{in}}\geq T_{\min}\\0,&T_{\mathrm{in}}<T_{\min}\end{cases}` },
      { label: "Unmet demand", tex: String.raw`\dot Q_{\mathrm{unmet}}=\dot Q_d-\dot Q_{\mathrm{served}}` }
    ],
    symbols: [
      { tex: String.raw`\dot Q_d,\dot Q_{\mathrm{profile}}`, description: "Scaled and prescribed heat demand", unit: "kW" },
      { tex: String.raw`\alpha`, description: "Demand profile multiplier", unit: "1" },
      { tex: String.raw`\dot Q_{\mathrm{in}},\dot Q_{\mathrm{served}},\dot Q_{\mathrm{unmet}}`, description: "Incoming, useful, and unmet heat rates", unit: "kW" },
      { tex: String.raw`T_{\mathrm{in}},T_{\min}`, description: "Delivery and minimum required temperatures", unit: "°C" },
      { tex: "t", description: "Simulation time", unit: "s" }
    ],
    notes: ["The demand has no thermal storage. Insufficient heat or delivery temperature produces an unmet-heat warning."]
  },

  parameters: {
    demandSeriesId: {
      unit: "scenario-series-id",
      default: "thermal-demand"
    },
    profileMultiplier: {
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0 },
      editor: { minimum: 0, maximum: 5, step: 0.1 }
    },
    minimumDeliveryTemperatureC: {
      unit: "°C",
      default: 70,
      hardBounds: { minimum: ABSOLUTE_ZERO_C },
      editor: { minimum: 20, maximum: 150, step: 1 }
    }
  },

  initialState: {},

  seriesParameters: ["demandSeriesId"],

  ports: [{
    id: "heat-in",
    flowType: THERMAL_HEAT_FLOW_TYPE,
    direction: "in",
    boundary: {
      operatingLimits: ["maximumHeatFlowkW", "minimumDeliveryTemperatureC"]
    }
  }],

  outputs: {
    demandHeatFlowkW: { unit: "kW", label: "Requested heat" },
    servedHeatFlowkW: { unit: "kW", label: "Supplied heat" },
    unmetHeatFlowkW: { unit: "kW", label: "Unmet heat" },
    deliveryTemperatureC: { unit: "°C" },
    deliveryTemperatureMarginK: { unit: "K" }
  },

  editor: {
    visualRole: "boundary",
    summaryOutput: "demandHeatFlowkW",
    summaryDetails: ["servedHeatFlowkW", "unmetHeatFlowkW"],
    groups: [{
      id: "demand",
      label: "Demand",
      parameters: [
        "demandSeriesId",
        "profileMultiplier",
        "minimumDeliveryTemperatureC"
      ]
    }]
  },

  validate(modelComponent) {
    const demandSeriesId = parameterValue(modelComponent, "demandSeriesId");
    if (typeof demandSeriesId !== "string" || demandSeriesId.length === 0) {
      return [{
        code: "thermal.heat-demand.demand-series-id",
        message: "demandSeriesId must be a non-empty scenario series ID"
      }];
    }
    return [];
  },

  resolution: singlePortFlowConsumerResolution("heat-in"),

  model: {
    prepare(modelComponent, context) {
      const demandSeriesId = modelComponent.parameters.demandSeriesId;
      const series = context.scenario.series.find(
        (candidate) => candidate.id === demandSeriesId
      );
      if (!series) {
        throw new Error(`Scenario series does not exist: ${demandSeriesId}`);
      }
      if (series.unit !== "kW") {
        throw new Error(`Scenario series ${demandSeriesId} must use kW, not ${series.unit}`);
      }
      return {
        demandSeriesId,
        profileMultiplier: modelComponent.parameters.profileMultiplier
      };
    },

    initialise() {
      return {};
    },

    getOperatingLimits(runtimeComponent, stepContext) {
      return {
        maximumHeatFlowkW: demandHeatFlowkW(runtimeComponent, stepContext),
        minimumDeliveryTemperatureC:
          runtimeComponent.parameters.minimumDeliveryTemperatureC
      };
    },

    resolve(runtimeComponent, context) {
      const connection = singleConnection(runtimeComponent, context, "heat-in");
      const flow = context.getConnectionFlow(connection.id);
      if (flow === undefined) {
        return null;
      }
      return {
        feasibleCommand: null,
        actualCommand: flow,
        connectionFlows: {}
      };
    },

    evaluate(runtimeComponent, actualCommand, stepContext) {
      const flow = createThermalFlow(actualCommand);
      const demand = demandHeatFlowkW(runtimeComponent, stepContext);
      const minimumDeliveryTemperatureC =
        runtimeComponent.parameters.minimumDeliveryTemperatureC;
      const usefulTemperature =
        flow.deliveryTemperatureC >= minimumDeliveryTemperatureC;
      const servedHeatFlowkW = usefulTemperature
        ? Math.min(flow.heatFlowkW, demand)
        : 0;
      const unmetHeatFlowkW = demand - servedHeatFlowkW;
      const diagnostics = [];

      if (flow.heatFlowkW > demand) {
        diagnostics.push({
          code: "thermal.heat-demand.excess-heat",
          message: `Received ${flow.heatFlowkW} kW for a ${demand} kW heat demand`
        });
      }
      if (unmetHeatFlowkW > 0) {
        diagnostics.push({
          severity: "warning",
          code: "thermal.heat-demand.unmet-heat",
          message: `${unmetHeatFlowkW} kW of heat demand is unmet`
        });
      }

      return {
        portFlows: { "heat-in": flow },
        outputs: {
          demandHeatFlowkW: demand,
          servedHeatFlowkW,
          unmetHeatFlowkW,
          deliveryTemperatureC: flow.deliveryTemperatureC,
          deliveryTemperatureMarginK:
            flow.deliveryTemperatureC - minimumDeliveryTemperatureC
        },
        nextState: {},
        diagnostics
      };
    }
  }
};
