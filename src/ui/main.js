import { electricalBatteryDefinition } from "../components/electrical/battery.js";
import { electricalBusDefinition } from "../components/electrical/bus.js";
import { electricalGridDefinition } from "../components/electrical/grid.js";
import { electricalLoadDefinition } from "../components/electrical/load.js";
import { electricalPvDefinition } from "../components/electrical/pv.js";
import { electricalSourceDefinition } from "../components/electrical/source.js";
import { createComponentRegistry } from "../core/component-registry.js";
import { createPvBatterySelfConsumptionPolicy } from "../policies/pv-battery-self-consumption.js";
import { runScenario } from "../runtime/run-scenario.js";
import { createTopologyBoard } from "./board-box-adapter.js";
import { createWorkbenchView } from "./workbench-view-model.js";

const EXAMPLE_ROOT = "/examples/blog-electrical";

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`);
  }
  return response.json();
}

function element(id) {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Page element does not exist: ${id}`);
  }
  return found;
}

function definitionRegistry() {
  return createComponentRegistry([
    electricalBatteryDefinition,
    electricalBusDefinition,
    electricalGridDefinition,
    electricalLoadDefinition,
    electricalPvDefinition,
    electricalSourceDefinition
  ]);
}

function descriptionList(fields) {
  const list = document.createElement("dl");
  list.className = "inspector-fields";
  for (const field of fields) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = field.label;
    definition.textContent = field.displayValue;
    row.append(term, definition);
    list.append(row);
  }
  return list;
}

function inspectorSection(title, fields) {
  if (fields.length === 0) {
    return null;
  }
  const section = document.createElement("section");
  section.className = "inspector-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, descriptionList(fields));
  return section;
}

function renderInspector(component) {
  const inspector = element("inspector");
  inspector.className = "inspector-content";
  inspector.replaceChildren();

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `${component.type} · v${component.definitionVersion}`;
  const heading = document.createElement("h2");
  heading.id = "inspector-title";
  heading.textContent = component.name;
  const definitionName = document.createElement("p");
  definitionName.className = "inspector-definition";
  definitionName.textContent = component.definitionName;

  const liveResult = document.createElement("div");
  liveResult.className = "inspector-live-result";
  liveResult.dataset.powerTone = component.powerTone;
  const liveLabel = document.createElement("span");
  liveLabel.textContent = component.metric.label;
  const liveValue = document.createElement("strong");
  liveValue.textContent = component.metric.displayValue;
  liveResult.append(liveLabel, liveValue);

  inspector.append(eyebrow, heading, definitionName, liveResult);
  for (const group of component.parameterGroups) {
    const section = inspectorSection(group.label, group.fields);
    if (section) {
      inspector.append(section);
    }
  }
  for (const [title, fields] of [
    ["Operation", component.operationFields],
    ["Outputs", component.outputFields],
    ["State after timestep", component.stateFields]
  ]) {
    const section = inspectorSection(title, fields);
    if (section) {
      inspector.append(section);
    }
  }
}

function showFatalError(error) {
  console.error(error);
  const template = element("fatal-error-template");
  const errorView = template.content.cloneNode(true);
  errorView.querySelector(".fatal-error-message").textContent = error.message;
  document.querySelector(".workspace")?.replaceWith(errorView);
  document.querySelector(".timeline-panel")?.remove();
  const status = element("run-status");
  status.classList.add("run-status--error");
  status.lastChild.textContent = " Runtime stopped";
}

async function startWorkbench() {
  const [model, scenario, layout] = await Promise.all([
    loadJson(`${EXAMPLE_ROOT}/model.json`),
    loadJson(`${EXAMPLE_ROOT}/scenario.json`),
    loadJson(`${EXAMPLE_ROOT}/layout.json`)
  ]);
  if (layout.modelId !== model.id) {
    throw new Error(`Layout ${layout.id} belongs to ${layout.modelId}, not ${model.id}`);
  }

  const registry = definitionRegistry();
  const battery = model.components.find((component) => component.type === "electrical.battery");
  if (!battery) {
    throw new Error("The example requires one battery for its dispatch policy");
  }
  const run = runScenario({
    model,
    scenario,
    registry,
    policy: createPvBatterySelfConsumptionPolicy({ batteryComponentId: battery.id })
  });
  if (!run.completed) {
    const messages = run.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    throw new Error(messages || "The runtime did not complete");
  }

  let selectedComponentId = battery.id;
  let stepIndex = Math.floor(run.results.steps.length / 2);
  let view = createWorkbenchView({ model, registry, results: run.results, stepIndex });

  function getView(componentId) {
    if (!componentId) {
      return view;
    }
    const component = view.components.find((candidate) => candidate.id === componentId);
    if (!component) {
      throw new Error(`View does not contain component: ${componentId}`);
    }
    return { component, selected: componentId === selectedComponentId };
  }

  function updateText() {
    element("timeline-label").textContent = view.timelineLabel;
    element("summary-time").textContent = view.timelineLabel.split(" · ")[0];
    const selected = view.components.find((component) => component.id === selectedComponentId);
    renderInspector(selected);
  }

  const topology = createTopologyBoard({
    targetId: "topology-board",
    model,
    layout,
    getView,
    onSelect(componentId) {
      selectedComponentId = componentId;
      topology.update();
      updateText();
    }
  });

  const timeline = element("timeline");
  timeline.max = String(run.results.steps.length - 1);
  timeline.value = String(stepIndex);
  timeline.disabled = false;
  timeline.addEventListener("input", () => {
    stepIndex = Number(timeline.value);
    view = createWorkbenchView({ model, registry, results: run.results, stepIndex });
    topology.update();
    updateText();
  });

  element("model-name").textContent = model.name;
  element("scenario-name").textContent = scenario.name;
  element("summary-topology").textContent = `${model.components.length} components · ${model.connections.length} connections`;
  const status = element("run-status");
  status.classList.add("run-status--complete");
  status.lastChild.textContent = ` ${run.results.steps.length.toLocaleString("en-GB")} timesteps ready`;
  updateText();
}

startWorkbench().catch(showFatalError);
