import assert from "node:assert/strict";
import test from "node:test";

import {
  createLadleCyclePolicy,
  LADLE_PROCESS_MODES
} from "../../src/policies/ladle-cycle.js";

function runtimeModel({ modes = [1, 1, 2, 4] } = {}) {
  return {
    time: { timeStepSeconds: 3600, stepCount: modes.length },
    components: [
      { id: "burner", type: "thermal.fuel-burner" },
      { id: "refractory", type: "thermal.store" },
      { id: "metal", type: "thermal.store" }
    ],
    series: [
      {
        id: "process-mode",
        unit: "mode-code",
        data: { kind: "inline", values: modes }
      },
      {
        id: "historical-burner-output",
        unit: "kW",
        data: { kind: "inline", values: [300, 300, 0, 0] }
      },
      {
        id: "material-outflow",
        unit: "kg/s",
        data: { kind: "inline", values: [0, 0, 0, 1] }
      }
    ]
  };
}

function policy(strategy) {
  return createLadleCyclePolicy({
    burnerComponentId: "burner",
    refractoryComponentId: "refractory",
    inventoryComponentId: "metal",
    modeSeriesId: "process-mode",
    historicalHeatOutputSeriesId: "historical-burner-output",
    outflowSeriesId: "material-outflow",
    strategy,
    operatingMarginK: 10
  });
}

function context(stepIndex, seriesValues) {
  return {
    stepIndex,
    seriesValues
  };
}

const policyContext = {
  operatingLimitsByComponentId: {
    burner: { maximumHeatOutputkW: 500 },
    refractory: {
      temperatureC: 200,
      thermalCapacitykWhPerK: 2,
      minimumUsefulTemperatureC: 600,
      maximumTemperatureC: 1200
    }
  }
};

test("historical ladle policy follows the prescribed preheat and tap schedule", () => {
  const operation = policy("historical").request(
    runtimeModel(),
    context(0, {
      "process-mode": LADLE_PROCESS_MODES.preheat,
      "historical-burner-output": 300,
      "material-outflow": 0
    }),
    policyContext
  );

  assert.deepEqual(operation, {
    targets: {
      burner: { heatOutputkW: 300 },
      metal: { massOutflowKgPerSecond: 0 }
    },
    balancingComponentId: null
  });
});

test("minimum-fuel policy targets the refractory requirement over remaining preheat", () => {
  const operation = policy("minimum-fuel").request(
    runtimeModel(),
    context(0, {
      "process-mode": LADLE_PROCESS_MODES.preheat,
      "historical-burner-output": 300,
      "material-outflow": 0
    }),
    policyContext
  );

  assert.equal(operation.targets.burner.heatOutputkW, 410);
  assert.equal(operation.balancingComponentId, null);
});

test("ladle policy rejects material outflow outside tap mode", () => {
  assert.throws(() => policy("historical").request(
    runtimeModel(),
    context(2, {
      "process-mode": LADLE_PROCESS_MODES.setup,
      "historical-burner-output": 0,
      "material-outflow": 1
    }),
    policyContext
  ), /only permitted in tap mode/u);
});
