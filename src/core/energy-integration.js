export function integrateStepPowerkWh(valueskW, timeStepSeconds) {
  if (!Array.isArray(valueskW)) {
    throw new TypeError("Power-series values must be an array");
  }
  if (!Number.isFinite(timeStepSeconds) || timeStepSeconds <= 0) {
    throw new TypeError("timeStepSeconds must be a finite, positive number");
  }
  if (valueskW.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Power-series values must be finite numbers");
  }

  const durationHours = timeStepSeconds / 3600;
  return valueskW.reduce(
    (energykWh, powerkW) => energykWh + powerkW * durationHours,
    0
  );
}
