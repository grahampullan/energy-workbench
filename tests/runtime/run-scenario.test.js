import { policyDefinitions } from "../../src/policies/definitions.js";
import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../helpers/registry.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalPvDefinition } from "../../src/components/electrical/pv.js";
import { electricalSourceDefinition } from "../../src/components/electrical/source.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  gridDefinition = electricalGridDefinition,
  pvDefinition = electricalPvDefinition,
  loadDefinition = electricalLoadDefinition,
  maximumImportPowerkW = 50,
  maximumExportPowerkW = 50,
  pvProfileMultiplier = 1,
  loadProfileMultiplier = 1.5,
  demandValues = [10, 20],
  generationValues = [5, 40],
  timeStepSeconds = 900,
  pvInitialState = {},
  sourceTarget = null
} = {}) {
  const model = {
    schemaVersion: "0.1.0",
    id: "model.grid-pv-load",
    name: "Grid, PV, and load model",
    components: [
      {
        id: "grid",
        policy: { type: "electrical.balance", settings: {} },
        type: gridDefinition.type,
        definitionVersion: gridDefinition.version,
        name: "Grid",
        parameters: { maximumImportPowerkW, maximumExportPowerkW },
        initialState: {}
      },
      {
        id: "bus",
        type: electricalBusDefinition.type,
        definitionVersion: electricalBusDefinition.version,
        name: "Electrical bus",
        parameters: {},
        initialState: {}
      },
      {
        id: "pv",
        type: pvDefinition.type,
        definitionVersion: pvDefinition.version,
        name: "Solar PV",
        parameters: {
          generationSeriesId: "solar-generation",
          profileMultiplier: pvProfileMultiplier
        },
        initialState: pvInitialState
      },
      {
        id: "load",
        type: loadDefinition.type,
        definitionVersion: loadDefinition.version,
        name: "Load",
        parameters: {
          demandSeriesId: "demand",
          profileMultiplier: loadProfileMultiplier
        },
        initialState: {}
      }
    ],
    connections: [
      {
        id: "grid-to-bus",
        name: "Grid to bus",
        from: { componentId: "grid", portId: "electricity" },
        to: { componentId: "bus", portId: "terminal" }
      },
      {
        id: "pv-to-bus",
        name: "PV to bus",
        from: { componentId: "pv", portId: "electricity-out" },
        to: { componentId: "bus", portId: "terminal" }
      },
      {
        id: "bus-to-load",
        name: "Bus to load",
        from: { componentId: "bus", portId: "terminal" },
        to: { componentId: "load", portId: "electricity-in" }
      }
    ]
  };
  const scenario = {
    schemaVersion: "0.1.0",
    id: "scenario.grid-pv-load",
    name: "Grid, PV, and load scenario",
    time: { timeStepSeconds, stepCount: demandValues.length },
    series: [
      {
        id: "demand",
        name: "Electrical demand",
        unit: "kW",
        data: { kind: "inline", values: demandValues }
      },
      {
        id: "solar-generation",
        name: "Solar generation",
        unit: "kW",
        data: { kind: "inline", values: generationValues }
      }
    ]
  };

  return {
    model,
    scenario,
    registry: createComponentRegistry([
      electricalBusDefinition,
      gridDefinition,
      pvDefinition,
      loadDefinition,
      electricalSourceDefinition
    ], { policies: [...policyDefinitions, {
      type: "test.source", name: "Test source request", componentTypes: ["electrical.source"],
      inputs: {}, settings: {}, request: () => sourceTarget
    }] })
  };
}

function addDispatchableSource(fixture, policy) {
  fixture.model.components.push({
    id: "source",
    type: electricalSourceDefinition.type,
    definitionVersion: electricalSourceDefinition.version,
    name: "Dispatchable source",
    ...(policy ? { policy: { type: policy, settings: {} } } : {}),
    parameters: { maximumPowerkW: 50 },
    initialState: {}
  });
  fixture.model.connections.push({
    id: "source-to-bus",
    name: "Source to bus",
    from: { componentId: "source", portId: "electricity-out" },
    to: { componentId: "bus", portId: "terminal" }
  });
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("runScenario records fixed PV and load operation with residual grid import and export", () => {
  const fixture = createFixture();
  const originalModel = structuredClone(fixture.model);
  const originalScenario = structuredClone(fixture.scenario);

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(fixture.model, originalModel);
  assert.deepEqual(fixture.scenario, originalScenario);
  assert.deepEqual(result.results.initialStates, [
    { componentId: "grid", state: {} },
    { componentId: "bus", state: {} },
    { componentId: "pv", state: {} },
    { componentId: "load", state: {} }
  ]);

  const [firstStep, secondStep] = result.results.steps;
  assert.equal(firstStep.elapsedSeconds, 0);
  assert.equal(secondStep.elapsedSeconds, 900);

  const [grid, bus, pv, load] = firstStep.components;
  assert.equal(grid.requestedCommand, null);
  assert.deepEqual(grid.operatingLimits, {
    minimumPowerkW: -50,
    maximumPowerkW: 50
  });
  assert.equal(grid.feasibleCommand, null);
  assert.deepEqual(grid.actualCommand, { powerkW: 10 });
  assert.deepEqual(grid.outputs, {
    importPowerkW: 10,
    exportPowerkW: 0,
    netPowerkW: 10
  });

  assert.equal(bus.requestedCommand, null);
  assert.deepEqual(bus.feasibleCommand, { powerkW: 0 });
  assert.deepEqual(bus.actualCommand, {
    powerkW: 0,
    connectionPowerkW: {
      "pv-to-bus": -5,
      "bus-to-load": 15,
      "grid-to-bus": -10
    }
  });
  assert.deepEqual(bus.outputs, { powerBalanceErrorkW: 0 });

  assert.equal(pv.requestedCommand, null);
  assert.deepEqual(pv.feasibleCommand, { powerkW: 5 });
  assert.deepEqual(pv.actualCommand, { powerkW: 5 });
  assert.deepEqual(pv.outputs, { availablePowerkW: 5, powerkW: 5 });

  assert.equal(load.requestedCommand, null);
  assert.deepEqual(load.feasibleCommand, { powerkW: -15 });
  assert.deepEqual(load.actualCommand, { powerkW: -15 });
  assert.deepEqual(load.outputs, {
    demandPowerkW: 15,
    suppliedPowerkW: 15
  });
  assert.deepEqual(firstStep.connections, [
    {
      connectionId: "grid-to-bus",
      flowType: "electricity.active-power",
      flow: { powerkW: 10 }
    },
    {
      connectionId: "pv-to-bus",
      flowType: "electricity.active-power",
      flow: { powerkW: 5 }
    },
    {
      connectionId: "bus-to-load",
      flowType: "electricity.active-power",
      flow: { powerkW: 15 }
    }
  ]);

  assert.deepEqual(secondStep.components[0].actualCommand, { powerkW: -10 });
  assert.deepEqual(secondStep.components[0].outputs, {
    importPowerkW: 0,
    exportPowerkW: 10,
    netPowerkW: -10
  });
  assert.deepEqual(secondStep.connections.map((connection) => connection.flow.powerkW), [
    -10,
    40,
    30
  ]);
  assert.deepEqual(runScenario(fixture), result);
});

test("state is initialised once and committed only after each balanced step", () => {
  const accumulatingPv = {
    ...electricalPvDefinition,
    version: "0.2.0",
    initialState: {
      generatedEnergykWh: { unit: "kWh", default: 0 }
    },
    model: {
      ...electricalPvDefinition.model,
      initialise(runtimeComponent) {
        return { ...runtimeComponent.initialState };
      },
      evaluate(runtimeComponent, actualCommand, stepContext) {
        const evaluation = electricalPvDefinition.model.evaluate(
          runtimeComponent,
          actualCommand,
          stepContext
        );
        return {
          ...evaluation,
          nextState: {
            generatedEnergykWh:
              stepContext.state.generatedEnergykWh +
              actualCommand.powerkW * stepContext.durationHours
          }
        };
      }
    }
  };
  const fixture = createFixture({
    pvDefinition: accumulatingPv,
    loadProfileMultiplier: 1,
    demandValues: [10, 10],
    generationValues: [10, 10],
    timeStepSeconds: 1800,
    pvInitialState: { generatedEnergykWh: 5 }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.initialStates[2].state, {
    generatedEnergykWh: 5
  });
  assert.deepEqual(result.results.steps[0].components[2].state, {
    generatedEnergykWh: 10
  });
  assert.deepEqual(result.results.steps[1].components[2].state, {
    generatedEnergykWh: 15
  });

  const coarseFixture = createFixture({
    pvDefinition: accumulatingPv,
    loadProfileMultiplier: 1,
    demandValues: [10],
    generationValues: [10],
    timeStepSeconds: 3600,
    pvInitialState: { generatedEnergykWh: 5 }
  });
  const coarseResult = runScenario(coarseFixture);
  assert.deepEqual(coarseResult.results.steps[0].components[2].state, {
    generatedEnergykWh: 15
  });
});

test("grid import and export limits make residual balance explicitly infeasible", () => {
  const importLimited = createFixture({
    maximumImportPowerkW: 20,
    loadProfileMultiplier: 1,
    demandValues: [30],
    generationValues: [0]
  });
  const importResult = runScenario(importLimited);
  assert.equal(importResult.completed, false);
  assert.equal(importResult.results, null);
  assert.ok(diagnosticCodes(importResult).includes("runtime.electrical-balance-infeasible"));

  const exportLimited = createFixture({
    maximumExportPowerkW: 20,
    loadProfileMultiplier: 1,
    demandValues: [0],
    generationValues: [30]
  });
  const exportResult = runScenario(exportLimited);
  assert.equal(exportResult.completed, false);
  assert.equal(exportResult.results, null);
  assert.ok(diagnosticCodes(exportResult).includes("runtime.electrical-balance-infeasible"));
});

test("the grid remains idle when fixed PV exactly supplies fixed demand", () => {
  const fixture = createFixture({
    loadProfileMultiplier: 1,
    demandValues: [12],
    generationValues: [12]
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.steps[0].components[0].actualCommand, {
    powerkW: 0
  });
  assert.deepEqual(result.results.steps[0].components[0].outputs, {
    importPowerkW: 0,
    exportPowerkW: 0,
    netPowerkW: 0
  });
});

test("a balancing policy cannot also return a target", () => {
  const fixture = createFixture();
  const definitions = fixture.registry.listPolicies().map((definition) => definition.type === "electrical.balance"
    ? { ...definition, request: () => ({ powerkW: 0 }) } : definition);
  fixture.registry = createComponentRegistry(fixture.registry.list(), { policies: definitions });
  const result = runScenario(fixture);
  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.information-policy"));
});

test("a non-grid controllable component requires an explicit valid policy request", () => {
  const missingRequest = createFixture();
  addDispatchableSource(missingRequest);
  const missingResult = runScenario(missingRequest);
  assert.equal(missingResult.completed, false);
  assert.ok(diagnosticCodes(missingResult).includes("runtime.missing-policy-target"));

  const malformedRequest = createFixture({ sourceTarget: { powerkW: "maximum" } });
  addDispatchableSource(malformedRequest, "test.source");
  const malformedResult = runScenario(malformedRequest);
  assert.equal(malformedResult.completed, false);
  assert.ok(diagnosticCodes(malformedResult).includes("runtime.missing-policy-target"));
});

test("policy fixes controllable operation before the grid balances the remainder", () => {
  const fixture = createFixture({ maximumExportPowerkW: 100, sourceTarget: { powerkW: 100 } });
  addDispatchableSource(fixture, "test.source");

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  const firstStep = result.results.steps[0];
  assert.deepEqual(firstStep.components[4].requestedCommand, { powerkW: 100 });
  assert.deepEqual(firstStep.components[4].feasibleCommand, { powerkW: 50 });
  assert.deepEqual(firstStep.components[4].actualCommand, { powerkW: 50 });
  assert.deepEqual(firstStep.components[0].actualCommand, { powerkW: -40 });
  assert.deepEqual(firstStep.connections.map((connection) => connection.flow.powerkW), [
    -40,
    5,
    15,
    50
  ]);
});

test("the runtime rejects unresolved series, wrong units, and negative profiles", () => {
  const unresolved = createFixture();
  unresolved.scenario.series[0].data = {
    kind: "csv-column",
    path: "data/demand.csv",
    valueColumn: "power_kw"
  };
  const unresolvedResult = runScenario(unresolved);
  assert.equal(unresolvedResult.completed, false);
  assert.ok(diagnosticCodes(unresolvedResult).includes("runtime.unresolved-series"));

  const wrongUnit = createFixture();
  wrongUnit.scenario.series[1].unit = "W";
  const wrongUnitResult = runScenario(wrongUnit);
  assert.equal(wrongUnitResult.completed, false);
  assert.ok(
    diagnosticCodes(wrongUnitResult).includes("runtime.component-preparation-failed")
  );

  const negativeDemand = createFixture({
    loadProfileMultiplier: 1,
    demandValues: [-1],
    generationValues: [0]
  });
  const negativeDemandResult = runScenario(negativeDemand);
  assert.equal(negativeDemandResult.completed, false);
  assert.ok(diagnosticCodes(negativeDemandResult).includes("runtime.component-limits-failed"));

  const negativePv = createFixture({
    loadProfileMultiplier: 1,
    demandValues: [0],
    generationValues: [-1]
  });
  const negativePvResult = runScenario(negativePv);
  assert.equal(negativePvResult.completed, false);
  assert.ok(diagnosticCodes(negativePvResult).includes("runtime.component-limits-failed"));
});

test("connection balance is checked against component-evaluated port flows", () => {
  const imbalancedLoad = {
    ...electricalLoadDefinition,
    version: "0.2.0",
    model: {
      ...electricalLoadDefinition.model,
      evaluate(runtimeComponent, actualCommand, stepContext) {
        const evaluation = electricalLoadDefinition.model.evaluate(
          runtimeComponent,
          actualCommand,
          stepContext
        );
        return {
          ...evaluation,
          portFlows: {
            "electricity-in": {
              powerkW: evaluation.portFlows["electricity-in"].powerkW + 1
            }
          }
        };
      }
    }
  };
  const fixture = createFixture({ loadDefinition: imbalancedLoad });

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.equal(result.results, null);
  assert.ok(diagnosticCodes(result).includes("runtime.connection-balance"));
});

test("the bus accepts more than four connections and balances branching loads", () => {
  const fixture = createFixture();
  for (const ordinal of ["second", "third"]) {
    fixture.model.components.push({
      id: `${ordinal}-load`,
      type: electricalLoadDefinition.type,
      definitionVersion: electricalLoadDefinition.version,
      name: `${ordinal} load`,
      parameters: { demandSeriesId: "demand", profileMultiplier: 1 },
      initialState: {}
    });
    fixture.model.connections.push({
      id: `bus-to-${ordinal}-load`,
      name: `Bus to ${ordinal} load`,
      from: { componentId: "bus", portId: "terminal" },
      to: { componentId: `${ordinal}-load`, portId: "electricity-in" }
    });
  }

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.steps[0].components[0].actualCommand, {
    powerkW: 30
  });
  assert.deepEqual(
    result.results.steps[0].connections.map((connection) => connection.flow.powerkW),
    [30, 5, 15, 10, 10]
  );
  assert.equal(
    result.results.steps[0].components[1].outputs.powerBalanceErrorkW,
    0
  );
});

test("policy can select a non-grid component to balance the bus", () => {
  const fixture = createFixture({
    loadProfileMultiplier: 1,
    demandValues: [15],
    generationValues: [5]
  });
  fixture.model.components = fixture.model.components.filter(
    (component) => component.id !== "grid"
  );
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => connection.id !== "grid-to-bus"
  );
  addDispatchableSource(fixture, "electrical.balance");

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.steps[0].components.at(-1).actualCommand, {
    powerkW: 10
  });
});

test("a bus requires a connected component with a balancing policy", () => {
  const fixture = createFixture();
  fixture.model.components = fixture.model.components.filter(
    (component) => component.id !== "grid"
  );
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => connection.id !== "grid-to-bus"
  );

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.electrical-balancing-connection"));
});
