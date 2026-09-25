import {
  Board,
  Box,
  Component as BoardBoxComponent,
  Context,
  Observable
} from "board-box";
import { select } from "d3";

import { createFrameRenderer } from "./animation-frame.js";
import { createConnectionColourScale } from "./connection-colours.js";
import { connectionGeometry } from "./topology-geometry.js";
import { topologyDetailLevel } from "./topology-detail-level.js";

const BOX_WIDTH = 164;
const BOX_HEIGHT = 104;

export function bindNumberParameterControls({
  rangeInput,
  numberInput,
  initialValue,
  onChange,
  formatValue = String
}) {
  const observable = new Observable({
    state: { value: initialValue, source: "initial" }
  });
  let currentValue = initialValue;

  const observerId = observable.subscribe(({ value, source }) => {
    currentValue = value;
    if (source !== "range") {
      rangeInput.value = String(value);
    }
    if (source !== "number") {
      numberInput.value = String(value);
    }
    numberInput.setAttribute("aria-valuetext", formatValue(value));
  });

  function acceptInput(source, input, final) {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      if (final) {
        observable.state = { value: currentValue, source: "invalid" };
      }
      return;
    }
    observable.state = { value, source };
    onChange(value, { final });
  }

  const onRangeInput = () => acceptInput("range", rangeInput, false);
  const onRangeChange = () => acceptInput("range", rangeInput, true);
  const onNumberInput = () => acceptInput("number", numberInput, false);
  const onNumberChange = () => acceptInput("number", numberInput, true);
  rangeInput.addEventListener("input", onRangeInput);
  rangeInput.addEventListener("change", onRangeChange);
  numberInput.addEventListener("input", onNumberInput);
  numberInput.addEventListener("change", onNumberChange);
  observable.state = { value: initialValue, source: "initial" };

  return Object.freeze({
    dispose() {
      observable.unsubscribeById(observerId);
      rangeInput.removeEventListener("input", onRangeInput);
      rangeInput.removeEventListener("change", onRangeChange);
      numberInput.removeEventListener("input", onNumberInput);
      numberInput.removeEventListener("change", onNumberChange);
    }
  });
}

function componentClass(type) {
  return type.split(".").at(-1).replaceAll(/[^a-z0-9-]/gu, "-");
}

class WorkbenchComponent extends BoardBoxComponent {
  constructor({ componentId, getView, onSelect }) {
    super({});
    this.componentId = componentId;
    this.getView = getView;
    this.onSelect = onSelect;
  }

  make() {
    this.element = document.getElementById(this.id);
    this.element.style.pointerEvents = "auto";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "component-card";
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onSelect(this.componentId);
    });

    this.typeElement = document.createElement("span");
    this.typeElement.className = "component-card-type";
    this.nameElement = document.createElement("strong");
    this.nameElement.className = "component-card-name";
    this.valueElement = document.createElement("span");
    this.valueElement.className = "component-card-value";
    this.metricElement = document.createElement("span");
    this.metricElement.className = "component-card-metric";
    this.button.append(
      this.typeElement,
      this.nameElement,
      this.valueElement,
      this.metricElement
    );
    this.element.append(this.button);
    this.update();
  }

  update() {
    if (!this.button) {
      return;
    }
    const { component, selected, highlighted } = this.getView(this.componentId);
    this.typeElement.textContent = component.definitionName;
    this.nameElement.textContent = component.name;
    this.valueElement.textContent = component.metric.displayValue;
    this.metricElement.textContent = component.metric.label;
    this.button.dataset.powerTone = component.powerTone;
    this.button.dataset.highlighted = String(highlighted);
    this.button.dataset.visualRole = component.visualRole;
    this.button.setAttribute("aria-label", `${component.name}, ${component.metric.label}: ${component.metric.displayValue}`);
    this.button.setAttribute("aria-pressed", String(selected));
  }
}

function addArrowMarkers(svg, connectionIds, connectionColours) {
  svg
    .append("defs")
    .selectAll("marker")
    .data(connectionIds)
    .join("marker")
    .attr("id", (connectionId) =>
      `flow-arrow-${connectionColours.indexFor(connectionId)}`
    )
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 8)
    .attr("refY", 5)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z")
    .attr("fill", (connectionId) =>
      connectionColours.colourFor(connectionId)
    );
}

function renderConnections(
  content,
  boxesByComponentId,
  view,
  verticalBoundaryComponentIds,
  connectionColours,
  onConnectionHighlight
) {
  const connections = connectionGeometry(
    boxesByComponentId,
    view.connections,
    verticalBoundaryComponentIds
  );

  content
    .selectAll("line.connection-line")
    .data(connections, (connection) => connection.id)
    .join("line")
    .attr("class", "connection-line")
    .attr("data-connection-id", (connection) => connection.id)
    .attr("x1", (connection) => connection.x1)
    .attr("y1", (connection) => connection.y1)
    .attr("x2", (connection) => connection.x2)
    .attr("y2", (connection) => connection.y2)
    .style("stroke", (connection) => connectionColours.colourFor(connection.id))
    .classed(
      "connection-line--highlighted",
      (connection) => connection.id === view.highlightedConnectionId
    )
    .attr("marker-start", (connection) =>
      connection.signedFlow < -1e-9
        ? `url(#flow-arrow-${connectionColours.indexFor(connection.id)})`
        : null
    )
    .attr("marker-end", (connection) =>
      connection.signedFlow > 1e-9
        ? `url(#flow-arrow-${connectionColours.indexFor(connection.id)})`
        : null
    );

  const labels = content
    .selectAll("g.connection-label")
    .data(connections, (connection) => connection.id)
    .join((enter) => {
      const label = enter.append("g").attr("class", "connection-label");
      label.append("text").attr("x", 0).attr("y", 0).attr("dy", "0.35em");
      return label;
    })
    .attr("data-connection-id", (connection) => connection.id)
    .classed(
      "connection-label--highlighted",
      (connection) => connection.id === view.highlightedConnectionId
    )
    .attr("transform", (connection) =>
      `translate(${(connection.x1 + connection.x2) / 2} ${(connection.y1 + connection.y2) / 2})`
    );

  labels
    .select("text")
    .text((connection) => connection.displayFlow);

  content
    .selectAll("line.connection-hit")
    .data(connections, (connection) => connection.id)
    .join("line")
    .attr("class", "connection-hit")
    .attr("data-connection-id", (connection) => connection.id)
    .attr("x1", (connection) => connection.x1)
    .attr("y1", (connection) => connection.y1)
    .attr("x2", (connection) => connection.x2)
    .attr("y2", (connection) => connection.y2)
    .on("pointerenter", (event, connection) =>
      onConnectionHighlight(connection.id)
    )
    .on("pointerleave", () => onConnectionHighlight(null));
}

export function createTopologyBoard({
  targetId,
  model,
  layout,
  getView,
  onSelect,
  onConnectionHighlight = () => {}
}) {
  const target = document.getElementById(targetId);
  if (!target) {
    throw new Error(`Board target does not exist: ${targetId}`);
  }

  const positionsByComponentId = new Map(
    layout.components.map((position) => [position.componentId, position])
  );
  const connectionColours = createConnectionColourScale(
    model.connections.map(({ id }) => id)
  );
  const context = new Context();
  const board = new Board({
    targetId,
    widthPerCent: 100,
    heightPerCent: 100,
    className: "workbench-board"
  });
  context.addBoard(board);

  const svg = select(target)
    .append("svg")
    .attr("class", "connection-layer")
    .attr("aria-hidden", "true");
  addArrowMarkers(
    svg,
    model.connections.map(({ id }) => id),
    connectionColours
  );
  const connectionContent = svg
    .append("g")
    .attr("class", "connection-content");

  const boxesByComponentId = new Map();
  const verticalBoundaryComponentIds = new Set(model.components
    .filter(({ type }) => type === "thermal.constant-temperature")
    .map(({ id }) => id));
  const connectionRenderer = createFrameRenderer({
    render() {
      renderConnections(
        connectionContent,
        boxesByComponentId,
        getView(),
        verticalBoundaryComponentIds,
        connectionColours,
        onConnectionHighlight
      );
    }
  });
  const updateConnections = () => {
    target.dataset.detail = topologyDetailLevel(board.sharedState.transform.k);
    connectionRenderer.request();
  };
  for (const component of model.components) {
    const position = positionsByComponentId.get(component.id);
    if (!position) {
      throw new Error(`Layout does not contain component: ${component.id}`);
    }
    const componentView = new WorkbenchComponent({
      componentId: component.id,
      getView,
      onSelect
    });
    const box = new Box({
      x: position.x,
      y: position.y,
      width: position.width ?? BOX_WIDTH,
      height: position.height ?? BOX_HEIGHT,
      fixed: false,
      margin: 0,
      componentMargin: { top: 0, right: 0, bottom: 0, left: 0 },
      className: `workbench-box workbench-box--${componentClass(component.type)}`,
      component: componentView
    });
    box.customOnUpdateEnd = updateConnections;
    board.addBox(box);
    boxesByComponentId.set(component.id, box);
  }

  board.customOnUpdateEnd = updateConnections;
  board.make();
  updateConnections();

  const boardHost = target.parentElement;
  if (!boardHost) {
    throw new Error(`Board target does not have a host: ${targetId}`);
  }
  const resizeObserver = new ResizeObserver(() => {
    board.setSize();
    target.style.width = `${board.width}px`;
    target.style.height = `${board.height}px`;
    board.update();
  });
  resizeObserver.observe(boardHost);

  return Object.freeze({
    update() {
      board.update();
    },
    dispose() {
      resizeObserver.disconnect();
      connectionRenderer.dispose();
      svg.remove();
    }
  });
}
