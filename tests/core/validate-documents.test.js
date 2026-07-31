import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../../src/core/component-registry.js";
import {
  validateLayout,
  validateModel,
  validateScenario,
  validateVariant
} from "../../src/core/validation/validate-documents.js";
import { createTestComponentDefinition } from "../helpers/component-definition.js";

const sourceDefinition = createTestComponentDefinition({
  type: "electrical.source",
  name: "Electrical source",
  parameters: {
    ratedPowerKw: {
      unit: "kW",
      default: 100,
      hardBounds: { minimum: 0, maximum: 500 },
      validityRange: { minimum: 10, maximum: 400 }
    }
  },
  ports: [
    { id: "electricity-out", medium: "electricity.active-power", direction: "out" }
  ],
  outputs: {
    powerKw: { unit: "kW" }
  }
});

const loadDefinition = createTestComponentDefinition({
  type: "electrical.load",
  name: "Electrical load",
  parameters: {
    profileMultiplier: {
      unit: "1",
      default: 1,
      hardBounds: { minimum: 0 }
    }
  },
  ports: [
    { id: "electricity-in", medium: "electricity.active-power", direction: "in" }
  ],
  outputs: {
    demandKw: { unit: "kW" }
  }
});

const registry = createComponentRegistry([sourceDefinition, loadDefinition]);

const model = {
  schemaVersion: "0.1.0",
  id: "model.test",
  name: "Test model",
  components: [
    {
      id: "source",
      type: sourceDefinition.type,
      definitionVersion: sourceDefinition.version,
      name: "Source",
      parameters: { ratedPowerKw: 100 },
      initialState: {}
    },
    {
      id: "load",
      type: loadDefinition.type,
      definitionVersion: loadDefinition.version,
      name: "Load",
      parameters: { profileMultiplier: 1 },
      initialState: {}
    }
  ],
  connections: [
    {
      id: "source-to-load",
      name: "Source to load",
      from: { componentId: "source", portId: "electricity-out" },
      to: { componentId: "load", portId: "electricity-in" }
    }
  ]
};

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("model validation resolves registered definitions, ports, and parameters", () => {
  const result = validateModel(model, { registry });

  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("model validation distinguishes hard bounds from validity warnings", () => {
  const warningModel = structuredClone(model);
  warningModel.components[0].parameters.ratedPowerKw = 5;
  const warningResult = validateModel(warningModel, { registry });

  assert.equal(warningResult.valid, true);
  assert.deepEqual(diagnosticCodes(warningResult), ["model.parameter-validity-range"]);
  assert.equal(warningResult.diagnostics[0].severity, "warning");

  const invalidModel = structuredClone(model);
  invalidModel.components[0].parameters.ratedPowerKw = -1;
  const invalidResult = validateModel(invalidModel, { registry });

  assert.equal(invalidResult.valid, false);
  assert.ok(diagnosticCodes(invalidResult).includes("model.parameter-hard-bound"));
});

test("model validation reports duplicate IDs and unsupported definition versions", () => {
  const invalid = structuredClone(model);
  invalid.components[1].id = "source";
  invalid.components[0].definitionVersion = "0.2.0";

  const result = validateModel(invalid, { registry });

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("model.duplicate-component-id"));
  assert.ok(diagnosticCodes(result).includes("model.unsupported-definition-version"));
});

test("model validation reports dangling and incompatible port references", () => {
  const dangling = structuredClone(model);
  dangling.connections[0].to.portId = "missing-port";
  const danglingResult = validateModel(dangling, { registry });
  assert.ok(diagnosticCodes(danglingResult).includes("model.dangling-port-reference"));

  const thermalLoad = createTestComponentDefinition({
    type: "thermal.load",
    ports: [
      { id: "heat-in", medium: "thermal.heat", direction: "in" }
    ]
  });
  const mixedRegistry = createComponentRegistry([sourceDefinition, thermalLoad]);
  const incompatible = structuredClone(model);
  incompatible.components[1].type = thermalLoad.type;
  incompatible.components[1].parameters = {};
  incompatible.connections[0].to.portId = "heat-in";
  const incompatibleResult = validateModel(incompatible, { registry: mixedRegistry });

  assert.ok(diagnosticCodes(incompatibleResult).includes("model.incompatible-port-media"));
});

test("component-specific validators contribute diagnostics without owning runtime state", () => {
  const checkedLoad = createTestComponentDefinition({
    ...loadDefinition,
    validate(component) {
      return component.initialState.unexpected
        ? [{ code: "load.initial-state", message: "Unexpected initial state" }]
        : [];
    }
  });
  const checkedRegistry = createComponentRegistry([sourceDefinition, checkedLoad]);
  const invalid = structuredClone(model);
  invalid.components[1].initialState.unexpected = true;

  const result = validateModel(invalid, { registry: checkedRegistry });

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("load.initial-state"));
});

test("scenario validation checks unique IDs and inline series length", () => {
  const scenario = {
    schemaVersion: "0.1.0",
    id: "scenario.test",
    name: "Test scenario",
    time: { timeStepSeconds: 60, stepCount: 3 },
    series: [
      {
        id: "load-power",
        name: "Load power",
        unit: "kW",
        data: { kind: "inline", values: [1, 2] }
      },
      {
        id: "load-power",
        name: "Duplicate load power",
        unit: "kW",
        data: { kind: "inline", values: [1, 2, 3] }
      }
    ]
  };

  const result = validateScenario(scenario);

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("scenario.duplicate-series-id"));
  assert.ok(diagnosticCodes(result).includes("scenario.series-length"));
});

test("layout validation checks its model identity and component references", () => {
  const layout = {
    schemaVersion: "0.1.0",
    id: "layout.test",
    modelId: "model.other",
    components: [
      { componentId: "missing", x: 0, y: 0 },
      { componentId: "missing", x: 100, y: 0 }
    ]
  };

  const result = validateLayout(layout, { model });

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("layout.model-id"));
  assert.ok(diagnosticCodes(result).includes("layout.duplicate-component-id"));
  assert.ok(diagnosticCodes(result).includes("layout.dangling-component-reference"));
});

test("variant validation checks targets, parameter declarations, and bounds", () => {
  const variant = {
    schemaVersion: "0.1.0",
    id: "variant.test",
    name: "Test variant",
    baseModelId: model.id,
    parameterOverrides: [
      { componentId: "source", parameter: "ratedPowerKw", value: 600 },
      { componentId: "load", parameter: "missingParameter", value: 1 }
    ]
  };

  const result = validateVariant(variant, { model, registry });

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("variant.parameter-hard-bound"));
  assert.ok(diagnosticCodes(result).includes("variant.unknown-parameter"));

  const incompleteRegistry = createComponentRegistry([sourceDefinition]);
  const missingDefinitionResult = validateVariant(variant, {
    model,
    registry: incompleteRegistry
  });
  assert.ok(
    diagnosticCodes(missingDefinitionResult).includes("variant.unknown-component-definition")
  );
});
