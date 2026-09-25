import {
  axisBottom,
  axisLeft,
  curveStepAfter,
  line,
  max,
  min,
  pointer,
  scaleBand,
  scaleLinear,
  select
} from "d3";

import { createFrameRenderer } from "./animation-frame.js";
import {
  createEngineeringDisplayScale,
  formatEngineeringValue
} from "./engineering-format.js";

const WIDTH = 1200;
const HEIGHT = 230;
const POWER_MARGIN = { top: 16, right: 24, bottom: 40, left: 62 };
const ENERGY_MARGIN = { top: 16, right: 24, bottom: 78, left: 62 };
const TEMPERATURE_MARGIN = POWER_MARGIN;

function formatChartTime(elapsedSeconds) {
  const wholeMinutes = Math.round(elapsedSeconds / 60);
  const days = Math.floor(wholeMinutes / 1440);
  const minutesWithinDay = wholeMinutes % 1440;
  const hours = Math.floor(minutesWithinDay / 60);
  const minutes = minutesWithinDay % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return days ? `D${days + 1} ${clock}` : clock;
}

function extendRateThroughTimestepEnd(values, endElapsedSeconds) {
  const last = values.at(-1);
  return [...values, { ...last, elapsedSeconds: endElapsedSeconds }];
}

export function chartStepIndexAtElapsedSeconds({
  mode,
  elapsedSeconds,
  startElapsedSeconds,
  stepCount,
  timeStepSeconds
}) {
  if (
    (mode !== "power" && mode !== "mass" && mode !== "temperature") ||
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(startElapsedSeconds) ||
    !Number.isInteger(stepCount) ||
    stepCount < 1 ||
    !Number.isFinite(timeStepSeconds) ||
    timeStepSeconds <= 0
  ) {
    throw new TypeError("Valid chart time and timestep state are required");
  }
  const stepPosition = (elapsedSeconds - startElapsedSeconds) / timeStepSeconds;
  const approximateStep = mode === "temperature"
    ? Math.ceil(stepPosition) - 1
    : Math.floor(stepPosition);
  return Math.max(0, Math.min(stepCount - 1, approximateStep));
}

export function nextChartStepIndex({
  key,
  stepIndex,
  stepCount,
  timeStepSeconds
}) {
  if (
    !Number.isInteger(stepIndex) ||
    !Number.isInteger(stepCount) ||
    stepCount < 1 ||
    stepIndex < 0 ||
    stepIndex >= stepCount ||
    !Number.isFinite(timeStepSeconds) ||
    timeStepSeconds <= 0
  ) {
    throw new TypeError("Valid chart step state is required");
  }

  const pageSize = Math.max(1, Math.round(3600 / timeStepSeconds));
  const offsetByKey = new Map([
    ["ArrowLeft", -1],
    ["ArrowDown", -1],
    ["ArrowRight", 1],
    ["ArrowUp", 1],
    ["PageDown", -pageSize],
    ["PageUp", pageSize]
  ]);
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return stepCount - 1;
  }
  if (!offsetByKey.has(key)) {
    return null;
  }
  return Math.max(0, Math.min(stepCount - 1, stepIndex + offsetByKey.get(key)));
}

export function resultsSeriesIsEmphasised(
  series,
  selectedComponentId,
  highlightedConnectionId,
  highlightedSeriesId
) {
  if (highlightedSeriesId !== null) {
    return series.id === highlightedSeriesId;
  }
  if (highlightedConnectionId !== null) {
    return series.connectionId === highlightedConnectionId;
  }
  if (series.connectionId === null) {
    return true;
  }
  return selectedComponentId === null || series.componentIds.includes(selectedComponentId);
}

export function resultsHoverHighlight(series) {
  const connectionId = series?.connectionId ?? null;
  return Object.freeze({
    connectionId,
    seriesId: connectionId === null ? series?.id ?? null : null
  });
}

export function resultsFlowSeries(model, highlightedConnectionId = null) {
  const revealed = model.hiddenSeries.filter(
    (series) => series.connectionId === highlightedConnectionId
  );
  return revealed.length === 0 ? model.series : [...model.series, ...revealed];
}

function makeLegendButton(series, colour, onHighlightSeries) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "results-legend-item";
  button.dataset.seriesId = series.id;
  button.dataset.kind = series.kind;

  const swatch = document.createElement("span");
  swatch.className = "results-legend-swatch";
  swatch.style.backgroundColor = colour;
  swatch.style.color = colour;
  swatch.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "results-legend-label";
  label.textContent = series.label;
  const value = document.createElement("strong");
  value.className = "results-legend-value";
  button.append(swatch, label, value);

  button.addEventListener("pointerenter", () => onHighlightSeries(series));
  button.addEventListener("pointerleave", () => onHighlightSeries(null));
  button.addEventListener("focus", () => onHighlightSeries(series));
  button.addEventListener("blur", () => onHighlightSeries(null));
  return { button, value };
}

export function createResultsChart({
  target,
  legendTarget,
  powerButton,
  energyButton,
  massButton,
  temperatureButton,
  scenarioInputsToggle,
  onStepChange,
  onHighlightConnection
}) {
  if (
    !target ||
    !legendTarget ||
    !powerButton ||
    !energyButton ||
    !massButton ||
    !temperatureButton ||
    !scenarioInputsToggle
  ) {
    throw new TypeError("Results chart targets are required");
  }
  if (typeof onStepChange !== "function" || typeof onHighlightConnection !== "function") {
    throw new TypeError("Results chart interaction callbacks are required");
  }

  const svg = select(target)
    .append("svg")
    .attr("class", "results-chart-svg")
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const gridLayer = svg.append("g").attr("class", "results-chart-grid");
  const xAxisLayer = svg.append("g").attr("class", "results-chart-axis");
  const yAxisLayer = svg.append("g").attr("class", "results-chart-axis");
  const yLabel = svg
    .append("text")
    .attr("class", "results-chart-axis-label")
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .attr("x", -HEIGHT / 2)
    .attr("y", 17);
  const lineLayer = svg.append("g").attr("class", "results-chart-lines");
  const barLayer = svg.append("g").attr("class", "results-chart-bars");
  const interactionLayer = svg.append("g").attr("class", "results-chart-interactions");
  const pointerSurface = interactionLayer
    .append("rect")
    .attr("class", "results-chart-pointer-surface")
    .attr("fill", "transparent");
  const cursorLayer = svg
    .append("g")
    .attr("class", "results-chart-cursor")
    .attr("pointer-events", "none");
  const cursorLine = cursorLayer.append("line");
  const cursorPoints = cursorLayer.append("g");

  let mode = "power";
  let showScenarioInputs = false;
  let state = null;
  let renderedModel = null;
  let renderedMode = null;
  let renderedScenarioInputs = null;
  let renderedHiddenConnectionId = null;
  let xScale = null;
  let yScale = null;
  let legendBySeriesId = new Map();
  let highlightedSeriesId = null;

  function scenarioInputSeries(model) {
    if (mode === "mass") {
      return model.prescribedMassSeries;
    }
    if (mode === "temperature") {
      return model.prescribedTemperatureSeries;
    }
    return mode === "power" ? model.prescribedPowerSeries : [];
  }

  function visibleSeries(model) {
    const calculated = mode === "mass"
      ? model.materialSeries
      : mode === "temperature"
        ? model.temperatureSeries
        : resultsFlowSeries(model, state.highlightedConnectionId);
    return showScenarioInputs
      ? [...calculated, ...scenarioInputSeries(model)]
      : calculated;
  }

  function setSeriesHighlight(series) {
    const highlight = resultsHoverHighlight(series);
    highlightedSeriesId = highlight.seriesId;
    onHighlightConnection(highlight.connectionId);
    if (state) {
      frameRenderer.request();
    }
  }

  function rebuildLegend(model) {
    const series = visibleSeries(model);
    legendTarget.replaceChildren();
    legendBySeriesId = new Map(series.map((candidate) => {
      const entry = makeLegendButton(
        candidate,
        candidate.colour,
        setSeriesHighlight
      );
      legendTarget.append(entry.button);
      return [candidate.id, entry];
    }));
  }

  function stepFromPointer(event) {
    const [pointerX] = pointer(event, svg.node());
    return chartStepIndexAtElapsedSeconds({
      mode,
      elapsedSeconds: xScale.invert(pointerX),
      startElapsedSeconds: state.model.elapsedSeconds[0],
      stepCount: state.model.stepCount,
      timeStepSeconds: state.model.timeStepSeconds
    });
  }

  function updateStepFromPointer(event) {
    if (mode === "energy") {
      return;
    }
    const nextStepIndex = stepFromPointer(event);
    if (nextStepIndex !== state.stepIndex) {
      onStepChange(nextStepIndex);
    }
  }

  function addSeriesPointerHandlers(selection) {
    selection
      .on("pointerenter", (event, series) => {
        setSeriesHighlight(series);
        updateStepFromPointer(event);
      })
      .on("pointermove", updateStepFromPointer)
      .on("pointerleave", () => setSeriesHighlight(null));
  }

  function renderPower(model) {
    const margin = POWER_MARGIN;
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const series = visibleSeries(model);
    const valueField = mode === "mass"
      ? "massFlowKgPerSecond"
      : "powerkW";
    const maximumPowerkW = max(series, (candidate) =>
      max(candidate.values, (point) => point[valueField])
    ) ?? 0;
    const displayScale = createEngineeringDisplayScale(
      maximumPowerkW,
      mode === "mass" ? "kg/s" : "kW"
    );
    const firstElapsedSeconds = model.elapsedSeconds[0];
    xScale = scaleLinear()
      .domain([firstElapsedSeconds, model.endElapsedSeconds])
      .range([margin.left, WIDTH - margin.right]);
    yScale = scaleLinear()
      .domain([0, maximumPowerkW || 1])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const powerLine = line()
      .x((point) => xScale(point.elapsedSeconds))
      .y((point) => yScale(point[valueField]))
      .curve(curveStepAfter);
    const pathFor = (candidate) => powerLine(extendRateThroughTimestepEnd(
      candidate.values,
      model.endElapsedSeconds
    ));

    xAxisLayer
      .attr("transform", `translate(0 ${HEIGHT - margin.bottom})`)
      .call(axisBottom(xScale).ticks(8).tickFormat(formatChartTime));
    xAxisLayer
      .selectAll("text")
      .attr("text-anchor", "middle")
      .attr("transform", null)
      .attr("dx", null)
      .attr("dy", "0.71em");
    yAxisLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickFormat((value) =>
        displayScale.format(value)
      ));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text(mode === "mass"
      ? `Mass flow (${displayScale.unit})`
      : `Power (${displayScale.unit})`);

    barLayer.selectAll("rect.results-energy-bar").remove();
    lineLayer.selectAll("path.results-temperature-line").remove();
    lineLayer.selectAll("line.results-temperature-threshold").remove();
    lineLayer.selectAll("text.results-temperature-threshold-label").remove();
    interactionLayer.selectAll("path.results-temperature-hit").remove();
    lineLayer
      .selectAll("path.results-power-line")
      .data(series, (candidate) => candidate.id)
      .join("path")
      .attr("class", "results-power-line")
      .attr("data-series-id", (candidate) => candidate.id)
      .attr("data-kind", (candidate) => candidate.kind)
      .attr("fill", "none")
      .attr("stroke", (candidate) => candidate.colour)
      .attr("d", pathFor);

    const hitLines = interactionLayer
      .selectAll("path.results-power-hit")
      .data(series, (candidate) => candidate.id)
      .join("path")
      .attr("class", "results-power-hit")
      .attr("data-series-id", (candidate) => candidate.id)
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("d", pathFor);
    addSeriesPointerHandlers(hitLines);

    pointerSurface
      .attr("display", null)
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", plotWidth)
      .attr("height", plotHeight)
      .on("pointermove", updateStepFromPointer);
    cursorLayer.attr("display", null);
  }

  function renderEnergy(model) {
    const margin = ENERGY_MARGIN;
    const plotWidth = WIDTH - margin.left - margin.right;
    const series = visibleSeries(model);
    const x = scaleBand()
      .domain(series.map((series) => series.id))
      .range([margin.left, WIDTH - margin.right])
      .padding(0.22);
    const maximumEnergykWh = max(
      series,
      (series) => series.integratedEnergykWh
    ) ?? 0;
    const displayScale = createEngineeringDisplayScale(
      maximumEnergykWh,
      "kWh"
    );
    const y = scaleLinear()
      .domain([0, maximumEnergykWh || 1])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const labelsBySeriesId = new Map(series.map((series) => [
      series.id,
      series.label
    ]));

    xAxisLayer
      .attr("transform", `translate(0 ${HEIGHT - margin.bottom})`)
      .call(axisBottom(x).tickFormat((seriesId) => labelsBySeriesId.get(seriesId)));
    xAxisLayer
      .selectAll("text")
      .attr("text-anchor", "end")
      .attr("transform", "rotate(-26)")
      .attr("dx", "-0.55em")
      .attr("dy", "0.15em");
    yAxisLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(y).ticks(6).tickFormat((value) =>
        displayScale.format(value)
      ));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(y).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text(`Energy (${displayScale.unit})`);

    lineLayer.selectAll("path.results-power-line").remove();
    lineLayer.selectAll("path.results-temperature-line").remove();
    lineLayer.selectAll("line.results-temperature-threshold").remove();
    lineLayer.selectAll("text.results-temperature-threshold-label").remove();
    interactionLayer.selectAll("path.results-power-hit").remove();
    interactionLayer.selectAll("path.results-temperature-hit").remove();
    pointerSurface.attr("display", "none").on("pointermove", null);
    cursorLayer.attr("display", "none");

    const bars = barLayer
      .selectAll("rect.results-energy-bar")
      .data(series, (series) => series.id)
      .join("rect")
      .attr("class", "results-energy-bar")
      .attr("data-series-id", (series) => series.id)
      .attr("x", (series) => x(series.id))
      .attr("y", (series) => y(series.integratedEnergykWh))
      .attr("width", x.bandwidth())
      .attr("height", (series) => y(0) - y(series.integratedEnergykWh))
      .attr("fill", (series) => series.colour);
    bars
      .on("pointerenter", (event, series) => setSeriesHighlight(series))
      .on("pointerleave", () => setSeriesHighlight(null));
  }

  function renderTemperature(model) {
    const margin = TEMPERATURE_MARGIN;
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const series = visibleSeries(model);
    const firstElapsedSeconds = model.elapsedSeconds[0];
    const minimumTemperatureC = min(series, (candidate) => {
      const seriesMinimumC = min(
        candidate.values,
        (point) => point.temperatureC
      );
      return Number.isFinite(candidate.thresholdC)
        ? Math.min(candidate.thresholdC, seriesMinimumC)
        : seriesMinimumC;
    }) ?? 0;
    const maximumTemperatureC = max(series, (candidate) => Math.max(
      Number.isFinite(candidate.thresholdC)
        ? candidate.thresholdC
        : Number.NEGATIVE_INFINITY,
      max(candidate.values, (point) => point.temperatureC)
    )) ?? minimumTemperatureC;
    const displayScale = createEngineeringDisplayScale(
      Math.max(Math.abs(minimumTemperatureC), Math.abs(maximumTemperatureC)),
      "°C"
    );
    const temperatureRangeC = maximumTemperatureC - minimumTemperatureC;
    const temperaturePaddingC = Math.max(1, temperatureRangeC * 0.12);
    xScale = scaleLinear()
      .domain([firstElapsedSeconds, model.endElapsedSeconds])
      .range([margin.left, WIDTH - margin.right]);
    yScale = scaleLinear()
      .domain([
        minimumTemperatureC - temperaturePaddingC,
        maximumTemperatureC + temperaturePaddingC
      ])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const pathFor = (candidate) => {
      const temperatureLine = line()
        .x((point) => xScale(point.elapsedSeconds))
        .y((point) => yScale(point.temperatureC));
      const values = candidate.kind === "prescribed"
        ? extendRateThroughTimestepEnd(
            candidate.values,
            model.endElapsedSeconds
          )
        : candidate.values;
      if (candidate.kind === "prescribed") {
        temperatureLine.curve(curveStepAfter);
      }
      return temperatureLine(values);
    };

    xAxisLayer
      .attr("transform", `translate(0 ${HEIGHT - margin.bottom})`)
      .call(axisBottom(xScale).ticks(8).tickFormat(formatChartTime));
    xAxisLayer
      .selectAll("text")
      .attr("text-anchor", "middle")
      .attr("transform", null)
      .attr("dx", null)
      .attr("dy", "0.71em");
    yAxisLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickFormat((value) =>
        displayScale.format(value)
      ));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text(`Temperature (${displayScale.unit})`);

    barLayer.selectAll("rect.results-energy-bar").remove();
    lineLayer.selectAll("path.results-power-line").remove();
    interactionLayer.selectAll("path.results-power-hit").remove();
    lineLayer
      .selectAll("path.results-temperature-line")
      .data(series, (candidate) => candidate.id)
      .join("path")
      .attr("class", "results-temperature-line")
      .attr("data-series-id", (candidate) => candidate.id)
      .attr("data-kind", (candidate) => candidate.kind)
      .attr("fill", "none")
      .attr("stroke", (candidate) => candidate.colour)
      .attr("d", pathFor);
    const thresholdSeries = series.filter((candidate) =>
      Number.isFinite(candidate.thresholdC)
    );
    lineLayer
      .selectAll("line.results-temperature-threshold")
      .data(thresholdSeries, (candidate) => candidate.id)
      .join("line")
      .attr("class", "results-temperature-threshold")
      .attr("x1", margin.left)
      .attr("x2", WIDTH - margin.right)
      .attr("y1", (candidate) => yScale(candidate.thresholdC))
      .attr("y2", (candidate) => yScale(candidate.thresholdC));
    lineLayer
      .selectAll("text.results-temperature-threshold-label")
      .data(thresholdSeries, (candidate) => candidate.id)
      .join("text")
      .attr("class", "results-temperature-threshold-label")
      .attr("x", WIDTH - margin.right - 5)
      .attr("y", (candidate) => yScale(candidate.thresholdC) - 5)
      .attr("text-anchor", "end")
      .text((candidate) =>
        `${candidate.thresholdLabel} ${formatEngineeringValue(candidate.thresholdC, "°C")}`
      );
    const hitLines = interactionLayer
      .selectAll("path.results-temperature-hit")
      .data(series, (candidate) => candidate.id)
      .join("path")
      .attr("class", "results-temperature-hit")
      .attr("data-series-id", (candidate) => candidate.id)
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("d", pathFor);
    addSeriesPointerHandlers(hitLines);

    pointerSurface
      .attr("display", null)
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", plotWidth)
      .attr("height", plotHeight)
      .on("pointermove", updateStepFromPointer);
    cursorLayer.attr("display", null);
  }

  function updateEmphasis() {
    const { selectedComponentId, highlightedConnectionId } = state;
    const series = visibleSeries(state.model);
    const effectiveSelectedComponentId = series.some((candidate) =>
      candidate.componentIds.includes(selectedComponentId)
    )
      ? selectedComponentId
      : null;
    const setEmphasis = (selection) => selection
      .attr("data-emphasised", (series) => String(resultsSeriesIsEmphasised(
        series,
        effectiveSelectedComponentId,
        highlightedConnectionId,
        highlightedSeriesId
      )))
      .attr("data-highlighted", (series) => String(
        series.id === highlightedSeriesId ||
        (
          series.connectionId !== null &&
          series.connectionId === highlightedConnectionId
        )
      ));
    setEmphasis(lineLayer.selectAll("path.results-power-line"));
    setEmphasis(lineLayer.selectAll("path.results-temperature-line"));
    setEmphasis(barLayer.selectAll("rect.results-energy-bar"));
    lineLayer
      .selectAll("path.results-power-line, path.results-temperature-line")
      .filter((series) =>
        series.id === highlightedSeriesId ||
        (
          series.connectionId !== null &&
          series.connectionId === highlightedConnectionId
        )
      )
      .raise();
    barLayer
      .selectAll("rect.results-energy-bar")
      .filter((series) =>
        series.connectionId !== null &&
        series.connectionId === highlightedConnectionId
      )
      .raise();
    for (const candidate of series) {
      const entry = legendBySeriesId.get(candidate.id);
      entry.button.dataset.emphasised = String(resultsSeriesIsEmphasised(
        candidate,
        effectiveSelectedComponentId,
        highlightedConnectionId,
        highlightedSeriesId
      ));
      entry.button.dataset.highlighted = String(
        candidate.id === highlightedSeriesId ||
        (
          candidate.connectionId !== null &&
          candidate.connectionId === highlightedConnectionId
        )
      );
    }
  }

  function updateCursor() {
    if (mode === "energy") {
      return;
    }
    const series = visibleSeries(state.model);
    const startElapsedSeconds = state.model.elapsedSeconds[state.stepIndex];
    const endElapsedSeconds = startElapsedSeconds + state.model.timeStepSeconds;
    const elapsedSeconds = mode === "temperature"
      ? endElapsedSeconds
      : startElapsedSeconds;
    const cursorX = xScale(elapsedSeconds);
    cursorLine
      .attr("x1", cursorX)
      .attr("x2", cursorX)
      .attr("y1", mode === "temperature" ? TEMPERATURE_MARGIN.top : POWER_MARGIN.top)
      .attr(
        "y2",
        HEIGHT - (mode === "temperature" ? TEMPERATURE_MARGIN.bottom : POWER_MARGIN.bottom)
      );
    cursorPoints
      .selectAll("circle")
      .data(series, (candidate) => candidate.id)
      .join("circle")
      .attr("r", 3.5)
      .attr("cx", cursorX)
      .attr("cy", (candidate) => yScale(
        mode === "temperature"
          ? candidate.values[
              state.stepIndex + candidate.stepValueOffset
            ].temperatureC
          : candidate.values[state.stepIndex][
              mode === "mass" ? "massFlowKgPerSecond" : "powerkW"
            ]
      ))
      .attr("fill", (candidate) => candidate.colour);
  }

  function updateLegend() {
    for (const series of visibleSeries(state.model)) {
      const value = mode === "power" || mode === "mass"
        ? series.values[state.stepIndex][
            mode === "mass" ? "massFlowKgPerSecond" : "powerkW"
          ]
        : mode === "energy"
          ? series.integratedEnergykWh
          : series.values[
              state.stepIndex + series.stepValueOffset
            ].temperatureC;
      const unit = mode === "power"
        ? "kW"
        : mode === "mass"
          ? "kg/s"
          : mode === "energy" ? "kWh" : "°C";
      legendBySeriesId.get(series.id).value.textContent = formatEngineeringValue(value, unit);
    }
  }

  function updateAccessibility() {
    if (mode === "energy") {
      svg
        .attr("role", "img")
        .attr("tabindex", null)
        .attr("aria-label", "Integrated transferred energy")
        .attr("aria-valuemin", null)
        .attr("aria-valuemax", null)
        .attr("aria-valuenow", null)
        .attr("aria-valuetext", null);
      return;
    }

    const startElapsedSeconds = state.model.elapsedSeconds[state.stepIndex];
    const endElapsedSeconds = startElapsedSeconds + state.model.timeStepSeconds;
    const elapsedSeconds = mode === "temperature"
      ? endElapsedSeconds
      : startElapsedSeconds;
    svg
      .attr("role", "slider")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        mode === "temperature"
          ? "Component temperature results timeline"
          : mode === "mass"
            ? "Material mass-flow results timeline"
            : "Power results timeline"
      )
      .attr("aria-valuemin", 1)
      .attr("aria-valuemax", state.model.stepCount)
      .attr("aria-valuenow", state.stepIndex + 1)
      .attr(
        "aria-valuetext",
        mode === "temperature"
          ? `${formatChartTime(elapsedSeconds)}, state after step ${
              state.stepIndex + 1
            } of ${state.model.stepCount}`
          : `${formatChartTime(startElapsedSeconds)}–${
              formatChartTime(endElapsedSeconds)
            }, step ${state.stepIndex + 1} of ${state.model.stepCount}`
      );
  }

  function renderChart() {
    rebuildLegend(state.model);
    if (mode === "power" || mode === "mass") {
      renderPower(state.model);
    } else if (mode === "energy") {
      renderEnergy(state.model);
    } else {
      renderTemperature(state.model);
    }
    renderedModel = state.model;
    renderedMode = mode;
    renderedScenarioInputs = showScenarioInputs;
  }

  const frameRenderer = createFrameRenderer({
    render() {
      const hiddenConnectionId = (mode === "power" || mode === "energy") &&
        state.model.hiddenSeries.some(
          (series) => series.connectionId === state.highlightedConnectionId
        )
        ? state.highlightedConnectionId
        : null;
      if (
        state.model !== renderedModel ||
        mode !== renderedMode ||
        showScenarioInputs !== renderedScenarioInputs ||
        hiddenConnectionId !== renderedHiddenConnectionId
      ) {
        renderChart();
        renderedHiddenConnectionId = hiddenConnectionId;
      }
      powerButton.setAttribute("aria-pressed", String(mode === "power"));
      energyButton.setAttribute("aria-pressed", String(mode === "energy"));
      massButton.setAttribute("aria-pressed", String(mode === "mass"));
      temperatureButton.setAttribute("aria-pressed", String(mode === "temperature"));
      scenarioInputsToggle.checked = showScenarioInputs;
      scenarioInputsToggle.disabled = scenarioInputSeries(state.model).length === 0;
      updateEmphasis();
      updateCursor();
      updateLegend();
      updateAccessibility();
    }
  });

  function update(nextState) {
    if (!nextState?.model) {
      throw new TypeError("A results chart model is required");
    }
    if (
      !Number.isInteger(nextState.stepIndex) ||
      nextState.stepIndex < 0 ||
      nextState.stepIndex >= nextState.model.stepCount
    ) {
      throw new RangeError(
        `Chart stepIndex must be between 0 and ${nextState.model.stepCount - 1}`
      );
    }
    state = nextState;
    temperatureButton.hidden =
      nextState.model.temperatureSeries.length === 0 &&
      nextState.model.prescribedTemperatureSeries.length === 0;
    massButton.hidden =
      nextState.model.materialSeries.length === 0 &&
      nextState.model.prescribedMassSeries.length === 0;
    if (mode === "temperature" && temperatureButton.hidden) {
      mode = "power";
    }
    if (mode === "mass" && massButton.hidden) {
      mode = "power";
    }
    frameRenderer.request();
  }

  function setMode(nextMode) {
    if (
      nextMode !== "power" &&
      nextMode !== "energy" &&
      nextMode !== "mass" &&
      nextMode !== "temperature"
    ) {
      throw new TypeError(`Unknown results chart mode: ${nextMode}`);
    }
    if (
      nextMode === "mass" &&
      state?.model.materialSeries.length === 0 &&
      state?.model.prescribedMassSeries.length === 0
    ) {
      return;
    }
    if (
      nextMode === "temperature" &&
      state?.model.temperatureSeries.length === 0 &&
      state?.model.prescribedTemperatureSeries.length === 0
    ) {
      return;
    }
    if (nextMode === mode) {
      return;
    }
    highlightedSeriesId = null;
    onHighlightConnection(null);
    mode = nextMode;
    if (state) {
      frameRenderer.request();
    }
  }

  const showPower = () => setMode("power");
  const showEnergy = () => setMode("energy");
  const showMass = () => setMode("mass");
  const showTemperature = () => setMode("temperature");
  const toggleScenarioInputs = () => {
    showScenarioInputs = scenarioInputsToggle.checked;
    setSeriesHighlight(null);
  };
  const handleKeyDown = (event) => {
    if (mode === "energy" || !state) {
      return;
    }
    const nextStepIndex = nextChartStepIndex({
      key: event.key,
      stepIndex: state.stepIndex,
      stepCount: state.model.stepCount,
      timeStepSeconds: state.model.timeStepSeconds
    });
    if (nextStepIndex === null) {
      return;
    }
    event.preventDefault();
    if (nextStepIndex !== state.stepIndex) {
      onStepChange(nextStepIndex);
    }
  };
  powerButton.addEventListener("click", showPower);
  energyButton.addEventListener("click", showEnergy);
  massButton.addEventListener("click", showMass);
  temperatureButton.addEventListener("click", showTemperature);
  scenarioInputsToggle.checked = showScenarioInputs;
  scenarioInputsToggle.addEventListener("change", toggleScenarioInputs);
  svg.on("keydown", handleKeyDown);

  return Object.freeze({
    update,
    setMode,
    dispose() {
      frameRenderer.dispose();
      powerButton.removeEventListener("click", showPower);
      energyButton.removeEventListener("click", showEnergy);
      massButton.removeEventListener("click", showMass);
      temperatureButton.removeEventListener("click", showTemperature);
      scenarioInputsToggle.removeEventListener("change", toggleScenarioInputs);
      svg.on("keydown", null);
      legendTarget.replaceChildren();
      svg.remove();
    }
  });
}
