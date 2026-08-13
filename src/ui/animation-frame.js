function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 0);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

export function createFrameRenderer({
  render,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame
} = {}) {
  if (typeof render !== "function") {
    throw new TypeError("Frame renderer requires a render function");
  }
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("Frame renderer requires frame request and cancellation functions");
  }

  let disposed = false;
  let rendering = false;
  let frameScheduled = false;
  let frameHandle = null;
  let pending = false;
  let latestValue;

  function schedule() {
    if (disposed || rendering || frameScheduled || !pending) {
      return;
    }
    frameScheduled = true;
    frameHandle = requestFrame(renderFrame);
  }

  function renderFrame(timestamp) {
    frameScheduled = false;
    frameHandle = null;
    if (disposed || !pending) {
      return;
    }

    const value = latestValue;
    pending = false;
    rendering = true;
    try {
      render(value, timestamp);
    } finally {
      rendering = false;
      schedule();
    }
  }

  function request(value) {
    if (disposed) {
      throw new Error("Frame renderer has been disposed");
    }
    latestValue = value;
    pending = true;
    schedule();
  }

  function flush(timestamp = 0) {
    if (disposed || !pending) {
      return;
    }
    if (frameScheduled) {
      cancelFrame(frameHandle);
      frameScheduled = false;
      frameHandle = null;
    }
    renderFrame(timestamp);
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    pending = false;
    if (frameScheduled) {
      cancelFrame(frameHandle);
      frameScheduled = false;
      frameHandle = null;
    }
  }

  return Object.freeze({
    request,
    flush,
    dispose,
    get pending() {
      return pending || frameScheduled;
    }
  });
}

export { defaultCancelFrame, defaultRequestFrame };
