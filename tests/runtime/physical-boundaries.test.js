import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { electricalGridDefinition } from "../../src/components/electrical/grid.js";
import { electricHeaterDefinition } from "../../src/components/thermal/electric-heater.js";
import { thermalStoreDefinition } from "../../src/components/thermal/store.js";
import { heatTransferDefinition } from "../../src/components/thermal/heat-transfer.js";
import { heatDemandDefinition } from "../../src/components/thermal/heat-demand.js";
import { constantTemperatureDefinition } from "../../src/components/thermal/constant-temperature.js";
import { policyDefinitions } from "../../src/policies/definitions.js";
import { createComponentRegistry } from "../helpers/registry.js";
import { runScenario } from "../../src/runtime/run-scenario.js";

const definitions = [electricalGridDefinition, electricHeaterDefinition,
  thermalStoreDefinition, heatTransferDefinition, heatDemandDefinition, constantTemperatureDefinition];
const readExample = async (file) => JSON.parse(await readFile(
  new URL(`../../examples/coupled-thermal/${file}.json`, import.meta.url), "utf8"
));
const model = await readExample("model");
const scenario = await readExample("scenario");
scenario.time.stepCount = 1;
scenario.series.forEach((series) => { series.data.values = series.data.values.slice(0, 1); });
scenario.series.find(({ id }) => id === "thermal-demand").data.values[0] = 45;

function runWith(transform, policies = policyDefinitions) {
  return runScenario({ model, scenario,
    registry: createComponentRegistry(definitions.map(transform), { policies }) });
}

test("physical resolution sees only connected port references and published boundary fields", () => {
  const seen = new Set();
  function inspect(component, context, phase) {
    seen.add(`${component.id}.${phase}`);
    assert.equal(context.getTarget, undefined);
    assert.equal(context.getOperatingLimits, undefined);
    assert.equal(context.balancingComponentId, undefined);
    assert.equal(context.role, component.id === "grid" ? "electrical-balance" : null);
    for (const connection of context.connections) {
      assert.ok(connection.from.componentId === component.id || connection.to.componentId === component.id);
      for (const endpoint of [connection.from, connection.to]) {
        assert.deepEqual(Object.keys(endpoint).sort(), ["componentId", "direction", "portId", "role"]);
        assert.ok(Object.isFrozen(endpoint));
      }
    }
    if (component.id === "store") {
      const boundary = context.getBoundary("heater-to-store");
      assert.equal(boundary.target, null);
      assert.deepEqual(boundary.operatingLimits, {
        feasibleHeatOutputkW: 45,
        supplyTemperatureC: 90
      });
      assert.throws(() => { boundary.operatingLimits.supplyTemperatureC = 0; }, TypeError);
    }
    if (component.id === "store-loss") {
      const boundary = context.getBoundary("store-to-loss");
      assert.equal(boundary.operatingLimits.temperatureC, 80);
      assert.equal(boundary.operatingLimits.thermalCapacitykWhPerK, 10);
      assert.equal(boundary.operatingLimits.containedMassKg, undefined);
      assert.equal(boundary.target, null);
    }
    if (component.id === "heater") {
      // The store publishes its temperature and capacity on passive ports,
      // not on the heater's active heat-input connection.
      assert.deepEqual(context.getBoundary("heater-to-store"), { operatingLimits: {}, target: null });
    }
  }
  const result = runWith((definition) => ({
    ...definition,
    resolution: { describe(component, context) {
      inspect(component, context, "describe");
      return definition.resolution.describe(component, context);
    } },
    model: { ...definition.model,
      getOperatingLimits(...args) {
        return { ...definition.model.getOperatingLimits(...args), privateLimit: 123 };
      },
      resolve(component, context, step) {
        inspect(component, context, "resolve");
        return definition.model.resolve(component, context, step);
      }
    }
  }), policyDefinitions.map((policy) => policy.type === "thermal.follow-demand" ? {
    ...policy, request: (...args) => ({ ...policy.request(...args), privateChoice: 456 })
  } : policy));
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.equal(seen.size, definitions.length * 2);
});

test("component lifecycle callbacks cannot read other state, model data, or unrelated profiles", () => {
  const seen = new Set();
  const expectedSeries = (component) => component.id === "heat-demand" ? ["thermal-demand"]
    : component.id === "ambient" ? ["ambient-temperature"] : [];
  function inspectStep(component, context, phase) {
    seen.add(`${component.id}.${phase}`);
    assert.equal(context.states, undefined);
    assert.equal(context.model, undefined);
    assert.equal(context.scenario, undefined);
    assert.deepEqual(Object.keys(context.seriesValues), expectedSeries(component));
    assert.deepEqual(context.state, component.initialState);
  }
  const result = runWith((definition) => ({ ...definition, model: {
    ...definition.model,
    prepare(component, context) {
      seen.add(`${component.id}.prepare`);
      assert.equal(context.model, undefined);
      assert.deepEqual(context.scenario.series.map(({ id }) => id), expectedSeries(component));
      assert.ok(Object.isFrozen(context.scenario));
      return definition.model.prepare(component, context);
    },
    initialise(component, context) {
      seen.add(`${component.id}.initialise`);
      assert.deepEqual(context.series.map(({ id }) => id), expectedSeries(component));
      return definition.model.initialise(component, context);
    },
    getOperatingLimits(component, context, target) {
      inspectStep(component, context, "limits");
      return definition.model.getOperatingLimits(component, context, target);
    },
    resolve(component, context, step) {
      inspectStep(component, step, "resolve");
      return definition.model.resolve(component, context, step);
    },
    evaluate(component, command, context) {
      inspectStep(component, context, "evaluate");
      return definition.model.evaluate(component, command, context);
    }
  } }));
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.equal(seen.size, definitions.length * 5);
});

test("physical access rejects unconnected boundaries and undeclared flows", async (t) => {
  for (const phase of ["describe", "resolve"]) {
    await t.test(`${phase}: an unrelated link is inaccessible`, () => {
      const result = runWith((definition) => definition !== thermalStoreDefinition ? definition : {
        ...definition,
        ...(phase === "describe" ? { resolution: { describe(component, context) {
          return context.getBoundary("grid-to-heater");
        } } } : { model: { ...definition.model, resolve(component, context) {
          return context.getBoundary("grid-to-heater");
        } } })
      });
      assert.equal(result.completed, false);
      assert.ok(result.diagnostics.some(({ code }) => code === "runtime.unconnected-boundary-access"));
    });
  }
  for (const connectionId of ["grid-to-heater", "heater-to-store"]) {
    await t.test(`flow ${connectionId} cannot bypass dependency declarations`, () => {
      const result = runWith((definition) => definition !== thermalStoreDefinition ? definition : {
        ...definition, model: { ...definition.model, resolve(component, context) {
          return context.getConnectionFlow(connectionId);
        } }
      });
      assert.equal(result.completed, false);
      assert.ok(result.diagnostics.some(({ code }) => code === "runtime.undeclared-flow-access"));
    });
  }
});

test("resolution prerequisites cannot request a target outside the connected port contract", async (t) => {
  for (const componentType of ["thermal.store", "electrical.grid"]) {
    await t.test(componentType, () => {
      const result = runWith((definition) => definition.type !== componentType ? definition : {
        ...definition, resolution: { describe(component, context) {
          const declaration = definition.resolution.describe(component, context);
          // Heater's electrical port does not publish its target to Grid.
          // Store has no direct physical connection to Ambient.
          declaration.requires.targets = [componentType === "thermal.store" ? "ambient" : "heater"];
          return declaration;
        } }
      });
      assert.equal(result.completed, false);
      assert.ok(result.diagnostics.some(({ code, message }) =>
        code === "runtime.component-resolution-declaration-contract" && /not published/.test(message)));
    });
  }
});
