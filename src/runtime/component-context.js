import { cloneJsonValue, freezeJsonValue } from "../core/json-value.js";

function seriesIds(component, definition) {
  return new Set((definition.seriesParameters ?? [])
    .map((parameter) => component.parameters[parameter]));
}

export function componentScenario(component, definition, scenario) {
  const allowedIds = seriesIds(component, definition);
  return freezeJsonValue(cloneJsonValue({
    time: scenario.time,
    series: scenario.series.filter(({ id }) => allowedIds.has(id))
  }));
}

export function componentStepContext(stepContext, component) {
  const allowedIds = seriesIds(component, component.definition);
  return Object.freeze({
    stepIndex: stepContext.stepIndex,
    timeStepSeconds: stepContext.timeStepSeconds,
    durationHours: stepContext.durationHours,
    elapsedSeconds: stepContext.elapsedSeconds,
    seriesValues: Object.freeze(Object.fromEntries(
      Object.entries(stepContext.seriesValues ?? {}).filter(([id]) => allowedIds.has(id))
    )),
    state: stepContext.states[component.id]
  });
}
