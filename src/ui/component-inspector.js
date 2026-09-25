import { bindNumberParameterControls } from "./board-box-adapter.js";
import { formatEngineeringValue } from "./engineering-format.js";
import { parameterOverrideKey } from "./preview-model.js";

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

function editableField(field) {
  return typeof field.value === "number" &&
    field.editor !== null &&
    Number.isFinite(field.editor.minimum) &&
    Number.isFinite(field.editor.maximum) &&
    Number.isFinite(field.editor.step) &&
    field.editor.step > 0;
}

function visibleUnit(unit) {
  return unit === "1" || unit === "scenario-series-id" ? "" : unit;
}

export function createComponentInspector({
  target,
  onParameterInput,
  onReset,
  onApply,
  onSaveVariant
}) {
  let selectedComponentId = null;
  let bindings = [];
  let parameterRowsByKey = new Map();
  let liveResult;
  let timestep;
  let resultSections;
  let previewStatus;
  let resetButton;
  let applyButton;
  let saveVariantButton;
  let diagnosticsHeading;
  let diagnosticsView;

  function disposeBindings() {
    bindings.forEach((binding) => binding.dispose());
    bindings = [];
  }

  function parameterControl(component, field) {
    const key = parameterOverrideKey(component.id, field.id);
    const control = document.createElement("div");
    control.className = "parameter-control";
    control.dataset.parameterKey = key;

    const heading = document.createElement("div");
    heading.className = "parameter-control-heading";
    const label = document.createElement("label");
    const inputId = `parameter-${component.id}-${field.id}`;
    label.htmlFor = inputId;
    label.textContent = field.label;
    const previewTag = document.createElement("span");
    previewTag.className = "parameter-preview-tag";
    previewTag.textContent = "Preview";
    heading.append(label, previewTag);

    const inputs = document.createElement("div");
    inputs.className = "parameter-inputs";
    const rangeInput = document.createElement("input");
    rangeInput.id = inputId;
    rangeInput.type = "range";
    rangeInput.min = String(field.editor.minimum);
    rangeInput.max = String(field.editor.maximum);
    rangeInput.step = String(field.editor.step);
    rangeInput.setAttribute("aria-label", `${field.label} slider`);

    const numberGroup = document.createElement("div");
    numberGroup.className = "parameter-number-group";
    const numberInput = document.createElement("input");
    numberInput.type = "number";
    numberInput.min = String(field.editor.minimum);
    numberInput.max = String(field.editor.maximum);
    numberInput.step = String(field.editor.step);
    numberInput.setAttribute("aria-label", `${field.label} numeric value`);
    const unit = document.createElement("span");
    unit.textContent = visibleUnit(field.unit);
    numberGroup.append(numberInput, unit);
    inputs.append(rangeInput, numberGroup);
    control.append(heading, inputs);

    bindings.push(bindNumberParameterControls({
      rangeInput,
      numberInput,
      initialValue: field.value,
      formatValue: (value) => formatEngineeringValue(value, field.unit),
      onChange(value, { final }) {
        onParameterInput({
          componentId: component.id,
          parameter: field.id,
          value,
          final
        });
      }
    }));
    parameterRowsByKey.set(key, control);
    return control;
  }

  function parameterGroup(component, group) {
    const section = document.createElement("section");
    section.className = "inspector-section parameter-group";
    const heading = document.createElement("h3");
    heading.textContent = group.label;
    section.append(heading);

    const readOnlyFields = [];
    for (const field of group.fields) {
      if (editableField(field)) {
        section.append(parameterControl(component, field));
      } else {
        readOnlyFields.push(field);
      }
    }
    if (readOnlyFields.length > 0) {
      section.append(descriptionList(readOnlyFields));
    }
    return section;
  }

  function build(component) {
    disposeBindings();
    parameterRowsByKey = new Map();
    target.className = "inspector-content";
    target.dataset.visualRole = component.visualRole;
    target.replaceChildren();

    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `${component.type} · v${component.definitionVersion}`;
    const heading = document.createElement("h3");
    heading.className = "inspector-component-title";
    heading.textContent = component.name;
    const definitionName = document.createElement("p");
    definitionName.className = "inspector-definition";
    definitionName.textContent = component.definitionName;
    timestep = document.createElement("p");
    timestep.className = "inspector-timestep";

    liveResult = document.createElement("div");
    liveResult.className = "inspector-live-result";
    liveResult.append(document.createElement("span"), document.createElement("strong"));
    target.append(eyebrow, heading, definitionName, timestep, liveResult);

    for (const group of component.parameterGroups) {
      target.append(parameterGroup(component, group));
    }

    const actions = document.createElement("section");
    actions.className = "preview-actions";
    previewStatus = document.createElement("p");
    previewStatus.className = "preview-status";
    const buttons = document.createElement("div");
    buttons.className = "preview-buttons";
    resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "secondary-button";
    resetButton.textContent = "Reset preview";
    resetButton.addEventListener("click", onReset);
    applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "primary-button";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", onApply);
    saveVariantButton = document.createElement("button");
    saveVariantButton.type = "button";
    saveVariantButton.className = "secondary-button";
    saveVariantButton.textContent = "Save variant";
    saveVariantButton.addEventListener("click", onSaveVariant);
    buttons.append(resetButton, applyButton, saveVariantButton);
    diagnosticsHeading = document.createElement("p");
    diagnosticsHeading.className = "preview-diagnostics-heading";
    diagnosticsHeading.textContent = "Selected timestep";
    diagnosticsView = document.createElement("ul");
    diagnosticsView.className = "preview-diagnostics";
    actions.append(previewStatus, buttons, diagnosticsHeading, diagnosticsView);
    target.append(actions);

    resultSections = document.createElement("div");
    resultSections.className = "inspector-results";
    target.append(resultSections);
    selectedComponentId = component.id;
  }

  function updateResults(component) {
    timestep.textContent = component.timestepLabel;
    liveResult.dataset.powerTone = component.powerTone;
    liveResult.querySelector("span").textContent = component.metric.label;
    liveResult.querySelector("strong").textContent = component.metric.displayValue;
    resultSections.replaceChildren();
    for (const [title, fields] of [
      ["Operation during timestep", component.operationFields],
      ["Timestep results", component.outputFields],
      ["State at timestep end", component.stateFields]
    ]) {
      const section = inspectorSection(title, fields);
      if (section) {
        resultSections.append(section);
      }
    }
  }

  function updatePreviewState({ previewKeys, previewCount, busy, diagnostics, canApply }) {
    for (const [key, row] of parameterRowsByKey) {
      row.dataset.preview = String(previewKeys.has(key));
    }
    resetButton.disabled = previewCount === 0;
    applyButton.disabled = previewCount === 0 || busy || !canApply;
    saveVariantButton.disabled = previewCount === 0 || busy || !canApply;
    previewStatus.textContent = busy
      ? "Updating preview…"
      : previewCount === 0
        ? "No temporary changes"
        : `${previewCount} temporary ${previewCount === 1 ? "change" : "changes"}`;

    diagnosticsView.replaceChildren();
    for (const diagnostic of diagnostics) {
      const item = document.createElement("li");
      item.dataset.severity = diagnostic.severity;
      const title = document.createElement("strong");
      title.textContent = diagnostic.title;
      const message = document.createElement("span");
      message.textContent = diagnostic.message;
      item.append(title, message);
      diagnosticsView.append(item);
    }
    diagnosticsHeading.hidden = diagnostics.length === 0;
    diagnosticsHeading.textContent = diagnostics.some(
      (diagnostic) => diagnostic.severity === "error"
    ) ? "Messages" : "Selected timestep";
    diagnosticsView.hidden = diagnostics.length === 0;
  }

  function render(component, state) {
    if (selectedComponentId !== component.id || state.rebuildParameters) {
      build(component);
    }
    updateResults(component);
    updatePreviewState(state);
  }

  function dispose() {
    disposeBindings();
    target.replaceChildren();
  }

  return Object.freeze({
    render,
    updatePreview: updatePreviewState,
    dispose
  });
}
