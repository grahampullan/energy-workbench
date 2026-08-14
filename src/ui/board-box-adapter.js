import {
  Board,
  Box,
  Component as BoardBoxComponent,
  Context,
  Observable
} from "board-box";
import { select } from "d3";

import { THERMAL_HEAT_FLOW_TYPE } from "../core/flow-types.js";
import { createFrameRenderer } from "./animation-frame.js";

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
    this.button.setAttribute("aria-label", `${component.name}, ${component.metric.label}: ${component.metric.displayValue}`);
    this.button.setAttribute("aria-pressed", String(selected));
  }
}

function addArrowMarkers(svg) {
  svg
    .append("defs")
    .append("marker")
    .attr("id", "flow-arrow")
    .attr("viewBox", "0 0 10 10")
    .attr("refX", 8)
    .attr("refY", 5)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto-start-reverse")
    .append("path")
    .attr("d", "M 0 0 L 10 5 L 0 10 z");
}

function boxEdgePoint(box, toward) {
  const centre = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
  const deltaX = toward.x - centre.x;
  const deltaY = toward.y - centre.y;
  if (deltaX === 0 && deltaY === 0) {
    return centre;
  }
  const scale = 1 / Math.max(
    Math.abs(deltaX) / (box.width / 2),
    Math.abs(deltaY) / (box.height / 2)
  );
  return {
    x: centre.x + deltaX * scale,
    y: centre.y + deltaY * scale
  };
}

function connectionGeometry(boxesByComponentId, connections) {
  return connections.flatMap((connection) => {
    const fromBox = boxesByComponentId.get(connection.fromComponentId);
    const toBox = boxesByComponentId.get(connection.toComponentId);
    if (!fromBox || !toBox) {
      return [];
    }

    const fromCentre = {
      x: fromBox.x + fromBox.width / 2,
      y: fromBox.y + fromBox.height / 2
    };
    const toCentre = {
      x: toBox.x + toBox.width / 2,
      y: toBox.y + toBox.height / 2
    };
    const fromEdge = boxEdgePoint(fromBox, toCentre);
    const toEdge = boxEdgePoint(toBox, fromCentre);
    const { x: x1, y: y1 } = fromEdge;
    const { x: x2, y: y2 } = toEdge;
    return [{ ...connection, x1, y1, x2, y2 }];
  });
}

function renderConnections(
  content,
  boxesByComponentId,
  view,
  onConnectionHighlight
) {
  const connections = connectionGeometry(boxesByComponentId, view.connections);

  content
    .selectAll("line.connection-line")
    .data(connections, (connection) => connection.id)
    .join("line")
    .attr("class", "connection-line")
    .attr("x1", (connection) => connection.x1)
    .attr("y1", (connection) => connection.y1)
    .attr("x2", (connection) => connection.x2)
    .attr("y2", (connection) => connection.y2)
    .classed(
      "connection-line--thermal",
      (connection) => connection.flowType === THERMAL_HEAT_FLOW_TYPE
    )
    .classed(
      "connection-line--highlighted",
      (connection) => connection.id === view.highlightedConnectionId
    )
    .attr("marker-start", (connection) =>
      connection.signedFlow < -1e-9 ? "url(#flow-arrow)" : null
    )
    .attr("marker-end", (connection) =>
      connection.signedFlow > 1e-9 ? "url(#flow-arrow)" : null
    )
    .on("pointerenter", (event, connection) => onConnectionHighlight(connection.id))
    .on("pointerleave", () => onConnectionHighlight(null));

  const labels = content
    .selectAll("g.connection-label")
    .data(connections, (connection) => connection.id)
    .join((enter) => {
      const label = enter.append("g").attr("class", "connection-label");
      label.append("text").attr("x", 0).attr("y", 0).attr("dy", "0.35em");
      return label;
    })
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
  addArrowMarkers(svg);
  const connectionContent = svg
    .append("g")
    .attr("class", "connection-content");

  const boxesByComponentId = new Map();
  const connectionRenderer = createFrameRenderer({
    render() {
      renderConnections(
        connectionContent,
        boxesByComponentId,
        getView(),
        onConnectionHighlight
      );
    }
  });
  const updateConnections = () => connectionRenderer.request();
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

  return Object.freeze({
    update() {
      board.update();
    },
    dispose() {
      connectionRenderer.dispose();
      svg.remove();
    }
  });
}
