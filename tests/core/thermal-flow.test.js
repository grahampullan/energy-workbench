import assert from "node:assert/strict";
import test from "node:test";

import {
  createThermalFlow,
  thermalFlowValidationMessage
} from "../../src/core/thermal-flow.js";
import { evaluateRuntimeComponents } from "../../src/runtime/component-execution.js";

test("thermal flows use one exact, immutable boundary contract", () => {
  const flow = createThermalFlow({
    heatFlowkW: 120,
    sourceTemperatureC: 90,
    deliveryTemperatureC: 85
  });

  assert.deepEqual(flow, {
    heatFlowkW: 120,
    sourceTemperatureC: 90,
    deliveryTemperatureC: 85
  });
  assert.equal(Object.isFrozen(flow), true);
  assert.equal(thermalFlowValidationMessage(flow), null);
  assert.throws(
    () => createThermalFlow({ ...flow, massFlowKgPerSecond: 2 }),
    /exactly heatFlowkW/u
  );
});

test("thermal flows reject invalid power and temperatures", () => {
  assert.throws(
    () => createThermalFlow({
      heatFlowkW: -1,
      sourceTemperatureC: 80,
      deliveryTemperatureC: 70
    }),
    /non-negative/u
  );
  assert.throws(
    () => createThermalFlow({
      heatFlowkW: 1,
      sourceTemperatureC: -274,
      deliveryTemperatureC: -274
    }),
    /absolute zero/u
  );
  assert.throws(
    () => createThermalFlow({
      heatFlowkW: 1,
      sourceTemperatureC: 70,
      deliveryTemperatureC: 80
    }),
    /above its source temperature/u
  );

  assert.deepEqual(createThermalFlow({
    heatFlowkW: 0,
    sourceTemperatureC: 20,
    deliveryTemperatureC: 25
  }), {
    heatFlowkW: 0,
    sourceTemperatureC: 20,
    deliveryTemperatureC: 25
  });
});

test("component execution reports malformed thermal port flows", () => {
  const definition = {
    initialState: {},
    outputs: {},
    model: {
      evaluate() {
        return {
          portFlows: {
            heat: {
              heatFlowkW: -10,
              sourceTemperatureC: 80,
              deliveryTemperatureC: 70
            }
          },
          outputs: {},
          nextState: {},
          diagnostics: []
        };
      }
    }
  };
  const runtimeModel = {
    components: [{
      id: "source",
      type: "thermal.test-source",
      definition,
      ports: [{
        id: "heat",
        flowType: "thermal.heat-flow",
        direction: "out"
      }]
    }]
  };
  const diagnostics = [];

  evaluateRuntimeComponents(
    runtimeModel,
    new Map([["source", {}]]),
    {
      stepIndex: 0,
      durationHours: 1,
      seriesValues: {},
      states: { source: {} }
    },
    diagnostics
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["runtime.component-port-flow-contract"]
  );
  assert.match(diagnostics[0].message, /heatFlowkW/u);
});
