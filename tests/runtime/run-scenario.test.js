import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../../src/core/component-registry.js";
import { electricalBusDefinition } from "../../src/components/electrical/bus.js";
import { electricalLoadDefinition } from "../../src/components/electrical/load.js";
import { electricalSourceDefinition } from "../../src/components/electrical/source.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function createFixture({
  sourceDefinition = electricalSourceDefinition,
  loadDefinition = electricalLoadDefinition,
  maximumPowerKw = 50,
  profileMultiplier = 1.5,
  demandValues = [10, 20],
  timeStepSeconds = 900,
  sourceInitialState = {},
  policy = {
    request() {
      return { source: { powerKw: 100 } };
    }
  }
} = {}) {
  const model = {
    schemaVersion: "0.1.0",
    id: "model.direct-electrical",
    name: "Direct electrical model",
    components: [
      {
        id: "source",
        type: sourceDefinition.type,
        definitionVersion: sourceDefinition.version,
        name: "Source",
        parameters: { maximumPowerKw },
        initialState: sourceInitialState
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
        id: "load",
        type: loadDefinition.type,
        definitionVersion: loadDefinition.version,
        name: "Load",
        parameters: { demandSeriesId: "demand", profileMultiplier },
        initialState: {}
      }
    ],
    connections: [
      {
        id: "source-to-bus",
        name: "Source to bus",
        from: { componentId: "source", portId: "electricity-out" },
        to: { componentId: "bus", portId: "terminal-1" }
      },
      {
        id: "bus-to-load",
        name: "Bus to load",
        from: { componentId: "bus", portId: "terminal-2" },
        to: { componentId: "load", portId: "electricity-in" }
      }
    ]
  };
  const scenario = {
    schemaVersion: "0.1.0",
    id: "scenario.direct-electrical",
    name: "Direct electrical scenario",
    time: { timeStepSeconds, stepCount: demandValues.length },
    series: [
      {
        id: "demand",
        name: "Electrical demand",
        unit: "kW",
        data: { kind: "inline", values: demandValues }
      }
    ]
  };

  return {
    model,
    scenario,
    policy,
    registry: createComponentRegistry([
      electricalBusDefinition,
      sourceDefinition,
      loadDefinition
    ])
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("runScenario records requested, feasible, and balanced actual operation", () => {
  const fixture = createFixture();
  const originalModel = structuredClone(fixture.model);
  const originalScenario = structuredClone(fixture.scenario);

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(fixture.model, originalModel);
  assert.deepEqual(fixture.scenario, originalScenario);
  assert.deepEqual(result.results.initialStates, [
    { componentId: "source", state: {} },
    { componentId: "bus", state: {} },
    { componentId: "load", state: {} }
  ]);

  const [firstStep, secondStep] = result.results.steps;
  assert.equal(firstStep.elapsedSeconds, 0);
  assert.equal(secondStep.elapsedSeconds, 900);

  const [source, bus, load] = firstStep.components;
  assert.deepEqual(source.requestedCommand, { powerKw: 100 });
  assert.deepEqual(source.operatingLimits, {
    minimumPowerKw: 0,
    maximumPowerKw: 50
  });
  assert.deepEqual(source.feasibleCommand, { powerKw: 50 });
  assert.deepEqual(source.actualCommand, { powerKw: 15 });
  assert.deepEqual(source.outputs, { powerKw: 15 });

  assert.equal(bus.requestedCommand, null);
  assert.deepEqual(bus.actualCommand, {
    powerKw: 0,
    portPowerKw: {
      "terminal-1": -15,
      "terminal-2": 15,
      "terminal-3": 0,
      "terminal-4": 0
    }
  });
  assert.deepEqual(bus.outputs, { balanceResidualPowerKw: 0 });

  assert.equal(load.requestedCommand, null);
  assert.deepEqual(load.feasibleCommand, { powerKw: -15 });
  assert.deepEqual(load.actualCommand, { powerKw: -15 });
  assert.deepEqual(load.outputs, {
    demandPowerKw: 15,
    suppliedPowerKw: 15
  });
  assert.deepEqual(firstStep.connections, [
    {
      connectionId: "source-to-bus",
      medium: "electricity.active-power",
      powerKw: 15,
      residualPowerKw: 0
    },
    {
      connectionId: "bus-to-load",
      medium: "electricity.active-power",
      powerKw: 15,
      residualPowerKw: 0
    }
  ]);

  assert.equal(secondStep.connections[0].powerKw, 30);
  assert.equal(secondStep.connections[1].powerKw, 30);
  assert.deepEqual(runScenario(fixture), result);
});

test("state is initialised once and committed only after each balanced step", () => {
  const accumulatingSource = {
    ...electricalSourceDefinition,
    version: "0.2.0",
    initialState: {
      generatedEnergyKwh: { unit: "kWh", default: 0 }
    },
    model: {
      ...electricalSourceDefinition.model,
      initialise(runtimeComponent) {
        return { ...runtimeComponent.initialState };
      },
      evaluate(runtimeComponent, actualCommand, stepContext) {
        const evaluation = electricalSourceDefinition.model.evaluate(
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
    sourceDefinition: accumulatingSource,
    profileMultiplier: 1,
    demandValues: [10, 10],
    timeStepSeconds: 1800,
    sourceInitialState: { generatedEnergyKwh: 5 }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.deepEqual(result.results.initialStates[0].state, {
    generatedEnergyKwh: 5
  });
  assert.deepEqual(result.results.steps[0].components[0].state, {
    generatedEnergyKwh: 10
  });
  assert.deepEqual(result.results.steps[1].components[0].state, {
    generatedEnergyKwh: 15
  });

  const coarseFixture = createFixture({
    sourceDefinition: accumulatingSource,
    profileMultiplier: 1,
    demandValues: [10],
    timeStepSeconds: 3600,
    sourceInitialState: { generatedEnergyKwh: 5 }
  });
  const coarseResult = runScenario(coarseFixture);
  assert.deepEqual(coarseResult.results.steps[0].components[0].state, {
    generatedEnergyKwh: 15
  });
});

test("an infeasible source limit stops the run with no partial results", () => {
  const fixture = createFixture({
    maximumPowerKw: 20,
    profileMultiplier: 1,
    demandValues: [10, 30]
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.equal(result.results, null);
  assert.ok(diagnosticCodes(result).includes("runtime.electrical-balance-infeasible"));
  assert.match(result.diagnostics.at(-1).path, /steps\/1/u);
});

test("a controllable component requires an explicit valid policy request", () => {
  const missingRequest = createFixture({
    policy: { request: () => ({}) }
  });
  const missingResult = runScenario(missingRequest);
  assert.equal(missingResult.completed, false);
  assert.ok(diagnosticCodes(missingResult).includes("runtime.missing-policy-request"));

  const malformedRequest = createFixture({
    policy: { request: () => ({ source: { powerKw: "maximum" } }) }
  });
  const malformedResult = runScenario(malformedRequest);
  assert.equal(malformedResult.completed, false);
  assert.ok(diagnosticCodes(malformedResult).includes("runtime.policy-command-contract"));
});

test("the runtime rejects unresolved series and negative electrical demand", () => {
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
  wrongUnit.scenario.series[0].unit = "W";
  const wrongUnitResult = runScenario(wrongUnit);
  assert.equal(wrongUnitResult.completed, false);
  assert.ok(
    diagnosticCodes(wrongUnitResult).includes("runtime.component-preparation-failed")
  );

  const negativeDemand = createFixture({
    profileMultiplier: 1,
    demandValues: [-1, 10]
  });
  const negativeResult = runScenario(negativeDemand);
  assert.equal(negativeResult.completed, false);
  assert.ok(diagnosticCodes(negativeResult).includes("runtime.component-limits-failed"));
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

test("the bus resolver balances branching electrical topology", () => {
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
    from: { componentId: "bus", portId: "terminal-3" },
    to: { componentId: "second-load", portId: "electricity-in" }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, true);
  assert.equal(result.results.steps[0].components[0].actualCommand.powerKw, 25);
  assert.deepEqual(
    result.results.steps[0].connections.map((connection) => connection.powerKw),
    [25, 15, 10]
  );
  assert.equal(
    result.results.steps[0].components[1].outputs.balanceResidualPowerKw,
    0
  );
});

test("the bus resolver does not infer dispatch priority from component order", () => {
  const fixture = createFixture();
  fixture.model.components.push({
    id: "second-source",
    type: electricalSourceDefinition.type,
    definitionVersion: electricalSourceDefinition.version,
    name: "Second source",
    parameters: { maximumPowerKw: 50 },
    initialState: {}
  });
  fixture.model.connections.push({
    id: "second-source-to-bus",
    name: "Second source to bus",
    from: { componentId: "second-source", portId: "electricity-out" },
    to: { componentId: "bus", portId: "terminal-3" }
  });
  fixture.policy = {
    request() {
      return {
        source: { powerKw: 50 },
        "second-source": { powerKw: 50 }
      };
    }
  };

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(
    diagnosticCodes(result).includes("runtime.unsupported-electrical-dispatch")
  );
});
