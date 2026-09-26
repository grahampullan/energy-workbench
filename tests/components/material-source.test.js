import assert from "node:assert/strict";
import test from "node:test";
import { materialSourceDefinition } from "../../src/components/material/source.js";
import { materialSinkDefinition } from "../../src/components/material/sink.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

function run(profileMultiplier, values = [0, 10]) {
  return runScenario({
    model: {
      schemaVersion: "0.1.0", id: "model.mass-source", name: "Material profile",
      components: [
        { id: "source", name: "Source", type: materialSourceDefinition.type,
          definitionVersion: materialSourceDefinition.version, initialState: {},
          parameters: { specificEnthalpyKjPerKg: 1312,
            ...(profileMultiplier === undefined ? {} : { profileMultiplier }) } },
        { id: "sink", name: "Sink", type: materialSinkDefinition.type,
          definitionVersion: materialSinkDefinition.version, initialState: {}, parameters: {} }
      ],
      connections: [{ id: "transfer", name: "Transfer",
        from: { componentId: "source", portId: "material-out" },
        to: { componentId: "sink", portId: "material-in" } }]
    },
    scenario: {
      schemaVersion: "0.1.0", id: "scenario.mass-source", name: "Profile",
      time: { timeStepSeconds: 60, stepCount: values.length },
      series: [{ id: "material-inflow", name: "Inflow", unit: "kg/s",
        data: { kind: "inline", values } }]
    },
    registry: createComponentRegistry([materialSourceDefinition, materialSinkDefinition]),
  });
}

test("material profile scaling preserves timing and specific enthalpy", () => {
  for (const [multiplier, rate] of [[undefined, 10], [0.8, 8], [0, 0], [2, 20]]) {
    const result = run(multiplier);
    assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
    const source = result.results.steps.map(step => step.components.find(c => c.componentId === "source"));
    assert.deepEqual(source.map(c => c.outputs.massFlowKgPerSecond), [0, rate]);
    assert.equal(source[1].outputs.specificEnthalpyKjPerKg, 1312);
    assert.equal(source[1].outputs.enthalpyFlowkW, rate * 1312);
  }
});

test("material source rejects negative multipliers and negative unscaled profiles", () => {
  assert.equal(run(-0.1).completed, false);
  assert.equal(run(0, [0, -10]).completed, false);
  assert.equal(run(1e308).completed, false);
});
