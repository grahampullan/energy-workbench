import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewRunScheduler } from
  "../../src/ui/preview-run-scheduler.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("preview scheduler coalesces rapid requests to the latest value", async () => {
  const runs = [];
  const published = [];
  const scheduler = createPreviewRunScheduler({
    delayMs: 1,
    run(request) {
      runs.push(request);
      return request * 10;
    },
    onResult(result) {
      published.push(result);
    }
  });

  scheduler.request(1);
  scheduler.request(2);
  scheduler.request(3);
  await scheduler.whenIdle();

  assert.deepEqual(runs, [3]);
  assert.deepEqual(published, [30]);
  scheduler.dispose();
});

test("preview scheduler suppresses stale results and runs the latest pending request", async () => {
  const firstRun = deferred();
  const secondRun = deferred();
  const started = deferred();
  const published = [];
  let runCount = 0;
  const scheduler = createPreviewRunScheduler({
    delayMs: 0,
    run(request) {
      runCount += 1;
      if (runCount === 1) {
        started.resolve();
        return firstRun.promise;
      }
      assert.equal(request, "latest");
      return secondRun.promise;
    },
    onResult(result) {
      published.push(result);
    }
  });

  scheduler.request("stale");
  await started.promise;
  scheduler.request("latest");
  firstRun.resolve("old result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  secondRun.resolve("new result");
  await scheduler.whenIdle();

  assert.equal(runCount, 2);
  assert.deepEqual(published, ["new result"]);
  scheduler.dispose();
});

test("invalidating a preview prevents an in-flight result from publishing", async () => {
  const currentRun = deferred();
  const started = deferred();
  const published = [];
  const scheduler = createPreviewRunScheduler({
    delayMs: 0,
    run() {
      started.resolve();
      return currentRun.promise;
    },
    onResult(result) {
      published.push(result);
    }
  });

  scheduler.request("preview");
  await started.promise;
  scheduler.invalidate();
  currentRun.resolve("stale result");
  await scheduler.whenIdle();

  assert.deepEqual(published, []);
  scheduler.dispose();
});

test("a failing presentation callback does not corrupt scheduler progress", async () => {
  const callbackErrors = [];
  const published = [];
  const scheduler = createPreviewRunScheduler({
    delayMs: 0,
    run(request) {
      return request;
    },
    onStateChange() {
      throw new Error("broken view");
    },
    onCallbackError(error) {
      callbackErrors.push(error.message);
    },
    onResult(result) {
      published.push(result);
    }
  });

  scheduler.request("completed");
  await scheduler.whenIdle();

  assert.deepEqual(published, ["completed"]);
  assert.ok(callbackErrors.includes("broken view"));
  scheduler.dispose();
});
