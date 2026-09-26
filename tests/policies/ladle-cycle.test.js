import assert from "node:assert/strict";
import test from "node:test";
import { policyDefinitions } from "../../src/policies/definitions.js";
const get = (type) => policyDefinitions.find((p) => p.type === type);
test("scheduled heat and discharge request the connected rate, with zero switching operation off", () => {
  assert.deepEqual(get("thermal.follow-schedule").request({ request: 400 }), { heatOutputkW: 400 });
  assert.deepEqual(get("material.follow-schedule").request({ request: 9.5 }), { massOutflowKgPerSecond: 9.5 });
  for (const [type, field] of [["thermal.follow-schedule", "heatOutputkW"], ["material.follow-schedule", "massOutflowKgPerSecond"]]) {
    const rule = get(type);
    assert.deepEqual(rule.request({ request: 0 }), { [field]: 0 });
    for (const request of [-1, Infinity, NaN, undefined]) {
      assert.throws(() => rule.request({ request }), /finite and non-negative/u);
    }
  }
});
test("temperature rule uses connected capacity, target limits and time remaining", () => {
  const rule = get("thermal.reach-temperature");
  const inputs = { temperature: 400, capacity: 0.5, required: 800, maximum: 900, "power-limit": 480, remaining: 0.5 };
  assert.deepEqual(rule.request(inputs, { margin: 10 }), { heatOutputkW: 410 });
  assert.deepEqual(rule.request({ ...inputs, remaining: 0.1 }, { margin: 10 }), { heatOutputkW: 480 });
  assert.deepEqual(rule.request({ ...inputs, temperature: 820 }, { margin: 10 }), { heatOutputkW: 0 });
  assert.deepEqual(rule.request({ ...inputs, remaining: 0 }, { margin: 10 }), { heatOutputkW: 0 });
  assert.throws(() => rule.request({ ...inputs, remaining: -1 }, { margin: 10 }), /non-negative/u);
});
