import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const schemaNames = [
  "common",
  "model",
  "scenario",
  "layout",
  "variant",
  "run-provenance"
];

const schemas = await Promise.all(
  schemaNames.map(async (name) => {
    const url = new URL(`../../src/core/schemas/${name}.schema.json`, import.meta.url);
    return JSON.parse(await readFile(url, "utf8"));
  })
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of schemas) {
  ajv.addSchema(schema);
}

const schemaIds = {
  model: "urn:energy-workbench:schema:model:0.1.0",
  scenario: "urn:energy-workbench:schema:scenario:0.1.0",
  layout: "urn:energy-workbench:schema:layout:0.1.0",
  variant: "urn:energy-workbench:schema:variant:0.1.0",
  runProvenance: "urn:energy-workbench:schema:run-provenance:0.1.0"
};

const model = {
  schemaVersion: "0.1.0",
  id: "model.blog-electrical",
  name: "Blog electrical model",
  components: [
    {
      id: "grid-supply",
      type: "electrical.grid-supply",
      definitionVersion: "0.1.0",
      name: "Grid supply",
      parameters: {},
      initialState: {}
    },
    {
      id: "electrical-load",
      type: "electrical.load",
      definitionVersion: "0.1.0",
      name: "Electrical load",
      parameters: { profileId: "load-power" },
      initialState: {}
    }
  ],
  connections: [
    {
      id: "grid-to-load",
      name: "Grid to load",
      from: { componentId: "grid-supply", portId: "electricity-out" },
      to: { componentId: "electrical-load", portId: "electricity-in" }
    }
  ]
};

const scenario = {
  schemaVersion: "0.1.0",
  id: "scenario.reference-day",
  name: "Reference day",
  time: {
    timeStepSeconds: 60,
    stepCount: 3
  },
  series: [
    {
      id: "load-power",
      name: "Load power",
      unit: "kW",
      data: { kind: "inline", values: [0.5, 0.75, 0.6] }
    }
  ]
};

const layout = {
  schemaVersion: "0.1.0",
  id: "layout.blog-electrical",
  modelId: "model.blog-electrical",
  components: [
    { componentId: "grid-supply", x: 20, y: 200 },
    { componentId: "electrical-load", x: 400, y: 40, width: 120, height: 80 }
  ]
};

const variant = {
  schemaVersion: "0.1.0",
  id: "variant.double-load",
  name: "Double load",
  baseModelId: "model.blog-electrical",
  parameterOverrides: [
    { componentId: "electrical-load", parameter: "profileMultiplier", value: 2 }
  ]
};

const runProvenance = {
  schemaVersion: "0.1.0",
  runId: "run.blog-electrical-001",
  createdAt: "2026-07-31T15:30:00Z",
  model: { documentId: model.id, sha256: "a".repeat(64) },
  scenario: { documentId: scenario.id, sha256: "b".repeat(64) },
  variant: { documentId: variant.id, sha256: "c".repeat(64) },
  policy: { id: "policy.self-consumption", version: "0.1.0" },
  runtime: { name: "energy-workbench", version: "0.0.0", environment: "node" },
  options: {}
};

function validationMessage(validate) {
  return ajv.errorsText(validate.errors, { separator: "\n" });
}

function assertValid(schemaId, value) {
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `Schema is registered: ${schemaId}`);
  assert.equal(validate(value), true, validationMessage(validate));
}

function assertInvalid(schemaId, value) {
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `Schema is registered: ${schemaId}`);
  assert.equal(validate(value), false, "Expected structural validation to fail");
}

test("all project schemas compile in strict JSON Schema 2020-12 mode", () => {
  for (const schemaId of Object.values(schemaIds)) {
    assert.ok(ajv.getSchema(schemaId), `Schema compiles: ${schemaId}`);
  }
});

test("model schema accepts stable component and connection documents", () => {
  assertValid(schemaIds.model, model);

  const invalid = structuredClone(model);
  delete invalid.connections[0].to.portId;
  assertInvalid(schemaIds.model, invalid);
});

test("scenario schema accepts inline and external CSV series", () => {
  assertValid(schemaIds.scenario, scenario);

  const external = structuredClone(scenario);
  external.series[0].data = {
    kind: "csv-column",
    path: "data/reference-day.csv",
    timeColumn: "timestamp",
    valueColumn: "load_kw"
  };
  assertValid(schemaIds.scenario, external);

  external.series[0].data.path = "/absolute/path.csv";
  assertInvalid(schemaIds.scenario, external);
});

test("layout schema contains presentation geometry but rejects engineering data", () => {
  assertValid(schemaIds.layout, layout);

  const invalid = structuredClone(layout);
  invalid.components[0].parameters = { powerKw: 100 };
  assertInvalid(schemaIds.layout, invalid);
});

test("variant schema is limited to explicit parameter overrides", () => {
  assertValid(schemaIds.variant, variant);

  const invalid = structuredClone(variant);
  invalid.parameterOverrides[0].connectionId = "new-connection";
  assertInvalid(schemaIds.variant, invalid);
});

test("run provenance schema records hashed inputs and execution identity", () => {
  assertValid(schemaIds.runProvenance, runProvenance);

  const invalid = structuredClone(runProvenance);
  invalid.model.sha256 = "not-a-sha256";
  assertInvalid(schemaIds.runProvenance, invalid);
});
