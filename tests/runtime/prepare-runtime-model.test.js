import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../helpers/registry.js";
import { prepareRuntimeModel } from "../../src/runtime/prepare-runtime-model.js";
import { createTestComponentDefinition } from "../helpers/component-definition.js";

function createFixture({ sourcePrepare, loadPrepare } = {}) {
  const sourceDefinition = createTestComponentDefinition({
    type: "electrical.source",
    name: "Source",
    parameters: {
      ratedPowerkW: {
        unit: "kW",
        default: 100,
        hardBounds: { minimum: 0, maximum: 500 },
        validityRange: { minimum: 10, maximum: 400 }
      }
    },
    initialState: {
      availableEnergykWh: { unit: "kWh", default: 25 }
    },
    ports: [
      { id: "electricity-out", flowType: "electricity.active-power", direction: "out" }
    ],
    model: {
      prepare: sourcePrepare ?? ((component) => ({
        ratedPowerkW: component.parameters.ratedPowerkW
      }))
    }
  });
  const loadDefinition = createTestComponentDefinition({
    type: "electrical.load",
    name: "Load",
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
    model: {
      prepare: loadPrepare ?? (() => ({ profileSeriesId: "load-power" }))
    }
  });
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
        parameters: {},
        initialState: {}
      },
      {
        id: "load",
        type: loadDefinition.type,
        definitionVersion: loadDefinition.version,
        name: "Load",
        parameters: { profileMultiplier: 2 },
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
  const scenario = {
    schemaVersion: "0.1.0",
    id: "scenario.test",
    name: "Test scenario",
    time: { timeStepSeconds: 3600, stepCount: 2 },
    series: [
      {
        id: "load-power",
        name: "Load power",
        unit: "kW",
        data: { kind: "inline", values: [20, 30] }
      }
    ]
  };

  return {
    sourceDefinition,
    loadDefinition,
    registry: createComponentRegistry([sourceDefinition, loadDefinition]),
    model,
    scenario
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("prepareRuntimeModel resolves defaults, component data, ports, and connections", () => {
  let receivedComponent;
  let receivedContext;
  const returnedModelData = { coefficient: 0.95 };
  const fixture = createFixture({
    sourcePrepare(component, context) {
      receivedComponent = component;
      receivedContext = context;
      return returnedModelData;
    }
  });
  const originalModel = structuredClone(fixture.model);
  const originalScenario = structuredClone(fixture.scenario);

  const result = prepareRuntimeModel(fixture);

  assert.equal(result.prepared, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(fixture.model, originalModel);
  assert.deepEqual(fixture.scenario, originalScenario);

  const [source, load] = result.runtimeModel.components;
  assert.equal(source.definition, fixture.sourceDefinition);
  assert.deepEqual(source.parameters, { ratedPowerkW: 100 });
  assert.deepEqual(source.initialState, { availableEnergykWh: 25 });
  assert.deepEqual(source.modelData, { coefficient: 0.95 });
  assert.notEqual(source.modelData, returnedModelData);
  assert.deepEqual(load.parameters, { profileMultiplier: 2 });

  assert.deepEqual(receivedComponent.parameters, { ratedPowerkW: 100 });
  assert.deepEqual(receivedComponent.initialState, { availableEnergykWh: 25 });
  assert.equal(Object.isFrozen(receivedComponent), true);
  assert.equal(receivedContext.model, undefined);
  assert.notEqual(receivedContext.scenario, fixture.scenario);
  assert.equal(Object.isFrozen(receivedContext.scenario), true);
  assert.deepEqual(receivedContext.scenario.series, []);
  assert.deepEqual(receivedContext.scenario.time, fixture.scenario.time);

  const [connection] = result.runtimeModel.connections;
  assert.equal(connection.flowType, "electricity.active-power");
  assert.equal(connection.from.component, source);
  assert.equal(connection.from.port, source.ports[0]);
  assert.equal(connection.to.component, load);
  assert.equal(connection.to.port, load.ports[0]);
  assert.equal(source.ports[0].cardinality, "one");
  assert.equal(load.ports[0].cardinality, "one");
  assert.deepEqual(source.ports[0].connectionIds, [connection.id]);
  assert.deepEqual(load.ports[0].connectionIds, [connection.id]);
  assert.equal(Object.isFrozen(source), true);

  returnedModelData.coefficient = 0;
  fixture.scenario.series[0].data.values[0] = 999;
  assert.equal(source.modelData.coefficient, 0.95);
  assert.equal(result.runtimeModel.series[0].data.values[0], 20);
});

test("preparation keeps model validity warnings without rejecting the runtime model", () => {
  const fixture = createFixture();
  fixture.model.components[0].parameters.ratedPowerkW = 5;

  const result = prepareRuntimeModel(fixture);

  assert.equal(result.prepared, true);
  assert.deepEqual(diagnosticCodes(result), ["model.parameter-validity-range"]);
  assert.equal(result.diagnostics[0].severity, "warning");
  assert.equal(result.runtimeModel.components[0].parameters.ratedPowerkW, 5);
});

test("invalid model and scenario documents are rejected before component preparation", () => {
  let preparationCount = 0;
  const fixture = createFixture({
    sourcePrepare() {
      preparationCount += 1;
      return {};
    },
    loadPrepare() {
      preparationCount += 1;
      return {};
    }
  });
  fixture.model.connections[0].to.portId = "missing-port";
  fixture.scenario.series[0].data.values.pop();

  const result = prepareRuntimeModel(fixture);

  assert.equal(result.prepared, false);
  assert.equal(result.runtimeModel, null);
  assert.equal(preparationCount, 0);
  assert.ok(diagnosticCodes(result).includes("model.dangling-port-reference"));
  assert.ok(diagnosticCodes(result).includes("scenario.series-length"));
});

test("component preparation failures and invalid return values become diagnostics", () => {
  const fixture = createFixture({
    sourcePrepare() {
      throw new Error("coefficient failed");
    },
    loadPrepare() {
      return new Date("2026-01-01T00:00:00Z");
    }
  });

  const result = prepareRuntimeModel(fixture);

  assert.equal(result.prepared, false);
  assert.equal(result.runtimeModel, null);
  assert.deepEqual(diagnosticCodes(result), [
    "runtime.component-preparation-failed",
    "runtime.component-preparation-contract"
  ]);
});

test("preparation rejects non-JSON inputs and requires an explicit registry", () => {
  const fixture = createFixture();
  fixture.model.components[0].parameters.ratedPowerkW = Number.POSITIVE_INFINITY;

  const result = prepareRuntimeModel(fixture);
  assert.equal(result.prepared, false);
  assert.deepEqual(diagnosticCodes(result), ["runtime.non-json-input"]);

  assert.throws(
    () => prepareRuntimeModel({ model: fixture.model, scenario: fixture.scenario }),
    /component registry is required/u
  );
});
