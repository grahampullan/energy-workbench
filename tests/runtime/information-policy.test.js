import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createComponentRegistry } from "../helpers/registry.js";
import { validateModel } from "../../src/core/validation/validate-documents.js";
import { applyModelCommand } from "../../src/core/model-commands.js";
import { runScenario } from "../../src/runtime/run-scenario.js";
import { parseWorkbenchModel, serialiseJsonDocument } from "../../src/ui/study-document-files.js";
import { informationView, visibleInformationConnections, componentPolicyView } from "../../src/ui/information-view.js";

const definitions = [];
for (const domain of ["electrical", "material", "thermal"]) {
  const directory = new URL(`../../src/components/${domain}/`, import.meta.url);
  for (const file of await readdir(directory)) {
    const module = await import(new URL(file, directory));
    definitions.push(...Object.values(module).filter((value) => value?.type && value?.model));
  }
}
const registry = createComponentRegistry(definitions);
async function fixture(example, file = "model.json") {
  const read = async (name) => JSON.parse(await readFile(new URL(`../../examples/${example}/${name}`, import.meta.url)));
  return { model: await read(file), scenario: await read("scenario.json"), registry };
}
const codes = (result) => result.diagnostics.map(({ code }) => code);

// A test-only relay exercises derived information without adding an
// intermediary to the PV example's direct policy connections.
async function relayFixture() {
  const data = await fixture("blog-electrical");
  const port = { label: "Relayed power", quantity: "active-power", unit: "kW" };
  data.registry = createComponentRegistry(definitions.map((definition) => definition.type === "electrical.bus"
    ? { ...definition, information: {
      inputs: { power: port },
      outputs: { power: { ...port, read: ({ inputs }) => inputs.power } }
    } } : definition));
  const generation = data.model.informationConnections[0];
  data.model.informationConnections.push({
    id: "relay-generation", name: "Relayed generation",
    from: { componentId: "bus", portId: "power" }, to: generation.to
  });
  generation.to = { componentId: "bus", portId: "power" };
  return data;
}

test("information connections reject missing inputs, unknown ports and incompatible quantities", async () => {
  const original = await fixture("blog-electrical");
  for (const [edit, expected] of [
    [(m) => m.informationConnections.pop(), "model.missing-policy-input"],
    [(m) => { m.informationConnections[0].from.portId = "internal-state"; }, "model.information-source-port"],
    [(m) => { m.informationConnections[0].to.portId = "terminal"; }, "model.information-target-port"],
    [(m) => { m.informationConnections.push({ ...m.informationConnections.at(-1), id: "duplicate-input" }); }, "model.information-cardinality"]
  ]) {
    const model = structuredClone(original.model); edit(model);
    assert.ok(codes(runScenario({ ...original, model })).includes(expected), expected);
  }
  const thermal = await fixture("coupled-thermal");
  thermal.model.informationConnections[0].from = { componentId: "store", portId: "temperature" };
  assert.ok(codes(runScenario(thermal)).includes("model.information-type"));
});

test("information cycles are rejected before component calculation, self-state inputs remain valid", async () => {
  const data = await relayFixture();
  data.model.informationConnections[0].from = { componentId: "bus", portId: "power" };
  assert.ok(codes(runScenario(data)).includes("model.information-cycle"));
  assert.equal(runScenario(await fixture("ladle-cycle-synthetic", "model-temperature-led.json")).completed, true);
});

test("same units do not make electricity and heat interchangeable", async () => {
  const data = await fixture("batch-heating-synthetic");
  data.model.informationSources[0].quantity = "heat-rate";
  assert.ok(codes(runScenario(data)).includes("model.information-type"));
  data.model.informationSources[0].quantity = "active-power";
  data.scenario.series[0].unit = "W";
  assert.ok(codes(runScenario(data)).includes("runtime.information-preparation"));
});

test("own capability inputs update with parameter overrides, without giving policies internal access", async () => {
  const data = await fixture("coupled-thermal");
  const run = runScenario(data);
  data.model.components.find(({ id }) => id === "heater").parameters.efficiency = 0.5;
  const changed = runScenario(data);
  assert.ok(run.completed && changed.completed);
  const request = (result) => result.results.steps[2].components.find(({ componentId }) => componentId === "heater").requestedCommand.powerkW;
  assert.equal(request(changed), request(run) * 0.9 / 0.5);
});

test("heating periods control temperature-led heating through time remaining, including separated periods", async () => {
  const data = await fixture("ladle-cycle-synthetic", "model-temperature-led.json");
  const observed = [];
  data.registry = createComponentRegistry(definitions, { policies: registry.listPolicies().map((p) => p.type === "thermal.reach-temperature"
    ? { ...p, request(inputs, settings) { observed.push(inputs); return p.request(inputs, settings); } } : p) });
  const modes = data.scenario.series.find(({ id }) => id === "process-mode").data.values;
  modes.fill(0); modes[0] = 1; modes[1] = 1; modes[4] = 1;
  data.scenario.series.find(({ id }) => id === "material-outflow").data.values.fill(0);
  const result = runScenario(data);
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(observed.slice(0, 5).map(({ remaining }) => remaining), [2 / 60, 1 / 60, 0, 0, 1 / 60]);
  const requests = result.results.steps.slice(0, 5).map((step) => step.components.find(({ componentId }) => componentId === "burner").requestedCommand.heatOutputkW);
  assert.deepEqual(requests.map((power) => power > 0), [true, true, false, false, true]);
});

test("policy commands, inverse commands and saved models preserve explicit connections", async () => {
  const data = await fixture("ladle-cycle-synthetic");
  const alternative = await fixture("ladle-cycle-synthetic", "model-temperature-led.json");
  const before = structuredClone(data.model);
  const changed = applyModelCommand(data.model, {
    type: "setComponentPolicy", componentId: "burner",
    policy: alternative.model.components.find(({ id }) => id === "burner").policy,
    informationConnections: alternative.model.informationConnections.filter(({ to }) => to.componentId === "burner"),
    informationSources: alternative.model.informationSources
  }, { registry });
  assert.equal(changed.applied, true, JSON.stringify(changed.diagnostics));
  assert.deepEqual(data.model, before);
  const undo = applyModelCommand(changed.model, changed.inverseCommand, { registry });
  assert.equal(undo.applied, true);
  assert.deepEqual(undo.model, before);
  const loaded = parseWorkbenchModel(serialiseJsonDocument(changed.model), { registry, referenceModel: data.model });
  assert.equal(loaded.valid, true);
  assert.deepEqual(runScenario({ ...data, model: loaded.model }), runScenario(alternative));
});

test("policy settings, conflicting roles and physically unavailable policies fail validation", async () => {
  const data = await fixture("ladle-cycle-synthetic", "model-temperature-led.json");
  data.model.components.find(({ id }) => id === "burner").policy.settings.margin = null;
  assert.ok(codes(validateModel(data.model, { registry })).includes("model.invalid-policy-setting"));
  const pv = await fixture("blog-electrical");
  pv.model.components.find(({ id }) => id === "battery").policy = { type: "electrical.balance", settings: {} };
  assert.ok(codes(validateModel(pv.model, { registry })).includes("model.multiple-balancing-policies"));
  const refractory = data.model.components.find(({ id }) => id === "refractory");
  assert.equal(componentPolicyView(data.model, refractory, registry, data.scenario).available.length, 0);
});

test("policy choices and validation agree when a required physical connection is removed", async () => {
  const data = await fixture("material-inventory-synthetic");
  const store = data.model.components.find(({ policy }) => policy?.type === "material.follow-schedule");
  const offered = () => componentPolicyView(data.model, store, registry, data.scenario)
    .available.some(({ type }) => type === "material.follow-schedule");
  assert.equal(offered(), true);
  data.model.connections = data.model.connections.filter(({ from }) =>
    from.componentId !== store.id || from.portId !== "material-out"
  );
  assert.equal(offered(), false);
  assert.ok(codes(validateModel(data.model, { registry })).includes("model.policy-port-required"));
});

test("policy source choices exclude matching units with a different physical quantity", async () => {
  const data = await fixture("coupled-thermal");
  const heater = data.model.components.find(({ id }) => id === "heater");
  const view = componentPolicyView(data.model, heater, registry, data.scenario);
  const heatSources = view.optionsFor({ quantity: "heat-rate", unit: "kW" });
  assert.ok(heatSources.some(({ from }) => from.componentId === "heat-demand"));
  assert.equal(view.optionsFor({ quantity: "active-power", unit: "kW" })
    .some(({ from }) => from.componentId === "heat-demand"), false);
  assert.equal(view.optionsFor({ quantity: "heat-rate", unit: "W" })
    .some(({ from }) => from.componentId === "heat-demand"), false);
});

test("viewer reveals selected inputs and upstream dependencies without mixing physical connections", async () => {
  const data = await fixture("blog-electrical");
  const connections = informationView(data.model, registry);
  assert.deepEqual(connections.map(({ from, to }) => [from.componentId, to.componentId, to.portId]), [
    ["pv", "battery", "policy.generation"], ["load", "battery", "policy.demand"]
  ]);
  assert.equal(visibleInformationConnections(connections, null, false, null).length, 0);
  assert.equal(visibleInformationConnections(connections, "battery", false, null).length, 2);
  assert.equal(visibleInformationConnections(connections, "bus", false, null).length, 0);
  assert.equal(visibleInformationConnections(connections, null, false, connections.at(-1).id).length, 1);
  assert.equal(visibleInformationConnections(connections, null, true, null).length, 2);
  assert.ok(connections.every(({ id }) => !data.model.connections.some((physical) => physical.id === id)));
  const relay = await relayFixture();
  const upstream = informationView(relay.model, relay.registry);
  assert.equal(visibleInformationConnections(upstream, "battery", false, null).length, 3);
  assert.equal(visibleInformationConnections(upstream, "bus", false, null).length, 1);
  assert.equal(visibleInformationConnections(upstream, null, false, "relay-generation").length, 2);
});

test("renaming components and schedules preserves behaviour through explicit references", async () => {
  const data = await fixture("ladle-cycle-synthetic", "model-temperature-led.json");
  const original = runScenario(data);
  const renamed = structuredClone(data.model);
  for (const component of renamed.components) component.id = `renamed-${component.id}`;
  for (const connection of [...renamed.connections, ...renamed.informationConnections]) {
    if (connection.from.componentId) connection.from.componentId = `renamed-${connection.from.componentId}`;
    connection.to.componentId = `renamed-${connection.to.componentId}`;
  }
  const result = runScenario({ ...data, model: renamed });
  assert.equal(result.completed, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.results.steps.map((s) => s.components.map((c) => c.outputs)), original.results.steps.map((s) => s.components.map((c) => c.outputs)));
});


test("information calculations follow dependencies rather than component array order", async () => {
  const data = await relayFixture();
  const original = runScenario(data);
  assert.equal(original.completed, true);
  const direct = runScenario(await fixture("blog-electrical"));
  assert.deepEqual(original.results.steps, direct.results.steps);
  data.model.components.reverse();
  data.model.informationConnections.reverse();
  const reversed = runScenario(data);
  assert.equal(reversed.completed, true);
  const outputs = (run) => run.results.steps.map(({ components }) => Object.fromEntries(components.map(({ componentId, outputs }) => [componentId, outputs])));
  assert.deepEqual(outputs(reversed), outputs(original));
});

test("whole-model policy callbacks cannot bypass connected policy inputs", async () => {
  const data = await fixture("blog-electrical");
  assert.throws(() => runScenario({ ...data, policy: { request() { throw new Error("Must not run"); } } }), /Configure policies on model components/u);
});
