import assert from "node:assert/strict";
import test from "node:test";

import { electricalBatteryDefinition } from
  "../../src/components/electrical/battery.js";
import { createComponentRegistry } from "../../src/core/component-registry.js";
import {
  applyParameterOverrides,
  parameterOverrideKey,
  resolvedParameterValue
} from "../../src/ui/preview-model.js";

const registry = createComponentRegistry([electricalBatteryDefinition]);
const model = {
  schemaVersion: "0.1.0",
  id: "model.preview",
  name: "Preview model",
  components: [{
    id: "battery",
    type: electricalBatteryDefinition.type,
    definitionVersion: electricalBatteryDefinition.version,
    name: "Battery",
    parameters: {
      capacityKwh: 5,
      maximumChargePowerKw: 3,
      maximumDischargePowerKw: 3,
      chargingEfficiency: 1,
      dischargingEfficiency: 1
    },
    initialState: { storedEnergyKwh: 0 }
  }],
  connections: []
};

test("parameter overrides produce a validated model without mutating the working model", () => {
  const snapshot = structuredClone(model);
  const result = applyParameterOverrides({
    model,
    registry,
    overrides: [
      { componentId: "battery", parameter: "capacityKwh", value: 8 },
      { componentId: "battery", parameter: "maximumChargePowerKw", value: 4 }
    ]
  });

  assert.equal(result.applied, true);
  assert.equal(result.model.components[0].parameters.capacityKwh, 8);
  assert.equal(result.model.components[0].parameters.maximumChargePowerKw, 4);
  assert.equal(result.inverseCommands.length, 2);
  assert.deepEqual(model, snapshot);
});

test("invalid overrides return diagnostics and preserve the working model", () => {
  const result = applyParameterOverrides({
    model,
    registry,
    overrides: [
      { componentId: "battery", parameter: "capacityKwh", value: -1 }
    ]
  });

  assert.equal(result.applied, false);
  assert.equal(result.model, model);
  assert.ok(result.diagnostics.some(
    (diagnostic) => diagnostic.code === "model.parameter-hard-bound"
  ));
});

test("preview helpers resolve defaults and stable override keys", () => {
  const modelUsingDefault = structuredClone(model);
  delete modelUsingDefault.components[0].parameters.capacityKwh;

  assert.equal(resolvedParameterValue({
    model: modelUsingDefault,
    registry,
    componentId: "battery",
    parameter: "capacityKwh"
  }), 5);
  assert.equal(parameterOverrideKey("battery", "capacityKwh"), "battery\u0000capacityKwh");
});
