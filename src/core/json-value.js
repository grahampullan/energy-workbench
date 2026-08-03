export class NonJsonValueError extends TypeError {}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneJsonValue(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new NonJsonValueError("JSON numbers must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new NonJsonValueError("JSON values cannot contain cycles");
    }
    ancestors.add(value);
    const clone = value.map((entry) => cloneJsonValue(entry, ancestors));
    ancestors.delete(value);
    return clone;
  }
  if (isRecord(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NonJsonValueError("JSON objects must use a plain object prototype");
    }
    if (ancestors.has(value)) {
      throw new NonJsonValueError("JSON values cannot contain cycles");
    }
    ancestors.add(value);
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry, ancestors)])
    );
    ancestors.delete(value);
    return clone;
  }
  throw new NonJsonValueError(`Unsupported JSON value type: ${typeof value}`);
}

export function freezeJsonValue(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freezeJsonValue(child);
    }
    Object.freeze(value);
  }
  return value;
}
