import { policyDefinitions } from "../../src/policies/definitions.js";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import katex from "katex";


function checkExplanation(explanation) {
  assert.equal(typeof explanation.title, "string");
  assert.ok(explanation.title.length > 0);
  assert.equal(typeof explanation.summary, "string");
  assert.ok(explanation.summary.length > 0);
  assert.ok(Array.isArray(explanation.equations));
  assert.ok(Array.isArray(explanation.symbols));
  assert.ok(Array.isArray(explanation.notes));
  assert.deepEqual(JSON.parse(JSON.stringify(explanation)), explanation);
  for (const entry of [...explanation.equations, ...explanation.symbols]) {
    assert.equal(typeof entry.tex, "string");
    assert.ok(entry.tex.length > 0);
    const html = katex.renderToString(entry.tex, {
      displayMode: Object.hasOwn(entry, "label"),
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: true,
      trust: false
    });
    assert.match(html, /class="katex"/u);
    assert.match(html, /<math /u);
    assert.doesNotMatch(html, /katex-error|<a |<img /u);
  }
  for (const { label } of explanation.equations) {
    assert.ok(typeof label === "string" && label.length > 0);
  }
  for (const { description, unit } of explanation.symbols) {
    assert.ok(typeof description === "string" && description.length > 0);
    assert.equal(typeof unit, "string");
  }
  assert.ok(explanation.notes.every(note => typeof note === "string" && note.length > 0));
}

test("every built-in component documents equations that render with accessible maths", async () => {
  for (const domain of ["electrical", "material", "thermal"]) {
    const directory = new URL(`../../src/components/${domain}/`, import.meta.url);
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".js")) continue;
      const module = await import(new URL(file, directory));
      for (const definition of Object.values(module)) {
        if (definition?.type && definition?.model) {
          assert.ok(definition.explanation, `${definition.type} needs an explanation`);
          checkExplanation(definition.explanation);
        }
      }
    }
  }
});

test("all reusable policies publish accessible mathematical explanations", () => {
  for (const policy of policyDefinitions) checkExplanation(policy.explanation);
});
