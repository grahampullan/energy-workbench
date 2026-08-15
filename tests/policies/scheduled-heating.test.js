import assert from "node:assert/strict";
import test from "node:test";

import { createScheduledHeatingPolicy } from
  "../../src/policies/scheduled-heating.js";

function runtimeModel({ seriesUnit = "kW", componentType = "thermal.electric-heater" } = {}) {
  return {
    components: [{ id: "heater", type: componentType }],
    series: [{ id: "heater-input-power", unit: seriesUnit }]
  };
}

function policy() {
  return createScheduledHeatingPolicy({
    heaterComponentId: "heater",
    powerSeriesId: "heater-input-power",
    balancingComponentId: "grid"
  });
}

test("scheduled-heating policy turns positive input power into a heater target", () => {
  assert.deepEqual(policy().request(runtimeModel(), {
    seriesValues: { "heater-input-power": 42 }
  }), {
    targets: { heater: { powerkW: -42 } },
    balancingComponentId: "grid"
  });
});

test("scheduled-heating policy validates configuration and runtime inputs", () => {
  assert.throws(
    () => createScheduledHeatingPolicy(),
    /heaterComponentId must be a non-empty string/u
  );
  assert.throws(
    () => createScheduledHeatingPolicy({
      heaterComponentId: "heater",
      powerSeriesId: "heater-input-power"
    }),
    /balancingComponentId must be a non-empty string/u
  );
  assert.throws(
    () => policy().request(runtimeModel({ seriesUnit: "MW" }), {
      seriesValues: { "heater-input-power": 0.05 }
    }),
    /must use kW/u
  );
  assert.throws(
    () => policy().request(runtimeModel({ componentType: "electrical.load" }), {
      seriesValues: { "heater-input-power": 10 }
    }),
    /must use thermal\.electric-heater/u
  );
  assert.throws(
    () => policy().request(runtimeModel(), {
      seriesValues: { "heater-input-power": -1 }
    }),
    /finite, non-negative/u
  );
});
