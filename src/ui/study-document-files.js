import { cloneJsonValue } from "../core/json-value.js";
import { parseJsonDocument } from
  "../core/validation/document-validator.js";
import { validateModel } from "../core/validation/validate-documents.js";
import {
  createDiagnostic,
  createValidationResult
} from "../core/validation/validation-result.js";

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function stableIdSegment(value) {
  const segment = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return segment || "alternative";
}

function modelCompatibilityDiagnostics(model, referenceModel) {
  const diagnostics = [];
  if (model.id !== referenceModel.id) {
    diagnostics.push(createDiagnostic({
      code: "ui.model-file.model-id",
      message: `Model ${model.id} does not match the open workspace model ${referenceModel.id}`,
      path: "/id"
    }));
  }

  const referenceComponentsById = new Map(referenceModel.components.map((component) => [
    component.id,
    component
  ]));
  const importedComponentIds = new Set(model.components.map((component) => component.id));

  for (const component of model.components) {
    const reference = referenceComponentsById.get(component.id);
    if (!reference) {
      diagnostics.push(createDiagnostic({
        code: "ui.model-file.component-set",
        message: `The open layout does not contain component ${component.id}`,
        path: "/components"
      }));
      continue;
    }
    if (
      component.type !== reference.type ||
      component.definitionVersion !== reference.definitionVersion
    ) {
      diagnostics.push(createDiagnostic({
        code: "ui.model-file.component-definition",
        message: `Component ${component.id} must remain ${reference.type}@${reference.definitionVersion}`,
        path: "/components"
      }));
    }
  }

  for (const component of referenceModel.components) {
    if (!importedComponentIds.has(component.id)) {
      diagnostics.push(createDiagnostic({
        code: "ui.model-file.component-set",
        message: `The imported model is missing layout component ${component.id}`,
        path: "/components"
      }));
    }
  }
  return diagnostics;
}

export function parseWorkbenchModel(text, { registry, referenceModel } = {}) {
  if (!registry || !referenceModel) {
    throw new TypeError("A registry and reference model are required");
  }

  const parsed = parseJsonDocument("model", text);
  if (!parsed.valid) {
    return { model: null, valid: false, diagnostics: parsed.diagnostics };
  }

  const modelValidation = validateModel(parsed.document, { registry });
  const diagnostics = [
    ...modelValidation.diagnostics,
    ...modelCompatibilityDiagnostics(parsed.document, referenceModel)
  ];
  const validation = createValidationResult(diagnostics);
  return {
    model: validation.valid ? parsed.document : null,
    ...validation
  };
}

export function createParameterVariant({ model, name, overrides } = {}) {
  if (!model || typeof model.id !== "string") {
    throw new TypeError("A model is required");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("A variant name is required");
  }
  if (!Array.isArray(overrides) || overrides.length === 0) {
    throw new TypeError("At least one parameter override is required");
  }

  const trimmedName = name.trim();
  const baseId = model.id
    .replace(/^model[._-]/u, "")
    .slice(0, 80)
    .replace(/[-_.]+$/u, "");
  const idPrefix = `variant.${baseId}.`;
  const maximumSegmentLength = 128 - idPrefix.length;
  const nameSegment = stableIdSegment(trimmedName)
    .slice(0, maximumSegmentLength)
    .replace(/[-_.]+$/u, "") || "alternative";
  const parameterOverrides = cloneJsonValue(overrides).sort((left, right) =>
    compareText(
      `${left.componentId}\u0000${left.parameter}`,
      `${right.componentId}\u0000${right.parameter}`
    )
  );

  return {
    schemaVersion: "0.1.0",
    id: `${idPrefix}${nameSegment}`,
    name: trimmedName,
    baseModelId: model.id,
    parameterOverrides
  };
}

export function serialiseJsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function downloadJsonDocument(value) {
  if (!value || typeof value.id !== "string") {
    throw new TypeError("A document with an ID is required");
  }
  const filename = `${value.id}.json`;
  const url = URL.createObjectURL(new Blob(
    [serialiseJsonDocument(value)],
    { type: "application/json" }
  ));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
  return filename;
}
