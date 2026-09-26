import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../helpers/registry.js";
import { applyModelCommand } from "../../src/core/model-commands.js";
import { createTestComponentDefinition } from "../helpers/component-definition.js";

const sourceDefinition = createTestComponentDefinition({
  type: "electrical.source",
  name: "Electrical source",
  parameters: {
    ratedPowerkW: {
      unit: "kW",
      default: 100,
      hardBounds: { minimum: 0, maximum: 500 },
      validityRange: { minimum: 10, maximum: 400 }
    }
  },
  ports: [
    { id: "electricity-out", flowType: "electricity.active-power", direction: "out" }
  ],
  outputs: {
    powerkW: { unit: "kW" }
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
    { id: "electricity-in", flowType: "electricity.active-power", direction: "in" }
  ],
  outputs: {
    demandkW: { unit: "kW" }
  }
});

const registry = createComponentRegistry([sourceDefinition, loadDefinition]);

const model = {
  schemaVersion: "0.1.0",
  id: "model.commands",
  name: "Command test model",
  components: [
    {
      id: "source",
      type: sourceDefinition.type,
      definitionVersion: sourceDefinition.version,
      name: "Source",
      parameters: { ratedPowerkW: 100 },
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

function apply(currentModel, command) {
  return applyModelCommand(currentModel, command, { registry });
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("setParameter returns a new model and an exact undo/redo path", () => {
  const originalSnapshot = structuredClone(model);
  const command = {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: 250
  };

  const changed = apply(model, command);

  assert.equal(changed.applied, true);
  assert.notEqual(changed.model, model);
  assert.equal(changed.model.components[0].parameters.ratedPowerkW, 250);
  assert.deepEqual(model, originalSnapshot);

  const undone = apply(changed.model, changed.inverseCommand);
  assert.equal(undone.applied, true);
  assert.deepEqual(undone.model, model);

  const redone = apply(undone.model, undone.inverseCommand);
  assert.equal(redone.applied, true);
  assert.deepEqual(redone.model, changed.model);
});

test("setParameter undo restores an omitted parameter rather than persisting its default", () => {
  const modelUsingDefault = structuredClone(model);
  delete modelUsingDefault.components[0].parameters.ratedPowerkW;

  const changed = apply(modelUsingDefault, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: 200
  });

  assert.equal(changed.applied, true);
  assert.equal(changed.inverseCommand.type, "unsetParameter");

  const undone = apply(changed.model, changed.inverseCommand);
  assert.equal(undone.applied, true);
  assert.deepEqual(undone.model, modelUsingDefault);
});

test("commands accept validity warnings but reject hard-bound violations", () => {
  const warning = apply(model, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: 5
  });
  assert.equal(warning.applied, true);
  assert.deepEqual(diagnosticCodes(warning), ["model.parameter-validity-range"]);

  const invalid = apply(model, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: -1
  });
  assert.equal(invalid.applied, false);
  assert.equal(invalid.model, model);
  assert.equal(invalid.inverseCommand, null);
  assert.ok(diagnosticCodes(invalid).includes("model.parameter-hard-bound"));
});

test("addComponent and its inverse preserve component ordering", () => {
  const component = {
    id: "second-load",
    type: loadDefinition.type,
    definitionVersion: loadDefinition.version,
    name: "Second load",
    parameters: { profileMultiplier: 0.5 },
    initialState: {}
  };

  const added = apply(model, {
    type: "addComponent",
    component,
    index: 1
  });
  assert.equal(added.applied, true);
  assert.deepEqual(added.model.components.map(({ id }) => id), ["source", "second-load", "load"]);

  const undone = apply(added.model, added.inverseCommand);
  assert.equal(undone.applied, true);
  assert.deepEqual(undone.model, model);

  const redone = apply(undone.model, undone.inverseCommand);
  assert.equal(redone.applied, true);
  assert.deepEqual(redone.model, added.model);
});

test("removeComponent requires explicit disconnection and is reversible", () => {
  const rejected = apply(model, {
    type: "removeComponent",
    componentId: "load"
  });
  assert.equal(rejected.applied, false);
  assert.ok(diagnosticCodes(rejected).includes("command.component-connected"));

  const disconnected = apply(model, {
    type: "disconnectPorts",
    connectionId: "source-to-load"
  });
  const removed = apply(disconnected.model, {
    type: "removeComponent",
    componentId: "load"
  });
  assert.equal(removed.applied, true);
  assert.deepEqual(removed.model.components.map(({ id }) => id), ["source"]);

  const restored = apply(removed.model, removed.inverseCommand);
  assert.equal(restored.applied, true);
  assert.deepEqual(restored.model, disconnected.model);
});

test("connectPorts and disconnectPorts preserve exact connection ordering", () => {
  const disconnected = apply(model, {
    type: "disconnectPorts",
    connectionId: "source-to-load"
  });
  assert.equal(disconnected.applied, true);
  assert.deepEqual(disconnected.model.connections, []);

  const reconnected = apply(disconnected.model, disconnected.inverseCommand);
  assert.equal(reconnected.applied, true);
  assert.deepEqual(reconnected.model, model);

  const disconnectedAgain = apply(reconnected.model, reconnected.inverseCommand);
  assert.equal(disconnectedAgain.applied, true);
  assert.deepEqual(disconnectedAgain.model, disconnected.model);
});

test("connectPorts rejects invalid topology without changing the model", () => {
  const disconnected = apply(model, {
    type: "disconnectPorts",
    connectionId: "source-to-load"
  }).model;
  const snapshot = structuredClone(disconnected);

  const result = apply(disconnected, {
    type: "connectPorts",
    connection: {
      id: "reversed",
      name: "Reversed connection",
      from: { componentId: "load", portId: "electricity-in" },
      to: { componentId: "source", portId: "electricity-out" }
    }
  });

  assert.equal(result.applied, false);
  assert.equal(result.model, disconnected);
  assert.deepEqual(disconnected, snapshot);
  assert.ok(diagnosticCodes(result).includes("model.invalid-from-port-direction"));
  assert.ok(diagnosticCodes(result).includes("model.invalid-to-port-direction"));
});

test("malformed, unknown, and non-JSON command data return diagnostics", () => {
  const malformed = apply(model, null);
  assert.equal(malformed.applied, false);
  assert.deepEqual(diagnosticCodes(malformed), ["command.invalid"]);

  const unknown = apply(model, { type: "doEverything" });
  assert.equal(unknown.applied, false);
  assert.deepEqual(diagnosticCodes(unknown), ["command.unknown-type"]);

  const nonJson = apply(model, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: 1n
  });
  assert.equal(nonJson.applied, false);
  assert.deepEqual(diagnosticCodes(nonJson), ["command.non-json-value"]);

  const circularValue = {};
  circularValue.self = circularValue;
  const circular = apply(model, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: circularValue
  });
  assert.equal(circular.applied, false);
  assert.deepEqual(diagnosticCodes(circular), ["command.non-json-value"]);

  const malformedModel = { ...model, components: null };
  const invalidModel = apply(malformedModel, {
    type: "setParameter",
    componentId: "source",
    parameter: "ratedPowerkW",
    value: 100
  });
  assert.equal(invalidModel.applied, false);
  assert.ok(diagnosticCodes(invalidModel).includes("schema.type"));
});
