import assert from "node:assert/strict";
import test from "node:test";
import { policyDefinitions } from "../../src/policies/definitions.js";
const scheduled = policyDefinitions.find(({ type }) => type === "electrical.follow-schedule");
test("power schedules request the configured direction", () => {
  assert.deepEqual(scheduled.request({ power: 10 }, { direction: -1 }), { powerkW: -10 });
  assert.deepEqual(scheduled.request({ power: 10 }, { direction: 1 }), { powerkW: 10 });
});
test("power schedules reject negative and non-finite power", () => {
  for (const power of [-1, Infinity, NaN]) assert.throws(() => scheduled.request({ power }, { direction: -1 }), /non-negative/u);
});
