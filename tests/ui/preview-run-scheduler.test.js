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

function createFakeFrames() {
  let nextHandle = 1;
  const callbacks = new Map();
  return {
    requestFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      callbacks.delete(handle);
    },
    run() {
      const current = [...callbacks.values()];
      callbacks.clear();
      current.forEach((callback) => callback(16));
    },
    get size() {
      return callbacks.size;
    }
  };
}

test("preview scheduler coalesces rapid requests into one frame", async () => {
  const frames = createFakeFrames();
  const runs = [];
  const published = [];
  const scheduler = createPreviewRunScheduler({
    run(request) {
      runs.push(request);
      return request * 10;
    },
    onResult(result) {
      published.push(result);
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request(1);
  scheduler.request(2);
  scheduler.request(3);
  assert.equal(frames.size, 1);
  assert.deepEqual(runs, []);
  frames.run();
  await scheduler.whenIdle();

  assert.deepEqual(runs, [3]);
  assert.deepEqual(published, [30]);
  scheduler.dispose();
});

test("preview scheduler retains only the latest request made during a run", async () => {
  const frames = createFakeFrames();
  const firstRun = deferred();
  const firstStarted = deferred();
  const runs = [];
  const published = [];
  let latestState = null;
  const scheduler = createPreviewRunScheduler({
    run(request) {
      runs.push(request);
      if (request === 1) {
        firstStarted.resolve();
        return firstRun.promise;
      }
      return request * 10;
    },
    onResult(result) {
      published.push(result);
    },
    onStateChange(state) {
      latestState = state;
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request(1);
  assert.equal(latestState.running, false);
  assert.equal(latestState.pending, true);
  frames.run();
  await firstStarted.promise;
  scheduler.request(2);
  scheduler.request(3);
  assert.equal(latestState.running, true);
  assert.equal(latestState.pending, true);
  assert.deepEqual(runs, [1]);
  firstRun.resolve(10);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(frames.size, 1);
  frames.run();
  await scheduler.whenIdle();

  assert.deepEqual(runs, [1, 3]);
  assert.deepEqual(published, [30]);
  scheduler.dispose();
});

test("preview scheduler suppresses stale results and runs the latest pending request", async () => {
  const frames = createFakeFrames();
  const firstRun = deferred();
  const secondRun = deferred();
  const started = deferred();
  const published = [];
  let runCount = 0;
  const scheduler = createPreviewRunScheduler({
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
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request("stale");
  frames.run();
  await started.promise;
  scheduler.request("latest");
  firstRun.resolve("old result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  frames.run();
  secondRun.resolve("new result");
  await scheduler.whenIdle();

  assert.equal(runCount, 2);
  assert.deepEqual(published, ["new result"]);
  scheduler.dispose();
});

test("invalidating a preview prevents an in-flight result from publishing", async () => {
  const frames = createFakeFrames();
  const currentRun = deferred();
  const started = deferred();
  const published = [];
  const scheduler = createPreviewRunScheduler({
    run() {
      started.resolve();
      return currentRun.promise;
    },
    onResult(result) {
      published.push(result);
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request("preview");
  frames.run();
  await started.promise;
  scheduler.invalidate();
  currentRun.resolve("stale result");
  await scheduler.whenIdle();

  assert.deepEqual(published, []);
  scheduler.dispose();
});

test("invalidating a preview cancels a run waiting for the next frame", async () => {
  const frames = createFakeFrames();
  const runs = [];
  const scheduler = createPreviewRunScheduler({
    run(request) {
      runs.push(request);
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request("cancelled");
  assert.equal(frames.size, 1);
  scheduler.invalidate();
  assert.equal(frames.size, 0);
  frames.run();
  await scheduler.whenIdle();

  assert.deepEqual(runs, []);
  scheduler.dispose();
});

test("a failing presentation callback does not corrupt scheduler progress", async () => {
  const frames = createFakeFrames();
  const callbackErrors = [];
  const published = [];
  const scheduler = createPreviewRunScheduler({
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
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  scheduler.request("completed");
  frames.run();
  await scheduler.whenIdle();

  assert.deepEqual(published, ["completed"]);
  assert.ok(callbackErrors.includes("broken view"));
  scheduler.dispose();
});
