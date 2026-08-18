import { createScheduledHeatingPolicy } from "./scheduled-heating.js";

const INVENTORY_TYPE = "process.heated-material-inventory";

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

export function createScheduledMaterialInventoryPolicy({
  heaterComponentId,
  powerSeriesId,
  inventoryComponentId,
  outflowSeriesId,
  balancingComponentId
} = {}) {
  requireNonEmptyString(inventoryComponentId, "inventoryComponentId");
  requireNonEmptyString(outflowSeriesId, "outflowSeriesId");
  const heatingPolicy = createScheduledHeatingPolicy({
    heaterComponentId,
    powerSeriesId,
    balancingComponentId
  });

  return Object.freeze({
    request(runtimeModel, stepContext, policyContext) {
      const inventory = runtimeModel.components.find(
        (component) => component.id === inventoryComponentId
      );
      if (!inventory || inventory.type !== INVENTORY_TYPE) {
        throw new Error(
          `Inventory ${inventoryComponentId} must use ${INVENTORY_TYPE}`
        );
      }
      const series = runtimeModel.series.find(
        (candidate) => candidate.id === outflowSeriesId
      );
      if (!series || series.unit !== "kg/s") {
        throw new Error(
          `Material-outflow series ${outflowSeriesId} must exist and use kg/s`
        );
      }
      const massOutflowKgPerSecond = stepContext.seriesValues[outflowSeriesId];
      if (!Number.isFinite(massOutflowKgPerSecond) || massOutflowKgPerSecond < 0) {
        throw new RangeError(
          "Scheduled material outflow must be finite and non-negative"
        );
      }
      const operation = heatingPolicy.request(
        runtimeModel,
        stepContext,
        policyContext
      );
      return {
        ...operation,
        targets: {
          ...operation.targets,
          [inventoryComponentId]: { massOutflowKgPerSecond }
        }
      };
    }
  });
}
