import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../../src/core/component-registry.js";
import { createTestComponentDefinition } from "../helpers/component-definition.js";

test("component registry resolves definitions by type and exact version", () => {
  const versionOne = createTestComponentDefinition({ version: "0.1.0" });
  const versionTwo = createTestComponentDefinition({ version: "0.2.0" });
  const registry = createComponentRegistry([versionTwo, versionOne]);

  assert.equal(registry.get("electrical.source", "0.1.0"), versionOne);
  assert.equal(registry.get("electrical.source", "0.2.0"), versionTwo);
  assert.equal(registry.get("electrical.source", "9.0.0"), undefined);
  assert.equal(registry.hasType("electrical.source"), true);
  assert.deepEqual(registry.list(), [versionOne, versionTwo]);
});

test("component registry accepts later registration but rejects duplicate contracts", () => {
  const definition = createTestComponentDefinition();
  const registry = createComponentRegistry();

  registry.register(definition);
  assert.equal(registry.has(definition.type, definition.version), true);
  assert.throws(
    () => registry.register(definition),
    /already registered/u
  );
});

test("component registry rejects incomplete engineering definitions", () => {
  const missingMethod = createTestComponentDefinition();
  delete missingMethod.model.resolve;

  assert.throws(
    () => createComponentRegistry([missingMethod]),
    /model\.resolve must be a function/u
  );

  const missingResolutionMethod = createTestComponentDefinition();
  delete missingResolutionMethod.resolution.describe;
  assert.throws(
    () => createComponentRegistry([missingResolutionMethod]),
    /resolution\.describe must be a function/u
  );
});

test("component registry requires declared initial-state units and defaults", () => {
  const missingUnit = createTestComponentDefinition({
    initialState: {
      storedEnergykWh: { default: 0 }
    }
  });
  assert.throws(
    () => createComponentRegistry([missingUnit]),
    /initialState\.storedEnergykWh\.unit is required/u
  );

  const missingDefault = createTestComponentDefinition({
    initialState: {
      storedEnergykWh: { unit: "kWh" }
    }
  });
  assert.throws(
    () => createComponentRegistry([missingDefault]),
    /initialState\.storedEnergykWh\.default is required/u
  );
});

test("component registry rejects duplicate ports and malformed parameter ranges", () => {
  const duplicatePorts = createTestComponentDefinition({
    ports: [
      { id: "power", flowType: "electricity.active-power", direction: "in" },
      { id: "power", flowType: "electricity.active-power", direction: "out" }
    ]
  });
  assert.throws(
    () => createComponentRegistry([duplicatePorts]),
    /duplicate port ID/u
  );

  const malformedRange = createTestComponentDefinition({
    parameters: {
      powerkW: {
        unit: "kW",
        default: 10,
        hardBounds: { minimum: 20, maximum: 10 }
      }
    }
  });
  assert.throws(
    () => createComponentRegistry([malformedRange]),
    /minimum cannot exceed maximum/u
  );
});

test("component registry rejects unsupported flow types", () => {
  const definition = createTestComponentDefinition({
    ports: [
      { id: "material-out", flowType: "material.mass-flow", direction: "out" }
    ]
  });

  assert.throws(
    () => createComponentRegistry([definition]),
    /flowType is not supported/u
  );
});
