import assert from "node:assert/strict";
import test from "node:test";

import { integrateStepPowerkWh } from
  "../../src/core/energy-integration.js";

test("step power uses explicit-forward rectangular integration", () => {
  assert.equal(integrateStepPowerkWh([0, 2, 2], 3600), 4);
  assert.equal(integrateStepPowerkWh([50], 900), 12.5);
});

test("step-power integration validates its engineering inputs", () => {
  assert.throws(
    () => integrateStepPowerkWh([0, Number.NaN], 60),
    /finite/u
  );
  assert.throws(() => integrateStepPowerkWh([0, 1], 0), /positive/u);
});
