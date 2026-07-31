import assert from "node:assert/strict";
import test from "node:test";

import {
  parseJsonDocument,
  validateDocumentStructure
} from "../../src/core/validation/document-validator.js";

const model = {
  schemaVersion: "0.1.0",
  id: "model.test",
  name: "Test model",
  components: [
    {
      id: "source",
      type: "electrical.source",
      definitionVersion: "0.1.0",
      name: "Source",
      parameters: {},
      initialState: {}
    }
  ],
  connections: []
};

test("JSON document parser returns a structurally validated document", () => {
  const result = parseJsonDocument("model", JSON.stringify(model));

  assert.equal(result.valid, true);
  assert.deepEqual(result.document, model);
  assert.deepEqual(result.diagnostics, []);
});

test("JSON document parser reports syntax errors without throwing", () => {
  const result = parseJsonDocument("model", "{ not json }");

  assert.equal(result.valid, false);
  assert.equal(result.document, null);
  assert.equal(result.diagnostics[0].code, "json.parse");
});

test("structural validation is strict and identifies unknown properties", () => {
  const invalid = structuredClone(model);
  invalid.components[0].layout = { x: 20, y: 40 };

  const result = validateDocumentStructure("model", invalid);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "schema.additionalProperties");
  assert.equal(result.diagnostics[0].path, "/components/0/layout");
});

test("unknown document types are programmer errors", () => {
  assert.throws(
    () => validateDocumentStructure("unknown", {}),
    /Unknown document type/u
  );
});
