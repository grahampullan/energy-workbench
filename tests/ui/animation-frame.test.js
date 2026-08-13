import assert from "node:assert/strict";
import test from "node:test";

import { createFrameRenderer } from "../../src/ui/animation-frame.js";

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
    run(timestamp = 16) {
      const current = [...callbacks.values()];
      callbacks.clear();
      current.forEach((callback) => callback(timestamp));
    },
    get size() {
      return callbacks.size;
    }
  };
}

test("frame renderer renders only the latest value requested within a frame", () => {
  const frames = createFakeFrames();
  const rendered = [];
  const renderer = createFrameRenderer({
    render(value, timestamp) {
      rendered.push({ value, timestamp });
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  renderer.request("first");
  renderer.request("second");
  renderer.request("latest");

  assert.equal(frames.size, 1);
  assert.equal(renderer.pending, true);
  frames.run(24);
  assert.deepEqual(rendered, [{ value: "latest", timestamp: 24 }]);
  assert.equal(renderer.pending, false);
});

test("a request made while rendering is retained for the next frame", () => {
  const frames = createFakeFrames();
  const rendered = [];
  let renderer;
  renderer = createFrameRenderer({
    render(value) {
      rendered.push(value);
      if (value === 1) {
        renderer.request(2);
      }
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  renderer.request(1);
  frames.run();
  assert.deepEqual(rendered, [1]);
  assert.equal(frames.size, 1);
  frames.run();
  assert.deepEqual(rendered, [1, 2]);
});

test("flushing renders immediately and disposal cancels pending work", () => {
  const frames = createFakeFrames();
  const rendered = [];
  const renderer = createFrameRenderer({
    render(value) {
      rendered.push(value);
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame
  });

  renderer.request("now");
  renderer.flush();
  assert.deepEqual(rendered, ["now"]);
  assert.equal(frames.size, 0);

  renderer.request("never");
  renderer.dispose();
  frames.run();
  assert.deepEqual(rendered, ["now"]);
  assert.throws(() => renderer.request("late"), /disposed/u);
});
