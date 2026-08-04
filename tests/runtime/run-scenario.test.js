import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../../src/core/component-registry.js";
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
  maximumImportPowerKw = 50,
  maximumExportPowerKw = 50,
  pvProfileMultiplier = 1,
  loadProfileMultiplier = 1.5,
  demandValues = [10, 20],
  generationValues = [5, 40],
  timeStepSeconds = 900,
  pvInitialState = {},
  policy = { request: () => ({}) }
} = {}) {
  const model = {
    schemaVersion: "0.1.0",
    id: "model.grid-pv-load",
    name: "Grid, PV, and load model",
    components: [
      {
        id: "grid",
        type: gridDefinition.type,
        definitionVersion: gridDefinition.version,
        name: "Grid",
        parameters: { maximumImportPowerKw, maximumExportPowerKw },
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
        to: { componentId: "bus", portId: "terminal-1" }
      },
      {
        id: "pv-to-bus",
        name: "PV to bus",
        from: { componentId: "pv", portId: "electricity-out" },
        to: { componentId: "bus", portId: "terminal-2" }
      },
      {
        id: "bus-to-load",
        name: "Bus to load",
        from: { componentId: "bus", portId: "terminal-3" },
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
    policy,
    registry: createComponentRegistry([
      electricalBusDefinition,
      gridDefinition,
      pvDefinition,
      loadDefinition,
      electricalSourceDefinition
    ])
  };
}

function addDispatchableSource(fixture) {
  fixture.model.components.push({
    id: "source",
    type: electricalSourceDefinition.type,
    definitionVersion: electricalSourceDefinition.version,
    name: "Dispatchable source",
    parameters: { maximumPowerKw: 50 },
    initialState: {}
  });
  fixture.model.connections.push({
    id: "source-to-bus",
    name: "Source to bus",
    from: { componentId: "source", portId: "electricity-out" },
    to: { componentId: "bus", portId: "terminal-4" }
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
    minimumPowerKw: -50,
    maximumPowerKw: 50
  });
  assert.equal(grid.feasibleCommand, null);
  assert.deepEqual(grid.actualCommand, { powerKw: 10 });
  assert.deepEqual(grid.outputs, {
    importPowerKw: 10,
    exportPowerKw: 0,
    netPowerKw: 10
  });

  assert.equal(bus.requestedCommand, null);
  assert.deepEqual(bus.feasibleCommand, { powerKw: 0 });
  assert.deepEqual(bus.actualCommand, {
    powerKw: 0,
    portPowerKw: {
      "terminal-1": -10,
      "terminal-2": -5,
      "terminal-3": 15,
      "terminal-4": 0
    }
  });
  assert.deepEqual(bus.outputs, { balanceResidualPowerKw: 0 });

  assert.equal(pv.requestedCommand, null);
  assert.deepEqual(pv.feasibleCommand, { powerKw: 5 });
  assert.deepEqual(pv.actualCommand, { powerKw: 5 });
  assert.deepEqual(pv.outputs, { availablePowerKw: 5, powerKw: 5 });

  assert.equal(load.requestedCommand, null);
  assert.deepEqual(load.feasibleCommand, { powerKw: -15 });
  assert.deepEqual(load.actualCommand, { powerKw: -15 });
  assert.deepEqual(load.outputs, {
    demandPowerKw: 15,
    suppliedPowerKw: 15
  });
  assert.deepEqual(firstStep.connections, [
    {
      connectionId: "grid-to-bus",
      medium: "electricity.active-power",
      powerKw: 10,
      residualPowerKw: 0
    },
    {
      connectionId: "pv-to-bus",
      medium: "electricity.active-power",
      powerKw: 5,
      residualPowerKw: 0
    },
    {
      connectionId: "bus-to-load",
      medium: "electricity.active-power",
      powerKw: 15,
      residualPowerKw: 0
    }
  ]);

  assert.deepEqual(secondStep.components[0].actualCommand, { powerKw: -10 });
  assert.deepEqual(secondStep.components[0].outputs, {
    importPowerKw: 0,
    exportPowerKw: 10,
    netPowerKw: -10
  });
  assert.deepEqual(secondStep.connections.map((connection) => connection.powerKw), [
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
      generatedEnergyKwh: { unit: "kWh", default: 0 }
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
            generatedEnergyKwh:
              stepContext.state.generatedEnergyKwh +
              actualCommand.powerKw * stepContext.durationHours
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
    pvInitialState: { generatedEnergyKwh: 5 }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.initialStates[2].state, {
    generatedEnergyKwh: 5
  });
  assert.deepEqual(result.results.steps[0].components[2].state, {
    generatedEnergyKwh: 10
  });
  assert.deepEqual(result.results.steps[1].components[2].state, {
    generatedEnergyKwh: 15
  });

  const coarseFixture = createFixture({
    pvDefinition: accumulatingPv,
    loadProfileMultiplier: 1,
    demandValues: [10],
    generationValues: [10],
    timeStepSeconds: 3600,
    pvInitialState: { generatedEnergyKwh: 5 }
  });
  const coarseResult = runScenario(coarseFixture);
  assert.deepEqual(coarseResult.results.steps[0].components[2].state, {
    generatedEnergyKwh: 15
  });
});

test("grid import and export limits make residual balance explicitly infeasible", () => {
  const importLimited = createFixture({
    maximumImportPowerKw: 20,
    loadProfileMultiplier: 1,
    demandValues: [30],
    generationValues: [0]
  });
  const importResult = runScenario(importLimited);
  assert.equal(importResult.completed, false);
  assert.equal(importResult.results, null);
  assert.ok(diagnosticCodes(importResult).includes("runtime.electrical-balance-infeasible"));

  const exportLimited = createFixture({
    maximumExportPowerKw: 20,
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
    powerKw: 0
  });
  assert.deepEqual(result.results.steps[0].components[0].outputs, {
    importPowerKw: 0,
    exportPowerKw: 0,
    netPowerKw: 0
  });
});

test("the grid is resolver-owned and cannot receive a policy request", () => {
  const fixture = createFixture({
    policy: { request: () => ({ grid: { powerKw: 0 } }) }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.grid-policy-request"));
});

test("a non-grid controllable component requires an explicit valid policy request", () => {
  const missingRequest = createFixture();
  addDispatchableSource(missingRequest);
  const missingResult = runScenario(missingRequest);
  assert.equal(missingResult.completed, false);
  assert.ok(diagnosticCodes(missingResult).includes("runtime.missing-policy-request"));

  const malformedRequest = createFixture({
    policy: { request: () => ({ source: { powerKw: "maximum" } }) }
  });
  addDispatchableSource(malformedRequest);
  const malformedResult = runScenario(malformedRequest);
  assert.equal(malformedResult.completed, false);
  assert.ok(diagnosticCodes(malformedResult).includes("runtime.policy-command-contract"));
});

test("policy fixes controllable operation before the grid balances the remainder", () => {
  const fixture = createFixture({
    maximumExportPowerKw: 100,
    policy: { request: () => ({ source: { powerKw: 100 } }) }
  });
  addDispatchableSource(fixture);

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  const firstStep = result.results.steps[0];
  assert.deepEqual(firstStep.components[4].requestedCommand, { powerKw: 100 });
  assert.deepEqual(firstStep.components[4].feasibleCommand, { powerKw: 50 });
  assert.deepEqual(firstStep.components[4].actualCommand, { powerKw: 50 });
  assert.deepEqual(firstStep.components[0].actualCommand, { powerKw: -40 });
  assert.deepEqual(firstStep.connections.map((connection) => connection.powerKw), [
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
              powerKw: evaluation.portFlows["electricity-in"].powerKw + 1
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

test("the bus resolver balances branching electrical loads through the grid", () => {
  const fixture = createFixture();
  fixture.model.components.push({
    id: "second-load",
    type: electricalLoadDefinition.type,
    definitionVersion: electricalLoadDefinition.version,
    name: "Second load",
    parameters: { demandSeriesId: "demand", profileMultiplier: 1 },
    initialState: {}
  });
  fixture.model.connections.push({
    id: "bus-to-second-load",
    name: "Bus to second load",
    from: { componentId: "bus", portId: "terminal-4" },
    to: { componentId: "second-load", portId: "electricity-in" }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.steps[0].components[0].actualCommand, {
    powerKw: 20
  });
  assert.deepEqual(
    result.results.steps[0].connections.map((connection) => connection.powerKw),
    [20, 5, 15, 10]
  );
  assert.equal(
    result.results.steps[0].components[1].outputs.balanceResidualPowerKw,
    0
  );
});

test("the bus runtime requires exactly one grid boundary", () => {
  const fixture = createFixture();
  fixture.model.components = fixture.model.components.filter(
    (component) => component.id !== "grid"
  );
  fixture.model.connections = fixture.model.connections.filter(
    (connection) => connection.id !== "grid-to-bus"
  );

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.electrical-grid-count"));
});
