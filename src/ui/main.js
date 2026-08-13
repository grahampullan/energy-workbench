import { electricalBatteryDefinition } from "../components/electrical/battery.js";
import { electricalBusDefinition } from "../components/electrical/bus.js";
import { electricalGridDefinition } from "../components/electrical/grid.js";
import { electricalLoadDefinition } from "../components/electrical/load.js";
import { electricalPvDefinition } from "../components/electrical/pv.js";
import { electricalSourceDefinition } from "../components/electrical/source.js";
import { createComponentRegistry } from "../core/component-registry.js";
import { validateVariant } from "../core/validation/validate-documents.js";
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
import {
  createParameterVariant,
  downloadJsonDocument,
  parseWorkbenchModel
} from "./study-document-files.js";
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

function diagnosticsMessage(diagnostics) {
  const diagnostic = diagnostics.find((candidate) => candidate.severity === "error") ??
    diagnostics[0];
  if (!diagnostic) {
    return "The document could not be used";
  }
  return diagnostic.path
    ? `${diagnostic.path}: ${diagnostic.message}`
    : diagnostic.message;
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
  const grid = loadedModel.components.find(
    (component) => component.type === "electrical.grid"
  );
  if (!battery || !grid) {
    throw new Error("The example requires one battery and one balancing grid");
  }
  const policy = createPvBatterySelfConsumptionPolicy({
    batteryComponentId: battery.id,
    balancingComponentId: grid.id
  });

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

  function setDocumentStatus(message, { error = false } = {}) {
    const status = element("document-status");
    status.textContent = message;
    status.dataset.error = String(error);
  }

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
    element("summary-time").textContent = view.timelineLabel;
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
        inspector.updatePreview(previewState());
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

  function saveWorkingModel() {
    const filename = downloadJsonDocument(workingModel);
    const previewNote = previewOverrides.size > 0
      ? "; temporary preview changes were not included"
      : "";
    setDocumentStatus(`Downloaded ${filename}${previewNote}`);
  }

  function savePreviewVariant() {
    const suggestedName = `${workingModel.name} alternative`;
    const name = window.prompt("Name this variant", suggestedName);
    if (name === null) {
      return;
    }

    let variant;
    try {
      variant = createParameterVariant({
        model: workingModel,
        name,
        overrides: overrideList()
      });
    } catch (error) {
      setDocumentStatus(error.message, { error: true });
      return;
    }
    const validation = validateVariant(variant, { model: workingModel, registry });
    if (!validation.valid) {
      setDocumentStatus(diagnosticsMessage(validation.diagnostics), { error: true });
      return;
    }

    const filename = downloadJsonDocument(variant);
    setDocumentStatus(`Downloaded ${filename}; the preview remains temporary`);
  }

  function replaceWorkingModel(model, sourceName) {
    const run = execute(model);
    scheduler.invalidate();
    previewOverrides.clear();
    workingModel = model;
    baselineRun = run;
    activeModel = model;
    activeRun = run;
    pendingModel = null;
    previewDiagnostics = run.diagnostics;
    previewReady = false;
    highlightedConnectionId = null;
    stepIndex = Math.min(stepIndex, run.results.steps.length - 1);
    element("model-name").textContent = model.name;
    element("summary-topology").textContent =
      `${model.components.length} components · ${model.connections.length} connections`;
    updateResultViews({ rebuildParameters: true });
    setDocumentStatus(`Loaded ${sourceName}`);
  }

  async function openWorkingModel(file) {
    let text;
    try {
      text = await file.text();
    } catch (error) {
      setDocumentStatus(`Could not read ${file.name}: ${error.message}`, { error: true });
      return;
    }
    const imported = parseWorkbenchModel(text, {
      registry,
      referenceModel: loadedModel
    });
    if (!imported.valid) {
      setDocumentStatus(
        `Could not load ${file.name}: ${diagnosticsMessage(imported.diagnostics)}`,
        { error: true }
      );
      return;
    }

    try {
      replaceWorkingModel(imported.model, file.name);
    } catch (error) {
      setDocumentStatus(
        `Could not run ${file.name}: ${diagnosticsMessage(error.diagnostics ?? [{
          severity: "error",
          message: error.message
        }])}`,
        { error: true }
      );
    }
  }

  view = createView();
  inspector = createComponentInspector({
    target: element("inspector"),
    onParameterInput: requestPreview,
    onReset: resetPreview,
    onApply: applyPreview,
    onSaveVariant: savePreviewVariant
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

  const modelFileInput = element("open-model-file");
  element("open-model").addEventListener("click", () => modelFileInput.click());
  modelFileInput.addEventListener("change", async () => {
    const [file] = modelFileInput.files;
    if (file) {
      await openWorkingModel(file);
    }
    modelFileInput.value = "";
  });
  element("save-model").addEventListener("click", saveWorkingModel);

  element("model-name").textContent = workingModel.name;
  element("scenario-name").textContent = scenario.name;
  element("summary-topology").textContent = `${workingModel.components.length} components · ${workingModel.connections.length} connections`;
  previewDiagnostics = baselineRun.diagnostics;
  updateResultViews({ rebuildParameters: true });
  setDocumentStatus("Example model loaded; layout changes remain temporary");
}

startWorkbench().catch(showFatalError);
