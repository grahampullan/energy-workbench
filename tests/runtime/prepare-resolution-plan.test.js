import assert from "node:assert/strict";
import test from "node:test";

import { createComponentRegistry } from "../helpers/registry.js";
import { resolveRuntimeComponents } from
  "../../src/runtime/component-execution.js";
import { prepareResolutionPlan } from
  "../../src/runtime/prepare-resolution-plan.js";
import { prepareRuntimeModel } from "../../src/runtime/prepare-runtime-model.js";
import { createTestComponentDefinition } from
  "../helpers/component-definition.js";

const FLOW_TYPE = "electricity.active-power";

function description({ targets = [], requires = [], determines = [] } = {}) {
  return {
    requires: { targets, connectionFlows: requires },
    determines
  };
}

function portId(connectionId, end) {
  return `${connectionId}-${end}`;
}

function prepareFixture({ descriptions, connections }) {
  const definitions = Object.keys(descriptions).map((componentId) =>
    createTestComponentDefinition({
      type: `test.${componentId}`,
      name: componentId,
      ports: connections.flatMap((connection) => {
        if (connection.from === componentId) {
          return [{
            id: portId(connection.id, "out"),
            flowType: FLOW_TYPE,
            direction: "out"
          }];
        }
        if (connection.to === componentId) {
          return [{
            id: portId(connection.id, "in"),
            flowType: FLOW_TYPE,
            direction: "in"
          }];
        }
        return [];
      }),
      resolution: { describe: () => descriptions[componentId] }
    })
  );
  const preparation = prepareRuntimeModel({
    model: {
      schemaVersion: "0.1.0",
      id: "model.resolution-plan",
      name: "Resolution-plan model",
      components: definitions.map((definition) => ({
        id: definition.name,
        type: definition.type,
        definitionVersion: definition.version,
        name: definition.name,
        parameters: {},
        initialState: {}
      })),
      connections: connections.map((connection) => ({
        id: connection.id,
        name: connection.id,
        from: {
          componentId: connection.from,
          portId: portId(connection.id, "out")
        },
        to: {
          componentId: connection.to,
          portId: portId(connection.id, "in")
        }
      }))
    },
    scenario: {
      schemaVersion: "0.1.0",
      id: "scenario.resolution-plan",
      name: "Resolution-plan scenario",
      time: { timeStepSeconds: 3600, stepCount: 1 },
      series: []
    },
    registry: createComponentRegistry(definitions)
  });
  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  return preparation.runtimeModel;
}

function preparePlan(runtimeModel, targets = {}) {
  return prepareResolutionPlan({
    runtimeModel,
    operation: { targets, balancingComponentId: "load" },
    limitsByComponentId: new Map(
      runtimeModel.components.map(({ id }) => [id, {}])
    ),
    stepIndex: 0
  });
}

function twoComponentFixture(sourceDescription, loadDescription) {
  return prepareFixture({
    descriptions: { source: sourceDescription, load: loadDescription },
    connections: [{ id: "source-to-load", from: "source", to: "load" }]
  });
}

test("resolution plan orders a determiner before a flow consumer", () => {
  const runtimeModel = twoComponentFixture(
    description({ determines: ["source-to-load"] }),
    description({ requires: ["source-to-load"] })
  );

  const preparation = preparePlan(runtimeModel);

  assert.equal(preparation.prepared, true);
  assert.deepEqual(preparation.diagnostics, []);
  assert.deepEqual(preparation.plan.stages, [["source"], ["load"]]);
});

test("later ladle heat recovery topology has an acyclic resolution order", () => {
  const runtimeModel = prepareFixture({
    descriptions: {
      ladle: description({ requires: ["ladle-to-exchanger"] }),
      "heat-exchanger": description({
        requires: ["exchanger-to-pump"],
        determines: ["ladle-to-exchanger"]
      }),
      "heat-pump": description({
        targets: ["heat-pump"],
        determines: [
          "exchanger-to-pump",
          "supply-to-pump",
          "pump-to-store"
        ]
      }),
      "electrical-supply": description({ requires: ["supply-to-pump"] }),
      "thermal-store": description({ requires: ["pump-to-store"] })
    },
    connections: [
      {
        id: "ladle-to-exchanger",
        from: "ladle",
        to: "heat-exchanger"
      },
      {
        id: "exchanger-to-pump",
        from: "heat-exchanger",
        to: "heat-pump"
      },
      {
        id: "supply-to-pump",
        from: "electrical-supply",
        to: "heat-pump"
      },
      {
        id: "pump-to-store",
        from: "heat-pump",
        to: "thermal-store"
      }
    ]
  });
  const preparation = preparePlan(runtimeModel, {
    "heat-pump": { heatOutputkW: 100 }
  });

  assert.equal(preparation.prepared, true, JSON.stringify(preparation.diagnostics));
  assert.deepEqual(preparation.plan.stages, [
    ["heat-pump"],
    ["heat-exchanger", "electrical-supply", "thermal-store"],
    ["ladle"]
  ]);
});

test("component execution rejects settled flows that disagree with the plan", () => {
  const runtimeModel = twoComponentFixture(
    description({ determines: ["source-to-load"] }),
    description({ requires: ["source-to-load"] })
  );
  const operation = { targets: {}, balancingComponentId: "load" };
  const limits = new Map([["source", {}], ["load", {}]]);
  const plan = prepareResolutionPlan({
    runtimeModel,
    operation,
    limitsByComponentId: limits
  }).plan;
  const diagnostics = [];

  const resolution = resolveRuntimeComponents(
    runtimeModel,
    plan,
    operation,
    limits,
    { stepIndex: 0, states: { source: {}, load: {} } },
    1e-9,
    diagnostics
  );

  assert.equal(resolution.resolved, false);
  assert.ok(diagnostics.some(({ code }) =>
    code === "runtime.component-resolution-plan-contract"
  ));
});

test("resolution plan diagnoses invalid dependency graphs", async (t) => {
  const cases = [
    {
      name: "missing connection determiner",
      runtimeModel: () => twoComponentFixture(
        description(),
        description({ requires: ["source-to-load"] })
      ),
      code: "runtime.missing-connection-determiner"
    },
    {
      name: "conflicting connection determiners",
      runtimeModel: () => twoComponentFixture(
        description({ determines: ["source-to-load"] }),
        description({ determines: ["source-to-load"] })
      ),
      code: "runtime.conflicting-connection-determiners"
    },
    {
      name: "missing policy target",
      runtimeModel: () => twoComponentFixture(
        description({
          targets: ["source"],
          determines: ["source-to-load"]
        }),
        description({ requires: ["source-to-load"] })
      ),
      code: "runtime.missing-policy-target"
    },
    {
      name: "same-step dependency cycle",
      runtimeModel: () => prepareFixture({
        descriptions: {
          first: description({
            requires: ["second-to-first"],
            determines: ["first-to-second"]
          }),
          second: description({
            requires: ["first-to-second"],
            determines: ["second-to-first"]
          })
        },
        connections: [
          { id: "first-to-second", from: "first", to: "second" },
          { id: "second-to-first", from: "second", to: "first" }
        ]
      }),
      code: "runtime.resolution-dependency-cycle"
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const preparation = preparePlan(fixture.runtimeModel());
      assert.equal(preparation.prepared, false);
      assert.ok(preparation.diagnostics.some(({ code }) => code === fixture.code));
    });
  }
});
