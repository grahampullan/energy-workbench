import assert from "node:assert/strict";
import test from "node:test";

import {
  createConnectionColourScale,
  tableauColour
} from "../../src/ui/connection-colours.js";

test("connection colours follow stable model order through Tableau 10", () => {
  const colours = createConnectionColourScale(["a", "b", "c"]);

  assert.equal(colours.colourFor("a"), "#4e79a7");
  assert.equal(colours.colourFor("b"), "#f28e2c");
  assert.equal(colours.colourFor("c"), "#e15759");
  assert.equal(colours.indexFor("c"), 2);
  assert.equal(tableauColour(10), tableauColour(0));
});

test("connection colour assignment rejects ambiguous identities", () => {
  assert.throws(
    () => createConnectionColourScale(["same", "same"]),
    /Unique connection IDs/u
  );
  assert.throws(
    () => createConnectionColourScale(["known"]).colourFor("unknown"),
    /not defined/u
  );
});
