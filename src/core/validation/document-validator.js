import Ajv2020 from "ajv/dist/2020.js";

import commonSchema from "../schemas/common.schema.json" with { type: "json" };
import layoutSchema from "../schemas/layout.schema.json" with { type: "json" };
import modelSchema from "../schemas/model.schema.json" with { type: "json" };
import runProvenanceSchema from "../schemas/run-provenance.schema.json" with { type: "json" };
import scenarioSchema from "../schemas/scenario.schema.json" with { type: "json" };
import variantSchema from "../schemas/variant.schema.json" with { type: "json" };
import { createDiagnostic, createValidationResult } from "./validation-result.js";

const schemasByDocumentType = new Map([
  ["model", modelSchema],
  ["scenario", scenarioSchema],
  ["layout", layoutSchema],
  ["variant", variantSchema],
  ["run-provenance", runProvenanceSchema]
]);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(commonSchema);
for (const schema of schemasByDocumentType.values()) {
  ajv.addSchema(schema);
}

const validatorsByDocumentType = new Map(
  [...schemasByDocumentType].map(([documentType, schema]) => [
    documentType,
    ajv.getSchema(schema.$id)
  ])
);

function getValidator(documentType) {
  const validator = validatorsByDocumentType.get(documentType);
  if (!validator) {
    throw new TypeError(`Unknown document type: ${documentType}`);
  }
  return validator;
}

function escapeJsonPointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function errorPath(error) {
  if (error.keyword !== "additionalProperties") {
    return error.instancePath;
  }

  const property = escapeJsonPointer(error.params.additionalProperty);
  return `${error.instancePath}/${property}`;
}

export function validateDocumentStructure(documentType, document) {
  const validator = getValidator(documentType);
  if (validator(document)) {
    return createValidationResult();
  }

  const diagnostics = validator.errors.map((error) => createDiagnostic({
    code: `schema.${error.keyword}`,
    message: error.message ?? "Document does not match its schema",
    path: errorPath(error)
  }));

  return createValidationResult(diagnostics);
}

export function parseJsonDocument(documentType, text) {
  getValidator(documentType);

  if (typeof text !== "string") {
    return {
      document: null,
      ...createValidationResult([
        createDiagnostic({
          code: "json.expected-text",
          message: "JSON input must be a string"
        })
      ])
    };
  }

  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return {
      document: null,
      ...createValidationResult([
        createDiagnostic({
          code: "json.parse",
          message: error.message
        })
      ])
    };
  }

  return {
    document,
    ...validateDocumentStructure(documentType, document)
  };
}
