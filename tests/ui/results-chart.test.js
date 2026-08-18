import assert from "node:assert/strict";
import test from "node:test";

import {
  chartStepIndexAtElapsedSeconds,
  nextChartStepIndex
} from "../../src/ui/results-chart.js";

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

test("rate intervals and end-of-step states select the intended timestep", () => {
  const selected = (mode, elapsedSeconds) => chartStepIndexAtElapsedSeconds({
    mode,
    elapsedSeconds,
    startElapsedSeconds: 0,
    stepCount: 4,
    timeStepSeconds: 60
  });

  assert.equal(selected("power", 0), 0);
  assert.equal(selected("power", 59.999), 0);
  assert.equal(selected("mass", 60), 1);
  assert.equal(selected("power", 240), 3);
  assert.equal(selected("temperature", 0), 0);
  assert.equal(selected("temperature", 60), 0);
  assert.equal(selected("temperature", 60.001), 1);
  assert.equal(selected("temperature", 120), 1);
});
