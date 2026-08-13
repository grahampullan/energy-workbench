import {
  axisBottom,
  axisLeft,
  line,
  max,
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

function seriesIsEmphasised(series, selectedComponentId, highlightedConnectionId) {
  if (highlightedConnectionId !== null) {
    return series.connectionId === highlightedConnectionId;
  }
  return selectedComponentId === null || series.componentIds.includes(selectedComponentId);
}

function makeLegendButton(series, colour, onHighlightConnection) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "results-legend-item";
  button.dataset.seriesId = series.id;

  const swatch = document.createElement("span");
  swatch.className = "results-legend-swatch";
  swatch.style.backgroundColor = colour;
  swatch.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "results-legend-label";
  label.textContent = series.label;
  const value = document.createElement("strong");
  value.className = "results-legend-value";
  button.append(swatch, label, value);

  button.addEventListener("pointerenter", () => onHighlightConnection(series.connectionId));
  button.addEventListener("pointerleave", () => onHighlightConnection(null));
  button.addEventListener("focus", () => onHighlightConnection(series.connectionId));
  button.addEventListener("blur", () => onHighlightConnection(null));
  return { button, value };
}

export function createResultsChart({
  target,
  legendTarget,
  powerButton,
  energyButton,
  headingTarget,
  onStepChange,
  onHighlightConnection
}) {
  if (!target || !legendTarget || !powerButton || !energyButton || !headingTarget) {
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

  function colourFor(seriesId) {
    return coloursBySeriesId.get(seriesId) ?? SERIES_COLOURS[0];
  }

  function rebuildLegend(model) {
    legendTarget.replaceChildren();
    coloursBySeriesId = new Map(model.series.map((series, index) => [
      series.id,
      SERIES_COLOURS[index % SERIES_COLOURS.length]
    ]));
    legendBySeriesId = new Map(model.series.map((series) => {
      const entry = makeLegendButton(
        series,
        colourFor(series.id),
        onHighlightConnection
      );
      legendTarget.append(entry.button);
      return [series.id, entry];
    }));
  }

  function stepFromPointer(event) {
    const [pointerX] = pointer(event, svg.node());
    const elapsedSeconds = state.model.elapsedSeconds;
    const firstElapsedSeconds = elapsedSeconds[0];
    const approximateStep = Math.round(
      (xScale.invert(pointerX) - firstElapsedSeconds) / state.model.timeStepSeconds
    );
    return Math.max(0, Math.min(state.model.stepCount - 1, approximateStep));
  }

  function updateStepFromPointer(event) {
    if (mode !== "power") {
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
        onHighlightConnection(series.connectionId);
        updateStepFromPointer(event);
      })
      .on("pointermove", updateStepFromPointer)
      .on("pointerleave", () => onHighlightConnection(null));
  }

  function renderPower(model) {
    const margin = POWER_MARGIN;
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const maximumPowerKw = max(model.series, (series) =>
      max(series.values, (point) => point.powerKw)
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
      .domain([0, maximumPowerKw || 1])
      .nice()
      .range([HEIGHT - margin.bottom, margin.top]);
    const powerLine = line()
      .x((point) => xScale(point.elapsedSeconds))
      .y((point) => yScale(point.powerKw));

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
    yLabel.text("Power (kW)");
    title.text("Directional electrical power over time");

    barLayer.selectAll("rect.results-energy-bar").remove();
    lineLayer
      .selectAll("path.results-power-line")
      .data(model.series, (series) => series.id)
      .join("path")
      .attr("class", "results-power-line")
      .attr("data-series-id", (series) => series.id)
      .attr("fill", "none")
      .attr("stroke", (series) => colourFor(series.id))
      .attr("d", (series) => powerLine(series.values));

    const hitLines = interactionLayer
      .selectAll("path.results-power-hit")
      .data(model.series, (series) => series.id)
      .join("path")
      .attr("class", "results-power-hit")
      .attr("data-series-id", (series) => series.id)
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("d", (series) => powerLine(series.values));
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
    const maximumEnergyKwh = max(
      model.series,
      (series) => series.integratedEnergyKwh
    ) ?? 0;
    const y = scaleLinear()
      .domain([0, maximumEnergyKwh || 1])
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
    title.text("Integrated directional electrical energy");

    lineLayer.selectAll("path.results-power-line").remove();
    interactionLayer.selectAll("path.results-power-hit").remove();
    pointerSurface.attr("display", "none").on("pointermove", null);
    cursorLayer.attr("display", "none");

    const bars = barLayer
      .selectAll("rect.results-energy-bar")
      .data(model.series, (series) => series.id)
      .join("rect")
      .attr("class", "results-energy-bar")
      .attr("data-series-id", (series) => series.id)
      .attr("x", (series) => x(series.id))
      .attr("y", (series) => y(series.integratedEnergyKwh))
      .attr("width", x.bandwidth())
      .attr("height", (series) => y(0) - y(series.integratedEnergyKwh))
      .attr("fill", (series) => colourFor(series.id));
    bars
      .on("pointerenter", (event, series) => onHighlightConnection(series.connectionId))
      .on("pointerleave", () => onHighlightConnection(null));
  }

  function updateEmphasis() {
    const { selectedComponentId, highlightedConnectionId } = state;
    const setEmphasis = (selection) => selection
      .attr("data-emphasised", (series) => String(seriesIsEmphasised(
        series,
        selectedComponentId,
        highlightedConnectionId
      )))
      .attr("data-highlighted", (series) =>
        String(series.connectionId === highlightedConnectionId)
      );
    setEmphasis(lineLayer.selectAll("path.results-power-line"));
    setEmphasis(barLayer.selectAll("rect.results-energy-bar"));
    for (const series of state.model.series) {
      const entry = legendBySeriesId.get(series.id);
      entry.button.dataset.emphasised = String(seriesIsEmphasised(
        series,
        selectedComponentId,
        highlightedConnectionId
      ));
      entry.button.dataset.highlighted = String(
        series.connectionId === highlightedConnectionId
      );
    }
  }

  function updateCursor() {
    if (mode !== "power") {
      return;
    }
    const elapsedSeconds = state.model.elapsedSeconds[state.stepIndex];
    const cursorX = xScale(elapsedSeconds);
    cursorLine
      .attr("x1", cursorX)
      .attr("x2", cursorX)
      .attr("y1", POWER_MARGIN.top)
      .attr("y2", HEIGHT - POWER_MARGIN.bottom);
    cursorPoints
      .selectAll("circle")
      .data(state.model.series, (series) => series.id)
      .join("circle")
      .attr("r", 3.5)
      .attr("cx", cursorX)
      .attr("cy", (series) => yScale(series.values[state.stepIndex].powerKw))
      .attr("fill", (series) => colourFor(series.id));
  }

  function updateLegend() {
    for (const series of state.model.series) {
      const value = mode === "power"
        ? series.values[state.stepIndex].powerKw
        : series.integratedEnergyKwh;
      const unit = mode === "power" ? "kW" : "kWh";
      legendBySeriesId.get(series.id).value.textContent = formatEngineeringValue(value, unit);
    }
  }

  function updateAccessibility() {
    if (mode === "energy") {
      svg
        .attr("role", "img")
        .attr("tabindex", null)
        .attr("aria-label", "Integrated directional electrical energy")
        .attr("aria-valuemin", null)
        .attr("aria-valuemax", null)
        .attr("aria-valuenow", null)
        .attr("aria-valuetext", null);
      return;
    }

    const elapsedSeconds = state.model.elapsedSeconds[state.stepIndex];
    svg
      .attr("role", "slider")
      .attr("tabindex", 0)
      .attr("aria-label", "Power results timeline")
      .attr("aria-valuemin", 1)
      .attr("aria-valuemax", state.model.stepCount)
      .attr("aria-valuenow", state.stepIndex + 1)
      .attr(
        "aria-valuetext",
        `${formatChartTime(elapsedSeconds)}, step ${state.stepIndex + 1} of ${state.model.stepCount}`
      );
  }

  function renderChart() {
    if (state.model !== renderedModel) {
      rebuildLegend(state.model);
    }
    if (mode === "power") {
      renderPower(state.model);
    } else {
      renderEnergy(state.model);
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
      headingTarget.textContent = mode === "power" ? "Power over time" : "Integrated energy";
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
    frameRenderer.request();
  }

  function setMode(nextMode) {
    if (nextMode !== "power" && nextMode !== "energy") {
      throw new TypeError(`Unknown results chart mode: ${nextMode}`);
    }
    if (nextMode === mode) {
      return;
    }
    mode = nextMode;
    if (state) {
      frameRenderer.request();
    }
  }

  const showPower = () => setMode("power");
  const showEnergy = () => setMode("energy");
  const handleKeyDown = (event) => {
    if (mode !== "power" || !state) {
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
  svg.on("keydown", handleKeyDown);

  return Object.freeze({
    update,
    setMode,
    dispose() {
      frameRenderer.dispose();
      powerButton.removeEventListener("click", showPower);
      energyButton.removeEventListener("click", showEnergy);
      svg.on("keydown", null);
      legendTarget.replaceChildren();
      svg.remove();
    }
  });
}
