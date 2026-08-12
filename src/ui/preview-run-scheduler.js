function noOperation() {}

export function createPreviewRunScheduler({
  run,
  onResult = noOperation,
  onError = noOperation,
  onStateChange = noOperation,
  onCallbackError = noOperation,
  delayMs = 80
} = {}) {
  if (typeof run !== "function") {
    throw new TypeError("Preview scheduler requires a run function");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError("delayMs must be a finite, non-negative number");
  }

  let disposed = false;
  let running = false;
  let pending = null;
  let timer = null;
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
    return !running && pending === null && timer === null;
  }

  function notifyState() {
    safelyCall(onStateChange, Object.freeze({
      running,
      pending: pending !== null || timer !== null,
      latestRequestId
    }));
    if (isIdle()) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  function clearScheduledRun() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delay) {
    clearScheduledRun();
    timer = setTimeout(startPendingRun, delay);
  }

  async function startPendingRun() {
    timer = null;
    if (disposed || running || pending === null) {
      notifyState();
      return;
    }

    const current = pending;
    pending = null;
    running = true;
    notifyState();

    try {
      const result = await run(current.request);
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
        schedule(0);
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
      schedule(delayMs);
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
    clearScheduledRun();
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
