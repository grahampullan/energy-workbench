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
import { createComponentInspector } from "./component-inspector.js";
import {
  applyParameterOverrides,
  parameterOverrideKey,
  resolvedParameterValue
} from "./preview-model.js";
import { createPreviewRunScheduler } from "./preview-run-scheduler.js";
import { createResultsChartModel } from "./results-chart-model.js";
import { createResultsChart } from "./results-chart.js";
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

function uniqueDiagnostics(diagnostics) {
  const diagnosticsByIdentity = new Map();
  for (const diagnostic of diagnostics) {
    const identity = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.path,
      diagnostic.message
    ].join("\u0000");
    diagnosticsByIdentity.set(identity, diagnostic);
  }
  return [...diagnosticsByIdentity.values()];
}

function runtimeFailure(run) {
  const message = run.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
  const error = new Error(message || "The runtime did not complete");
  error.diagnostics = run.diagnostics;
  return error;
}

function showFatalError(error) {
  console.error(error);
  const template = element("fatal-error-template");
  const errorView = template.content.cloneNode(true);
  errorView.querySelector(".fatal-error-message").textContent = error.message;
  document.querySelector(".workspace")?.replaceWith(errorView);
  document.querySelector(".results-panel")?.remove();
  document.querySelector(".timeline-panel")?.remove();
  const status = element("run-status");
  status.classList.add("run-status--error");
  status.lastChild.textContent = " Runtime stopped";
}

async function startWorkbench() {
  const [loadedModel, scenario, layout] = await Promise.all([
    loadJson(`${EXAMPLE_ROOT}/model.json`),
    loadJson(`${EXAMPLE_ROOT}/scenario.json`),
    loadJson(`${EXAMPLE_ROOT}/layout.json`)
  ]);
  if (layout.modelId !== loadedModel.id) {
    throw new Error(`Layout ${layout.id} belongs to ${layout.modelId}, not ${loadedModel.id}`);
  }

  const registry = definitionRegistry();
  const battery = loadedModel.components.find(
    (component) => component.type === "electrical.battery"
  );
  if (!battery) {
    throw new Error("The example requires one battery for its dispatch policy");
  }
  const policy = createPvBatterySelfConsumptionPolicy({ batteryComponentId: battery.id });

  function execute(model) {
    const run = runScenario({ model, scenario, registry, policy });
    if (!run.completed) {
      throw runtimeFailure(run);
    }
    return run;
  }

  let workingModel = loadedModel;
  let baselineRun = execute(workingModel);
  let activeModel = workingModel;
  let activeRun = baselineRun;
  let pendingModel = null;
  let selectedComponentId = battery.id;
  let highlightedConnectionId = null;
  let stepIndex = Math.floor(activeRun.results.steps.length / 2);
  let previewDiagnostics = [];
  let previewReady = false;
  let schedulerState = { running: false, pending: false, latestRequestId: 0 };
  const previewOverrides = new Map();
  let view;
  let topology;
  let inspector;
  let resultsChart;
  let chartModel;
  let chartModelSource = null;
  let chartResultsSource = null;

  function overrideList() {
    return [...previewOverrides.values()];
  }

  function createView() {
    return createWorkbenchView({
      model: activeModel,
      registry,
      results: activeRun.results,
      stepIndex,
      parameterOverrides: overrideList()
    });
  }

  function selectedComponent() {
    const component = view.components.find(
      (candidate) => candidate.id === selectedComponentId
    );
    if (!component) {
      throw new Error(`View does not contain component: ${selectedComponentId}`);
    }
    return component;
  }

  function updateChart() {
    if (!resultsChart) {
      return;
    }
    if (activeModel !== chartModelSource || activeRun.results !== chartResultsSource) {
      chartModel = createResultsChartModel({
        model: activeModel,
        registry,
        results: activeRun.results
      });
      chartModelSource = activeModel;
      chartResultsSource = activeRun.results;
    }
    resultsChart.update({
      model: chartModel,
      stepIndex,
      selectedComponentId,
      highlightedConnectionId
    });
  }

  function selectStep(nextStepIndex) {
    if (
      !Number.isInteger(nextStepIndex) ||
      nextStepIndex < 0 ||
      nextStepIndex >= activeRun.results.steps.length ||
      nextStepIndex === stepIndex
    ) {
      return;
    }
    stepIndex = nextStepIndex;
    element("timeline").value = String(stepIndex);
    updateResultViews();
  }

  function highlightConnection(connectionId) {
    if (connectionId === highlightedConnectionId) {
      return;
    }
    highlightedConnectionId = connectionId;
    topology?.update();
    updateChart();
  }

  function previewState(rebuildParameters = false) {
    const previewCount = previewOverrides.size;
    const busy = previewCount > 0 && (schedulerState.running || schedulerState.pending);
    return {
      rebuildParameters,
      previewKeys: new Set(previewOverrides.keys()),
      previewCount,
      busy,
      diagnostics: previewDiagnostics,
      canApply: previewReady && !busy
    };
  }

  function setRunStatus() {
    const status = element("run-status");
    status.classList.remove(
      "run-status--complete",
      "run-status--preview",
      "run-status--error"
    );
    let message;
    let statusClass;
    if (previewOverrides.size === 0) {
      message = `${activeRun.results.steps.length.toLocaleString("en-GB")} timesteps ready`;
      statusClass = "run-status--complete";
    } else if (previewDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      message = "Preview needs attention";
      statusClass = "run-status--error";
    } else if (schedulerState.running || schedulerState.pending) {
      message = "Updating preview…";
      statusClass = "run-status--preview";
    } else if (previewReady) {
      message = `Preview · ${activeRun.results.steps.length.toLocaleString("en-GB")} timesteps`;
      statusClass = "run-status--preview";
    } else {
      message = "Preview unavailable";
      statusClass = "run-status--error";
    }
    status.classList.add(statusClass);
    status.lastChild.textContent = ` ${message}`;
  }

  function updateInspector(rebuildParameters = false) {
    inspector.render(selectedComponent(), previewState(rebuildParameters));
  }

  function updateResultViews({ rebuildParameters = false, updateTopology = true } = {}) {
    view = createView();
    element("timeline-label").textContent = view.timelineLabel;
    element("summary-time").textContent = view.timelineLabel.split(" · ")[0];
    element("timeline").value = String(stepIndex);
    if (updateTopology) {
      topology.update();
    }
    updateInspector(rebuildParameters);
    updateChart();
    setRunStatus();
  }

  function updatePreviewChrome() {
    if (!view || !inspector) {
      return;
    }
    view = createView();
    updateInspector();
    setRunStatus();
  }

  const scheduler = createPreviewRunScheduler({
    run({ model, diagnostics }) {
      const run = execute(model);
      return {
        model,
        run,
        diagnostics: uniqueDiagnostics([...diagnostics, ...run.diagnostics])
      };
    },
    onResult(result) {
      activeModel = result.model;
      activeRun = result.run;
      pendingModel = result.model;
      previewDiagnostics = result.diagnostics;
      previewReady = true;
      updateResultViews();
    },
    onError(error) {
      previewDiagnostics = uniqueDiagnostics(error.diagnostics ?? [{
        severity: "error",
        code: "ui.preview-run",
        path: "",
        message: error.message
      }]);
      previewReady = false;
      updatePreviewChrome();
    },
    onStateChange(state) {
      schedulerState = state;
      if (view && inspector) {
        setRunStatus();
      }
    },
    onCallbackError(error) {
      console.error("Preview presentation callback failed", error);
    }
  });

  function restoreBaseline({ rebuildParameters = false } = {}) {
    previewOverrides.clear();
    pendingModel = null;
    previewDiagnostics = baselineRun.diagnostics;
    previewReady = false;
    activeModel = workingModel;
    activeRun = baselineRun;
    scheduler.invalidate();
    updateResultViews({ rebuildParameters });
  }

  function requestPreview({ componentId, parameter, value }) {
    const key = parameterOverrideKey(componentId, parameter);
    const workingValue = resolvedParameterValue({
      model: workingModel,
      registry,
      componentId,
      parameter
    });
    if (value === workingValue) {
      previewOverrides.delete(key);
    } else {
      previewOverrides.set(key, { componentId, parameter, value });
    }

    if (previewOverrides.size === 0) {
      restoreBaseline();
      return;
    }

    previewReady = false;
    const candidate = applyParameterOverrides({
      model: workingModel,
      registry,
      overrides: overrideList()
    });
    previewDiagnostics = uniqueDiagnostics(candidate.diagnostics);
    if (!candidate.applied) {
      pendingModel = null;
      scheduler.invalidate();
      updatePreviewChrome();
      return;
    }

    pendingModel = candidate.model;
    scheduler.request({
      model: candidate.model,
      diagnostics: candidate.diagnostics
    });
    updatePreviewChrome();
  }

  function resetPreview() {
    if (previewOverrides.size > 0) {
      restoreBaseline({ rebuildParameters: true });
    }
  }

  function applyPreview() {
    const busy = schedulerState.running || schedulerState.pending;
    if (previewOverrides.size === 0 || busy || !previewReady || activeModel !== pendingModel) {
      return;
    }
    const applied = applyParameterOverrides({
      model: workingModel,
      registry,
      overrides: overrideList()
    });
    if (!applied.applied) {
      previewDiagnostics = uniqueDiagnostics(applied.diagnostics);
      previewReady = false;
      updatePreviewChrome();
      return;
    }

    workingModel = applied.model;
    baselineRun = activeRun;
    activeModel = workingModel;
    previewOverrides.clear();
    pendingModel = null;
    previewDiagnostics = uniqueDiagnostics([
      ...applied.diagnostics,
      ...baselineRun.diagnostics
    ]);
    previewReady = false;
    scheduler.invalidate();
    updateResultViews({ rebuildParameters: true });
  }

  view = createView();
  inspector = createComponentInspector({
    target: element("inspector"),
    onParameterInput: requestPreview,
    onReset: resetPreview,
    onApply: applyPreview
  });
  resultsChart = createResultsChart({
    target: element("results-chart"),
    legendTarget: element("results-chart-legend"),
    powerButton: element("show-power-chart"),
    energyButton: element("show-energy-chart"),
    headingTarget: element("results-chart-title"),
    onStepChange: selectStep,
    onHighlightConnection: highlightConnection
  });
  topology = createTopologyBoard({
    targetId: "topology-board",
    model: workingModel,
    layout,
    getView(componentId) {
      if (!componentId) {
        return { ...view, highlightedConnectionId };
      }
      const component = view.components.find((candidate) => candidate.id === componentId);
      if (!component) {
        throw new Error(`View does not contain component: ${componentId}`);
      }
      const highlightedConnection = view.connections.find(
        (connection) => connection.id === highlightedConnectionId
      );
      const highlighted = highlightedConnection !== undefined && (
        highlightedConnection.fromComponentId === componentId ||
        highlightedConnection.toComponentId === componentId
      );
      return {
        component,
        selected: componentId === selectedComponentId,
        highlighted
      };
    },
    onSelect(componentId) {
      selectedComponentId = componentId;
      topology.update();
      updateInspector();
      updateChart();
    },
    onConnectionHighlight: highlightConnection
  });

  const timeline = element("timeline");
  timeline.max = String(activeRun.results.steps.length - 1);
  timeline.value = String(stepIndex);
  timeline.disabled = false;
  timeline.addEventListener("input", () => {
    selectStep(Number(timeline.value));
  });

  element("model-name").textContent = workingModel.name;
  element("scenario-name").textContent = scenario.name;
  element("summary-topology").textContent = `${workingModel.components.length} components · ${workingModel.connections.length} connections`;
  previewDiagnostics = baselineRun.diagnostics;
  updateResultViews({ rebuildParameters: true });
}

startWorkbench().catch(showFatalError);
