import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../../src/core/component-registry.js";
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
        id: "source-to-load",
        name: "Source to load",
        from: { componentId: "source", portId: "electricity-out" },
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
    registry: createComponentRegistry([sourceDefinition, loadDefinition])
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
    { componentId: "load", state: {} }
  ]);

  const [firstStep, secondStep] = result.results.steps;
  assert.equal(firstStep.elapsedSeconds, 0);
  assert.equal(secondStep.elapsedSeconds, 900);

  const [source, load] = firstStep.components;
  assert.deepEqual(source.requestedCommand, { powerKw: 100 });
  assert.deepEqual(source.operatingLimits, {
    minimumPowerKw: 0,
    maximumPowerKw: 50
  });
  assert.deepEqual(source.feasibleCommand, { powerKw: 50 });
  assert.deepEqual(source.actualCommand, { powerKw: 15 });
  assert.deepEqual(source.outputs, { powerKw: 15 });

  assert.equal(load.requestedCommand, null);
  assert.deepEqual(load.feasibleCommand, { powerKw: -15 });
  assert.deepEqual(load.actualCommand, { powerKw: -15 });
  assert.deepEqual(load.outputs, {
    demandPowerKw: 15,
    suppliedPowerKw: 15
  });
  assert.deepEqual(firstStep.connections, [{
    connectionId: "source-to-load",
    medium: "electricity.active-power",
    powerKw: 15,
    residualPowerKw: 0
  }]);

  assert.equal(secondStep.connections[0].powerKw, 30);
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

test("the first resolver rejects branching electrical topology explicitly", () => {
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
    id: "source-to-second-load",
    name: "Source to second load",
    from: { componentId: "source", portId: "electricity-out" },
    to: { componentId: "second-load", portId: "electricity-in" }
  });

  const result = runScenario(fixture);

  assert.equal(result.completed, false);
  assert.ok(diagnosticCodes(result).includes("runtime.unsupported-electrical-topology"));
});
