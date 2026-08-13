import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_POWER_FLOW_TYPE,
  createFlow,
  flowValidationMessage,
  getFlowType,
  hasFlowType,
  THERMAL_HEAT_FLOW_TYPE
} from "../../src/core/flow-types.js";

test("flow types declare exact field units in one immutable contract", () => {
  assert.equal(hasFlowType(ACTIVE_POWER_FLOW_TYPE), true);
  assert.equal(hasFlowType("material.mass-flow"), false);
  assert.deepEqual(getFlowType(ACTIVE_POWER_FLOW_TYPE), {
    id: ACTIVE_POWER_FLOW_TYPE,
    fields: { powerkW: { unit: "kW" } }
  });
  assert.deepEqual(getFlowType(THERMAL_HEAT_FLOW_TYPE), {
    id: THERMAL_HEAT_FLOW_TYPE,
    fields: {
      heatFlowkW: { unit: "kW" },
      sourceTemperatureC: { unit: "°C" },
      deliveryTemperatureC: { unit: "°C" }
    }
  });
  assert.equal(Object.isFrozen(getFlowType(ACTIVE_POWER_FLOW_TYPE)), true);
  assert.equal(Object.isFrozen(getFlowType(ACTIVE_POWER_FLOW_TYPE).fields), true);
});

test("active power is signed only at bidirectional port boundaries", () => {
  assert.deepEqual(createFlow(
    ACTIVE_POWER_FLOW_TYPE,
    { powerkW: -3 },
    { direction: "bidirectional" }
  ), { powerkW: -3 });
  assert.match(
    flowValidationMessage(
      ACTIVE_POWER_FLOW_TYPE,
      { powerkW: -3 },
      { direction: "in" }
    ),
    /non-negative/u
  );
  assert.match(
    flowValidationMessage(
      ACTIVE_POWER_FLOW_TYPE,
      { powerkW: 3, voltageV: 230 },
      { direction: "out" }
    ),
    /exactly powerkW/u
  );
});

test("unknown flow types fail explicitly", () => {
  assert.equal(getFlowType("material.mass-flow"), undefined);
  assert.match(
    flowValidationMessage("material.mass-flow", { massFlowKgPerSecond: 1 }),
    /Unknown flow type/u
  );
});
