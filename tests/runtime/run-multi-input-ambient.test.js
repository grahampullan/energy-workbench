import assert from "node:assert/strict";
import test from "node:test";

import { constantTemperatureDefinition } from
  "../../src/components/thermal/constant-temperature.js";
import { resolutionDescription } from
  "../../src/components/model-resolution.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { THERMAL_HEAT_FLOW_TYPE } from "../../src/core/flow-types.js";
import { createThermalFlow } from "../../src/core/thermal-flow.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { createTestComponentDefinition } from
  "../helpers/component-definition.js";

function heatSourceDefinition({ type, name, heatFlowkW, sourceTemperatureC }) {
  return createTestComponentDefinition({
    type,
    name,
    ports: [{
      id: "heat-out",
      flowType: THERMAL_HEAT_FLOW_TYPE,
      direction: "out"
    }],
    outputs: {
      heatFlowkW: { unit: "kW" },
      sourceTemperatureC: { unit: "°C" }
    },
    resolution: {
      describe(runtimeComponent, context) {
        const [connection] = context.connections;
        return resolutionDescription({ determines: [connection.id] });
      }
    },
    model: {
      resolve(runtimeComponent, context) {
        const [connection] = context.connections;
        const ambientLimits = context.getBoundary(connection.id).operatingLimits;
        const flow = createThermalFlow({
          heatFlowkW,
          sourceTemperatureC,
          deliveryTemperatureC: ambientLimits.temperatureC
        });
        return {
          feasibleCommand: null,
          actualCommand: { flow },
          connectionFlows: { [connection.id]: flow }
        };
      },
      evaluate(runtimeComponent, actualCommand) {
        const flow = createThermalFlow(actualCommand.flow);
        return {
          portFlows: { "heat-out": flow },
          outputs: {
            heatFlowkW: flow.heatFlowkW,
            sourceTemperatureC: flow.sourceTemperatureC
          },
          nextState: {},
          diagnostics: []
        };
      }
    }
  });
}

const firstSourceDefinition = heatSourceDefinition({
  type: "test.first-heat-source",
  name: "First heat source",
  heatFlowkW: 10,
  sourceTemperatureC: 60
});
const secondSourceDefinition = heatSourceDefinition({
  type: "test.second-heat-source",
  name: "Second heat source",
  heatFlowkW: 5,
  sourceTemperatureC: 45
});

function fixture() {
  return {
    model: {
      schemaVersion: "0.1.0",
      id: "model.multi-input-ambient",
      name: "Multiple heat losses to one ambient boundary",
      components: [
        {
          id: "first-source",
          type: firstSourceDefinition.type,
          definitionVersion: firstSourceDefinition.version,
          name: firstSourceDefinition.name,
          parameters: {},
          initialState: {}
        },
        {
          id: "second-source",
          type: secondSourceDefinition.type,
          definitionVersion: secondSourceDefinition.version,
          name: secondSourceDefinition.name,
          parameters: {},
          initialState: {}
        },
        {
          id: "ambient",
          type: constantTemperatureDefinition.type,
          definitionVersion: constantTemperatureDefinition.version,
          name: "Ambient",
          parameters: { temperatureSeriesId: "ambient-temperature" },
          initialState: {}
        }
      ],
      connections: [
        {
          id: "first-loss",
          name: "First heat loss",
          from: { componentId: "first-source", portId: "heat-out" },
          to: { componentId: "ambient", portId: "heat-in" }
        },
        {
          id: "second-loss",
          name: "Second heat loss",
          from: { componentId: "second-source", portId: "heat-out" },
          to: { componentId: "ambient", portId: "heat-in" }
        }
      ]
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.multi-input-ambient",
      name: "Multiple heat losses",
      time: { timeStepSeconds: 60, stepCount: 1 },
      series: [{
        id: "ambient-temperature",
        name: "Ambient temperature",
        unit: "°C",
        data: { kind: "inline", values: [15] }
      }]
    },
    registry: createComponentRegistry([
      firstSourceDefinition,
      secondSourceDefinition,
      constantTemperatureDefinition
    ])
  };
}

test("one Ambient constant-temperature boundary receives independent heat losses", () => {
  const result = runScenario(fixture());

  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  const [step] = result.results.steps;
  assert.deepEqual(step.resolutionPlan.stages, [
    ["first-source", "second-source"],
    ["ambient"]
  ]);
  const ambient = step.components.find(
    ({ componentId }) => componentId === "ambient"
  );
  assert.equal(ambient.outputs.receivedHeatFlowkW, 15);
  assert.deepEqual(ambient.portFlows["heat-in"]["first-loss"], {
    heatFlowkW: 10,
    sourceTemperatureC: 60,
    deliveryTemperatureC: 15
  });
  assert.deepEqual(ambient.portFlows["heat-in"]["second-loss"], {
    heatFlowkW: 5,
    sourceTemperatureC: 45,
    deliveryTemperatureC: 15
  });
  assert.deepEqual(Object.keys(ambient.portFlows["heat-in"]), [
    "first-loss",
    "second-loss"
  ]);
  assert.deepEqual(
    step.connections.map(({ connectionId, flow }) => [
      connectionId,
      flow.heatFlowkW
    ]),
    [["first-loss", 10], ["second-loss", 5]]
  );
});

test("a repeatable port evaluates every attached connection separately", () => {
  const incompleteAmbientDefinition = {
    ...constantTemperatureDefinition,
    version: "0.1.1-test",
    model: {
      ...constantTemperatureDefinition.model,
      evaluate(runtimeComponent, actualCommand, stepContext) {
        const evaluation = constantTemperatureDefinition.model.evaluate(
          runtimeComponent,
          actualCommand,
          stepContext
        );
        delete evaluation.portFlows["heat-in"]["second-loss"];
        return evaluation;
      }
    }
  };
  const incomplete = fixture();
  incomplete.model.components[2].definitionVersion =
    incompleteAmbientDefinition.version;
  incomplete.registry = createComponentRegistry([
    firstSourceDefinition,
    secondSourceDefinition,
    incompleteAmbientDefinition
  ]);

  const result = runScenario(incomplete);

  assert.equal(result.completed, false);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "runtime.component-port-flow-contract"
  ));
});
