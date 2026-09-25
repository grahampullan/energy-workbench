export function materialDischarge(componentResult) {
  const requestedKgPerSecond = componentResult.requestedCommand?.massOutflowKgPerSecond;
  if (requestedKgPerSecond === undefined) {
    return null;
  }
  const actualKgPerSecond = componentResult.outputs.massOutflowKgPerSecond;
  if (
    !Number.isFinite(requestedKgPerSecond) || requestedKgPerSecond < 0 ||
    !Number.isFinite(actualKgPerSecond) || actualKgPerSecond < 0 ||
    actualKgPerSecond > requestedKgPerSecond + 1e-9
  ) {
    throw new TypeError("Material discharge requires valid requested and actual mass-flow rates");
  }
  return {
    requestedKgPerSecond,
    actualKgPerSecond,
    unmetKgPerSecond: Math.max(0, requestedKgPerSecond - actualKgPerSecond)
  };
}
