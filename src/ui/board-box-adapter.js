import {
  Board,
  Box,
  Component as BoardBoxComponent,
  Context,
  Observable
} from "board-box";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
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

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value);
  }
  return element;
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
    const { component, selected } = this.getView(this.componentId);
    this.typeElement.textContent = component.definitionName;
    this.nameElement.textContent = component.name;
    this.valueElement.textContent = component.metric.displayValue;
    this.metricElement.textContent = component.metric.label;
    this.button.dataset.powerTone = component.powerTone;
    this.button.setAttribute("aria-label", `${component.name}, ${component.metric.label}: ${component.metric.displayValue}`);
    this.button.setAttribute("aria-pressed", String(selected));
  }
}

function addArrowMarkers(svg) {
  const definitions = svgElement("defs");
  const marker = svgElement("marker", {
    id: "flow-arrow",
    viewBox: "0 0 10 10",
    refX: "8",
    refY: "5",
    markerWidth: "7",
    markerHeight: "7",
    orient: "auto-start-reverse"
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z" }));
  definitions.append(marker);
  svg.append(definitions);
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

function renderConnections(svg, boxesByComponentId, view) {
  svg.querySelector(".connection-content")?.remove();
  const content = svgElement("g", { class: "connection-content" });

  for (const connection of view.connections) {
    const fromBox = boxesByComponentId.get(connection.fromComponentId);
    const toBox = boxesByComponentId.get(connection.toComponentId);
    if (!fromBox || !toBox) {
      continue;
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
    const line = svgElement("line", { x1, y1, x2, y2, class: "connection-line" });
    if (Math.abs(connection.powerKw) >= 1e-9) {
      line.setAttribute(connection.powerKw > 0 ? "marker-end" : "marker-start", "url(#flow-arrow)");
    }
    content.append(line);

    const label = svgElement("g", {
      class: "connection-label",
      transform: `translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})`
    });
    const text = svgElement("text", { x: "0", y: "0", dy: "0.35em" });
    text.textContent = connection.displayPower;
    label.append(text);
    content.append(label);
  }

  svg.append(content);
}

export function createTopologyBoard({ targetId, model, layout, getView, onSelect }) {
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

  const svg = svgElement("svg", {
    class: "connection-layer",
    "aria-hidden": "true"
  });
  addArrowMarkers(svg);
  target.append(svg);

  const boxesByComponentId = new Map();
  const updateConnections = () => {
    renderConnections(svg, boxesByComponentId, getView());
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

  return Object.freeze({
    update() {
      board.update();
    }
  });
}
