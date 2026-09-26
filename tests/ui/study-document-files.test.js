import assert from "node:assert/strict";
import test from "node:test";

import { electricalBatteryDefinition } from
  "../../src/components/electrical/battery.js";
import { electricalBusDefinition } from
  "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from
  "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from
  "../../src/components/electrical/load.js";
import { electricalPvDefinition } from
  "../../src/components/electrical/pv.js";
import { createComponentRegistry } from
  "../helpers/registry.js";
import { validateVariant } from
  "../../src/core/validation/validate-documents.js";
import {
  createParameterVariant,
  parseWorkbenchModel,
  serialiseJsonDocument
} from "../../src/ui/study-document-files.js";

const registry = createComponentRegistry([
  electricalBatteryDefinition,
  electricalBusDefinition,
  electricalGridDefinition,
  electricalLoadDefinition,
  electricalPvDefinition
]);

const model = {
  schemaVersion: "0.1.0",
  id: "model.test",
  name: "Test model",
  components: [{
    id: "battery",
    type: "electrical.battery",
    definitionVersion: "0.2.0",
    name: "Battery",
    parameters: { capacitykWh: 5 },
    initialState: { storedEnergykWh: 0 }
  }],
  connections: []
};

test("working-model files round trip through canonical formatted JSON", () => {
  const text = serialiseJsonDocument(model);
  const result = parseWorkbenchModel(text, { registry, referenceModel: model });

  assert.equal(text.endsWith("\n"), true);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.model, model);
});

test("model import rejects invalid JSON and a different workspace shape", () => {
  const malformed = parseWorkbenchModel("{not json}", {
    registry,
    referenceModel: model
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.diagnostics[0].code, "json.parse");

  const incompatible = structuredClone(model);
  incompatible.id = "model.other";
  incompatible.components[0].id = "other-battery";
  const result = parseWorkbenchModel(JSON.stringify(incompatible), {
    registry,
    referenceModel: model
  });

  assert.equal(result.valid, false);
  assert.equal(result.model, null);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "ui.model-file.model-id"
  ));
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "ui.model-file.component-set"
  ));
});

test("saved preview variant is deterministic, detached, and valid", () => {
  const overrides = [
    { componentId: "battery", parameter: "maximumChargePowerkW", value: 4 },
    { componentId: "battery", parameter: "capacitykWh", value: 8 }
  ];
  const variant = createParameterVariant({
    model,
    name: "Larger battery — option A",
    overrides
  });

  overrides[0].value = 99;
  assert.equal(variant.id, "variant.test.larger-battery-option-a");
  assert.deepEqual(
    variant.parameterOverrides.map((override) => override.parameter),
    ["capacitykWh", "maximumChargePowerkW"]
  );
  assert.equal(variant.parameterOverrides[1].value, 4);
  const validation = validateVariant(variant, { model, registry });
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
});

test("variant creation requires an intentional name and at least one override", () => {
  assert.throws(
    () => createParameterVariant({ model, name: " ", overrides: [{}] }),
    /variant name/u
  );
  assert.throws(
    () => createParameterVariant({ model, name: "Option", overrides: [] }),
    /parameter override/u
  );
});
