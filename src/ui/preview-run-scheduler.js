import {
  defaultCancelFrame,
  defaultRequestFrame
} from "./animation-frame.js";

function noOperation() {}

export function createPreviewRunScheduler({
  run,
  onResult = noOperation,
  onError = noOperation,
  onStateChange = noOperation,
  onCallbackError = noOperation,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame
} = {}) {
  if (typeof run !== "function") {
    throw new TypeError("Preview scheduler requires a run function");
  }
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("Preview scheduler requires frame request and cancellation functions");
  }

  let disposed = false;
  let running = false;
  let pending = null;
  let frameScheduled = false;
  let frameHandle = null;
  let latestRequestId = 0;
  let idleWaiters = [];

  function safelyCall(callback, ...argumentsList) {
    try {
      callback(...argumentsList);
    } catch (error) {
      try {
        onCallbackError(error);
      } catch {
        // A presentation callback cannot corrupt scheduler state.
      }
    }
  }

  function isIdle() {
    return !running && pending === null && !frameScheduled;
  }

  function notifyState() {
    safelyCall(onStateChange, Object.freeze({
      running,
      pending: pending !== null,
      latestRequestId
    }));
    if (isIdle()) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  function clearScheduledStart() {
    if (!frameScheduled) {
      return;
    }
    cancelFrame(frameHandle);
    frameScheduled = false;
    frameHandle = null;
  }

  function scheduleStart() {
    if (disposed || running || pending === null || frameScheduled) {
      return;
    }
    frameScheduled = true;
    frameHandle = requestFrame(() => {
      frameScheduled = false;
      frameHandle = null;
      void startPendingRun();
    });
  }

  async function startPendingRun() {
    if (disposed || running || pending === null) {
      notifyState();
      return;
    }

    const current = pending;
    pending = null;
    running = true;
    notifyState();

    try {
      const result = await Promise.resolve().then(() => run(current.request));
      if (!disposed && current.id === latestRequestId) {
        safelyCall(onResult, result, current.request, current.id);
      }
    } catch (error) {
      if (!disposed && current.id === latestRequestId) {
        safelyCall(onError, error, current.request, current.id);
      }
    } finally {
      running = false;
      if (!disposed && pending !== null) {
        scheduleStart();
      }
      notifyState();
    }
  }

  function request(requestData) {
    if (disposed) {
      throw new Error("Preview scheduler has been disposed");
    }
    latestRequestId += 1;
    pending = { id: latestRequestId, request: requestData };
    if (!running) {
      scheduleStart();
    }
    notifyState();
    return latestRequestId;
  }

  function invalidate() {
    if (disposed) {
      return;
    }
    latestRequestId += 1;
    pending = null;
    clearScheduledStart();
    notifyState();
  }

  function whenIdle() {
    return isIdle()
      ? Promise.resolve()
      : new Promise((resolve) => idleWaiters.push(resolve));
  }

  function dispose() {
    if (disposed) {
      return;
    }
    invalidate();
    disposed = true;
  }

  return Object.freeze({ request, invalidate, whenIdle, dispose });
}
