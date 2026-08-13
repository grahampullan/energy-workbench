import assert from "node:assert/strict";
import test from "node:test";

import { nextChartStepIndex } from "../../src/ui/results-chart.js";

function next(key, stepIndex = 100) {
  return nextChartStepIndex({
    key,
    stepIndex,
    stepCount: 1440,
    timeStepSeconds: 60
  });
}

test("chart keyboard navigation supports precise and hour-sized timestep changes", () => {
  assert.equal(next("ArrowLeft"), 99);
  assert.equal(next("ArrowRight"), 101);
  assert.equal(next("PageDown"), 40);
  assert.equal(next("PageUp"), 160);
  assert.equal(next("Home"), 0);
  assert.equal(next("End"), 1439);
  assert.equal(next("Escape"), null);
});

test("chart keyboard navigation clamps at the run boundaries", () => {
  assert.equal(next("ArrowLeft", 0), 0);
  assert.equal(next("PageDown", 10), 0);
  assert.equal(next("ArrowRight", 1439), 1439);
  assert.equal(next("PageUp", 1400), 1439);
});
