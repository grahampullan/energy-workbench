import {
  axisBottom,
  axisLeft,
  line,
  max,
  min,
  pointer,
  scaleBand,
  scaleLinear,
  select
} from "d3";

import { createFrameRenderer } from "./animation-frame.js";
import { formatEngineeringValue } from "./workbench-view-model.js";

const WIDTH = 1200;
const HEIGHT = 230;
const POWER_MARGIN = { top: 16, right: 24, bottom: 40, left: 62 };
const ENERGY_MARGIN = { top: 16, right: 24, bottom: 78, left: 62 };
const TEMPERATURE_MARGIN = POWER_MARGIN;
const SERIES_COLOURS = [
  "#2e6285",
  "#8b5a3c",
  "#1c7258",
  "#b96c25",
  "#76579b",
  "#b84f63",
  "#49736a",
  "#8b6c28"
];

function formatChartTime(elapsedSeconds) {
  const wholeMinutes = Math.round(elapsedSeconds / 60);
  const days = Math.floor(wholeMinutes / 1440);
  const minutesWithinDay = wholeMinutes % 1440;
  const hours = Math.floor(minutesWithinDay / 60);
  const minutes = minutesWithinDay % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return days ? `D${days + 1} ${clock}` : clock;
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

function seriesIsEmphasised(
  series,
  selectedComponentId,
  highlightedConnectionId,
  highlightedSeriesId
) {
  if (highlightedSeriesId !== null) {
    return series.id === highlightedSeriesId;
  }
  if (series.connectionId === null) {
    return true;
  }
  if (highlightedConnectionId !== null && series.connectionId !== null) {
    return series.connectionId === highlightedConnectionId;
  }
  return selectedComponentId === null || series.componentIds.includes(selectedComponentId);
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
  temperatureButton,
  headingTarget,
  onStepChange,
  onHighlightConnection
}) {
  if (
    !target ||
    !legendTarget ||
    !powerButton ||
    !energyButton ||
    !temperatureButton ||
    !headingTarget
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
  const title = svg.append("title");
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
  let state = null;
  let renderedModel = null;
  let renderedMode = null;
  let xScale = null;
  let yScale = null;
  let coloursBySeriesId = new Map();
  let legendBySeriesId = new Map();
  let highlightedSeriesId = null;

  function colourFor(seriesId) {
    return coloursBySeriesId.get(seriesId) ?? SERIES_COLOURS[0];
  }

  function visibleSeries(model) {
    if (mode === "temperature") {
      return [
        ...model.temperatureSeries,
        ...model.prescribedTemperatureSeries
      ];
    }
    return mode === "energy"
      ? model.series
      : [...model.series, ...model.prescribedPowerSeries];
  }

  function setSeriesHighlight(series) {
    highlightedSeriesId = series?.id ?? null;
    onHighlightConnection(series?.connectionId ?? null);
    if (state) {
      frameRenderer.request();
    }
  }

  function rebuildLegend(model) {
    const series = visibleSeries(model);
    const palette = mode === "temperature"
      ? ["#1c7258", "#2e6285", "#76579b", "#b96c25"]
      : SERIES_COLOURS;
    legendTarget.replaceChildren();
    coloursBySeriesId = new Map(series.map((candidate, index) => [
      candidate.id,
      palette[index % palette.length]
    ]));
    legendBySeriesId = new Map(series.map((candidate) => {
      const entry = makeLegendButton(
        candidate,
        colourFor(candidate.id),
        setSeriesHighlight
      );
      legendTarget.append(entry.button);
      return [candidate.id, entry];
    }));
  }

  function stepFromPointer(event) {
    const [pointerX] = pointer(event, svg.node());
    const firstElapsedSeconds = mode === "temperature"
      ? state.model.timeStepSeconds
      : state.model.elapsedSeconds[0];
    const approximateStep = Math.round(
      (xScale.invert(pointerX) - firstElapsedSeconds) / state.model.timeStepSeconds
    );
    return Math.max(0, Math.min(state.model.stepCount - 1, approximateStep));
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
    const maximumPowerkW = max(series, (candidate) =>
      max(candidate.values, (point) => point.powerkW)
    ) ?? 0;
    const firstElapsedSeconds = model.elapsedSeconds[0];
    const lastElapsedSeconds = model.elapsedSeconds.at(-1);
    xScale = scaleLinear()
      .domain([
        firstElapsedSeconds,
        lastElapsedSeconds === firstElapsedSeconds
          ? firstElapsedSeconds + model.timeStepSeconds
          : lastElapsedSeconds
      ])
      .range([margin.left, WIDTH - margin.right]);
    yScale = scaleLinear()
      .domain([0, maximumPowerkW || 1])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const powerLine = line()
      .x((point) => xScale(point.elapsedSeconds))
      .y((point) => yScale(point.powerkW));
    const pathFor = (candidate) => powerLine(candidate.values);

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
      .call(axisLeft(yScale).ticks(6));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text("Flow rate (kW)");
    title.text("Energy flow rate over time");

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
      .attr("stroke", (candidate) => colourFor(candidate.id))
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
    const x = scaleBand()
      .domain(model.series.map((series) => series.id))
      .range([margin.left, WIDTH - margin.right])
      .padding(0.22);
    const maximumEnergykWh = max(
      model.series,
      (series) => series.integratedEnergykWh
    ) ?? 0;
    const y = scaleLinear()
      .domain([0, maximumEnergykWh || 1])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const labelsBySeriesId = new Map(model.series.map((series) => [
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
      .call(axisLeft(y).ticks(6));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(y).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text("Energy (kWh)");
    title.text("Integrated transferred energy");

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
      .data(model.series, (series) => series.id)
      .join("rect")
      .attr("class", "results-energy-bar")
      .attr("data-series-id", (series) => series.id)
      .attr("x", (series) => x(series.id))
      .attr("y", (series) => y(series.integratedEnergykWh))
      .attr("width", x.bandwidth())
      .attr("height", (series) => y(0) - y(series.integratedEnergykWh))
      .attr("fill", (series) => colourFor(series.id));
    bars
      .on("pointerenter", (event, series) => setSeriesHighlight(series))
      .on("pointerleave", () => setSeriesHighlight(null));
  }

  function renderTemperature(model) {
    const margin = TEMPERATURE_MARGIN;
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const series = visibleSeries(model);
    const firstElapsedSeconds = series[0].values[0].elapsedSeconds;
    const lastElapsedSeconds = max(series, (candidate) =>
      candidate.values.at(-1).elapsedSeconds
    );
    const minimumTemperatureC = min(series, (candidate) => {
      const seriesMinimumC = min(
        candidate.values,
        (point) => point.temperatureC
      );
      return Number.isFinite(candidate.thresholdC)
        ? Math.min(candidate.thresholdC, seriesMinimumC)
        : seriesMinimumC;
    });
    const maximumTemperatureC = max(series, (candidate) => Math.max(
      Number.isFinite(candidate.thresholdC)
        ? candidate.thresholdC
        : Number.NEGATIVE_INFINITY,
      max(candidate.values, (point) => point.temperatureC)
    ));
    const temperatureRangeC = maximumTemperatureC - minimumTemperatureC;
    const temperaturePaddingC = Math.max(1, temperatureRangeC * 0.12);
    xScale = scaleLinear()
      .domain([
        firstElapsedSeconds,
        lastElapsedSeconds === firstElapsedSeconds
          ? firstElapsedSeconds + model.timeStepSeconds
          : lastElapsedSeconds
      ])
      .range([margin.left, WIDTH - margin.right]);
    yScale = scaleLinear()
      .domain([
        minimumTemperatureC - temperaturePaddingC,
        maximumTemperatureC + temperaturePaddingC
      ])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const temperatureLine = line()
      .x((point) => xScale(point.elapsedSeconds))
      .y((point) => yScale(point.temperatureC));
    const pathFor = (candidate) => temperatureLine(candidate.values);

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
      .call(axisLeft(yScale).ticks(6));
    gridLayer
      .attr("transform", `translate(${margin.left} 0)`)
      .call(axisLeft(yScale).ticks(6).tickSize(-plotWidth).tickFormat(""));
    yLabel.text("Temperature (°C)");
    title.text("Component temperature over time");

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
      .attr("stroke", (candidate) => colourFor(candidate.id))
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
      .attr("data-emphasised", (series) => String(seriesIsEmphasised(
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
    for (const candidate of series) {
      const entry = legendBySeriesId.get(candidate.id);
      entry.button.dataset.emphasised = String(seriesIsEmphasised(
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
    const elapsedSeconds = mode === "temperature"
      ? state.model.elapsedSeconds[state.stepIndex] + state.model.timeStepSeconds
      : state.model.elapsedSeconds[state.stepIndex];
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
              state.stepIndex + (candidate.kind === "prescribed" ? 0 : 1)
            ].temperatureC
          : candidate.values[state.stepIndex].powerkW
      ))
      .attr("fill", (candidate) => colourFor(candidate.id));
  }

  function updateLegend() {
    for (const series of visibleSeries(state.model)) {
      const value = mode === "power"
        ? series.values[state.stepIndex].powerkW
        : mode === "energy"
          ? series.integratedEnergykWh
          : series.values[
              state.stepIndex + (series.kind === "prescribed" ? 0 : 1)
            ].temperatureC;
      const unit = mode === "power" ? "kW" : mode === "energy" ? "kWh" : "°C";
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

    const elapsedSeconds = mode === "temperature"
      ? state.model.elapsedSeconds[state.stepIndex] + state.model.timeStepSeconds
      : state.model.elapsedSeconds[state.stepIndex];
    svg
      .attr("role", "slider")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        mode === "temperature"
          ? "Component temperature results timeline"
          : "Energy flow results timeline"
      )
      .attr("aria-valuemin", 1)
      .attr("aria-valuemax", state.model.stepCount)
      .attr("aria-valuenow", state.stepIndex + 1)
      .attr(
        "aria-valuetext",
        `${formatChartTime(elapsedSeconds)}, ${
          mode === "temperature" ? "state after " : ""
        }step ${state.stepIndex + 1} of ${state.model.stepCount}`
      );
  }

  function renderChart() {
    if (state.model !== renderedModel || mode !== renderedMode) {
      rebuildLegend(state.model);
    }
    if (mode === "power") {
      renderPower(state.model);
    } else if (mode === "energy") {
      renderEnergy(state.model);
    } else {
      renderTemperature(state.model);
    }
    renderedModel = state.model;
    renderedMode = mode;
  }

  const frameRenderer = createFrameRenderer({
    render() {
      if (state.model !== renderedModel || mode !== renderedMode) {
        renderChart();
      }
      powerButton.setAttribute("aria-pressed", String(mode === "power"));
      energyButton.setAttribute("aria-pressed", String(mode === "energy"));
      temperatureButton.setAttribute("aria-pressed", String(mode === "temperature"));
      headingTarget.textContent = mode === "power"
        ? "Flow over time"
        : mode === "energy"
          ? "Integrated energy"
          : "Temperature over time";
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
    if (mode === "temperature" && temperatureButton.hidden) {
      mode = "power";
    }
    frameRenderer.request();
  }

  function setMode(nextMode) {
    if (
      nextMode !== "power" &&
      nextMode !== "energy" &&
      nextMode !== "temperature"
    ) {
      throw new TypeError(`Unknown results chart mode: ${nextMode}`);
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
  const showTemperature = () => setMode("temperature");
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
  temperatureButton.addEventListener("click", showTemperature);
  svg.on("keydown", handleKeyDown);

  return Object.freeze({
    update,
    setMode,
    dispose() {
      frameRenderer.dispose();
      powerButton.removeEventListener("click", showPower);
      energyButton.removeEventListener("click", showEnergy);
      temperatureButton.removeEventListener("click", showTemperature);
      svg.on("keydown", null);
      legendTarget.replaceChildren();
      svg.remove();
    }
  });
}
