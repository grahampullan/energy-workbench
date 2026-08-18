import assert from "node:assert/strict";
import test from "node:test";

import {
  createMaterialFlow,
  materialEnthalpyFlowkW,
  materialFlowValidationMessage
} from "../../src/core/material-flow.js";

test("material flow carries mass rate and specific enthalpy", () => {
  const flow = createMaterialFlow({
    massFlowKgPerSecond: 2,
    specificEnthalpyKjPerKg: 125
  });

  assert.deepEqual(flow, {
    massFlowKgPerSecond: 2,
    specificEnthalpyKjPerKg: 125
  });
  assert.equal(materialEnthalpyFlowkW(flow), 250);
  assert.equal(Object.isFrozen(flow), true);
});

test("material flow rejects invalid mass and enthalpy fields", () => {
  assert.match(materialFlowValidationMessage({
    massFlowKgPerSecond: -1,
    specificEnthalpyKjPerKg: 100
  }), /non-negative/u);
  assert.match(materialFlowValidationMessage({
    massFlowKgPerSecond: 1,
    specificEnthalpyKjPerKg: Number.NaN
  }), /specificEnthalpy/u);
  assert.match(materialFlowValidationMessage({
    massFlowKgPerSecond: 1,
    temperatureC: 100
  }), /exactly/u);
});
